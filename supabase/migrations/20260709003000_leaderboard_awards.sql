-- ============================================================================
-- Leaderboard awards + watering/host tweaks (user feedback)
--
-- 1. Watering v3: clicking Water pours your available water over the whole
--    plot. Every waterable tree advances floor(water/10) stages together
--    (10-per-stage is the tunable pace constant, not a hard "cost per
--    click"), capped at bearing. Only water actually absorbed is spent —
--    and extra trees NEVER need extra water.
-- 2. Hosting: starting a (new) meeting code earns the host 10 water.
-- 3. Awards display rule: medals/badges appear ONLY once actually won at a
--    monthly ceremony. They become publicly visible for farmers whose
--    profile is public (Private Mode respected):
--      - RLS on user_medals / user_badges opens up for public profiles
--      - get_leaderboard returns each PUBLIC row's won medals + badges
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. water_my_trees v3
-- ----------------------------------------------------------------------------
create or replace function public.water_my_trees()
returns table (water_left integer, trees_advanced integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  c_water_per_stage constant integer := 10;
  v_user uuid := auth.uid();
  v_farm uuid;
  v_water integer;
  v_stages integer;
  v_needed integer;
  v_applied integer;
  v_advanced integer := 0;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select f.id, f.water_count into v_farm, v_water
  from public.farms f
  join public.seasons s on s.id = f.season_id and s.status = 'active'
  where f.user_id = v_user
  for update of f;

  if v_farm is null then
    raise exception 'No farm this Season';
  end if;

  -- how many whole stages the current water can push
  v_stages := floor(v_water / c_water_per_stage);

  if v_stages >= 1 then
    -- the most stages any tree still needs
    select coalesce(max(5 - t.growth_stage), 0) into v_needed
    from public.trees t
    where t.farm_id = v_farm and t.status = 'active' and t.growth_stage < 5;

    v_applied := least(v_stages, v_needed);

    if v_applied > 0 then
      update public.trees
        set growth_stage = least(5, growth_stage + v_applied)
        where farm_id = v_farm and status = 'active' and growth_stage < 5;
      get diagnostics v_advanced = row_count;

      v_water := v_water - (v_applied * c_water_per_stage);
      update public.farms set water_count = v_water where id = v_farm;
    end if;
  end if;

  return query select v_water, v_advanced;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. start_meeting: +10 water for the host when a NEW code is created
-- ----------------------------------------------------------------------------
drop function public.start_meeting();

create or replace function public.start_meeting()
returns table (meeting_session_id uuid, code text, expires_at timestamptz, already_active boolean, water_earned integer)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  c_code_lifetime constant interval := interval '90 minutes';
  c_host_water constant integer := 10;
  v_user uuid := auth.uid();
  v_role text;
  v_season uuid;
  v_id uuid := gen_random_uuid();
  v_code text;
  v_expires timestamptz := now() + c_code_lifetime;
  v_existing record;
  v_farm uuid;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select p.role into v_role
  from public.profiles p
  where p.user_id = v_user and not p.is_banned;

  if v_role is null or v_role not in ('meeting_host', 'admin') then
    raise exception 'Only Meeting Hosts can start meeting codes';
  end if;

  update public.seasons
    set status = 'closed'
    where status = 'active' and ends_at <= now();
  v_season := public.ensure_active_season();

  update public.meeting_sessions
    set status = 'ended', ended_at = now()
    where host_user_id = v_user and status = 'active' and expires_at <= now();

  select m.id, m.code, m.expires_at into v_existing
  from public.meeting_sessions m
  where m.host_user_id = v_user and m.status = 'active'
  limit 1;

  if v_existing.id is not null then
    return query select v_existing.id, v_existing.code, v_existing.expires_at, true, 0;
    return;
  end if;

  v_code := lpad(floor(random() * 10000)::int::text, 4, '0');

  insert into public.meeting_sessions
    (id, host_user_id, season_id, code, code_hash, expires_at)
  values
    (v_id, v_user, v_season, v_code, md5(v_id::text || v_code), v_expires);

  -- Hosting is participation too: +10 water for the host's farm.
  insert into public.farms (user_id, season_id)
  values (v_user, v_season)
  on conflict (user_id, season_id) do nothing;

  select f.id into v_farm
  from public.farms f where f.user_id = v_user and f.season_id = v_season;

  if not exists (select 1 from public.trees t
                 where t.farm_id = v_farm and t.created_reason = 'starter') then
    insert into public.trees (farm_id, user_id, season_id, created_reason)
    values (v_farm, v_user, v_season, 'starter');
  end if;

  update public.farms set water_count = water_count + c_host_water
    where id = v_farm;

  return query select v_id, v_code, v_expires, false, c_host_water;
end;
$$;

revoke execute on function public.start_meeting() from public;
revoke execute on function public.start_meeting() from anon;
grant execute on function public.start_meeting() to authenticated;

-- ----------------------------------------------------------------------------
-- 3a. Award visibility: public-profile farmers' medals/badges are readable
-- ----------------------------------------------------------------------------
drop policy "user_medals: read own or as admin" on public.user_medals;
create policy "user_medals: own, admin, or public-profile owner"
  on public.user_medals for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.profiles p
      where p.user_id = user_medals.user_id
        and p.leaderboard_visibility = 'public'
        and not p.is_banned
    )
  );

drop policy "user_badges: read own or as admin" on public.user_badges;
create policy "user_badges: own, admin, or public-profile owner"
  on public.user_badges for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.profiles p
      where p.user_id = user_badges.user_id
        and p.leaderboard_visibility = 'public'
        and not p.is_banned
    )
  );

-- ----------------------------------------------------------------------------
-- 3b. get_leaderboard v2: include won medals/badges for public rows (+ self)
-- ----------------------------------------------------------------------------
drop function public.get_leaderboard();

create or replace function public.get_leaderboard()
returns table (
  rank bigint,
  username text,
  display_name text,
  avatar_config jsonb,
  fruit_total integer,
  visibility text,
  is_self boolean,
  medals jsonb,
  badges jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with ranked as (
    select
      f.user_id,
      f.fruit_total,
      p.username,
      p.display_name,
      p.avatar_config,
      p.leaderboard_visibility,
      rank() over (order by f.fruit_total desc) as rnk
    from public.farms f
    join public.profiles p on p.user_id = f.user_id
    join public.seasons s on s.id = f.season_id and s.status = 'active'
    where not p.is_banned
      and (p.leaderboard_visibility in ('public', 'anonymous')
           or f.user_id = auth.uid())
  )
  select
    rnk,
    case when leaderboard_visibility = 'public' or user_id = auth.uid()
         then username else null end,
    case when leaderboard_visibility = 'public' or user_id = auth.uid()
         then display_name else null end,
    case when leaderboard_visibility = 'public' or user_id = auth.uid()
         then avatar_config else '{}'::jsonb end,
    fruit_total,
    leaderboard_visibility,
    user_id = auth.uid(),
    -- Won medals/badges: shown only for public identities (and yourself).
    case when leaderboard_visibility = 'public' or user_id = auth.uid()
      then coalesce(
        (select jsonb_agg(m.medal_type order by m.awarded_at desc)
          from public.user_medals m where m.user_id = ranked.user_id),
        '[]'::jsonb)
      else '[]'::jsonb end,
    case when leaderboard_visibility = 'public' or user_id = auth.uid()
      then coalesce(
        (select jsonb_agg(jsonb_build_object('icon', bd.icon, 'name', bd.name)
                          order by ub.awarded_at desc)
          from public.user_badges ub
          join public.badge_definitions bd on bd.id = ub.badge_definition_id
          where ub.user_id = ranked.user_id),
        '[]'::jsonb)
      else '[]'::jsonb end
  from ranked
  order by rnk, username nulls last;
$$;

revoke execute on function public.get_leaderboard() from public;
revoke execute on function public.get_leaderboard() from anon;
grant execute on function public.get_leaderboard() to authenticated;
