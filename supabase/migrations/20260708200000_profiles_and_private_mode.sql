-- ============================================================================
-- Phase 4: Profiles and Private Mode — server-side helpers
--
-- 1. ensure_active_season(): creates the current month's Season on demand,
--    so the app always has an active Season to attach farms to.
-- 2. handle_new_profile trigger: when a profile is created, give the user
--    their farm + starter tree for the active Season (all server-side).
-- 3. get_leaderboard(): the ONLY way clients read the leaderboard.
--    Enforces Private Mode in the database:
--      - banned users excluded
--      - hidden users excluded (except from their own view)
--      - anonymous users have username/avatar stripped for everyone else
-- ============================================================================

create or replace function public.ensure_active_season()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.seasons where status = 'active' limit 1;
  if v_id is null then
    insert into public.seasons (name, starts_at, ends_at, status)
    values (
      trim(to_char(now(), 'FMMonth YYYY')),
      date_trunc('month', now()),
      date_trunc('month', now()) + interval '1 month',
      'active'
    )
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

revoke execute on function public.ensure_active_season() from public;
revoke execute on function public.ensure_active_season() from anon;
revoke execute on function public.ensure_active_season() from authenticated;

-- When a new profile is created, set up their farm + starter tree.
create or replace function public.handle_new_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season uuid;
  v_farm uuid;
begin
  v_season := public.ensure_active_season();

  insert into public.farms (user_id, season_id)
  values (new.user_id, v_season)
  on conflict (user_id, season_id) do nothing
  returning id into v_farm;

  if v_farm is not null then
    insert into public.trees (farm_id, user_id, season_id, created_reason)
    values (v_farm, new.user_id, v_season, 'starter');
  end if;

  return new;
end;
$$;

create trigger profiles_handle_new
  after insert on public.profiles
  for each row execute function public.handle_new_profile();

-- The leaderboard, with Private Mode enforced at the database level.
create or replace function public.get_leaderboard()
returns table (
  rank bigint,
  username text,
  display_name text,
  avatar_config jsonb,
  fruit_total integer,
  visibility text,
  is_self boolean
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
      -- hidden users never appear publicly; they only see themselves
      and (p.leaderboard_visibility in ('public', 'anonymous')
           or f.user_id = auth.uid())
  )
  select
    rnk,
    -- anonymous/hidden identity is stripped for everyone except the user
    case when leaderboard_visibility = 'public' or user_id = auth.uid()
         then username else null end,
    case when leaderboard_visibility = 'public' or user_id = auth.uid()
         then display_name else null end,
    case when leaderboard_visibility = 'public' or user_id = auth.uid()
         then avatar_config else '{}'::jsonb end,
    fruit_total,
    leaderboard_visibility,
    user_id = auth.uid()
  from ranked
  order by rnk, username nulls last;
$$;

revoke execute on function public.get_leaderboard() from public;
revoke execute on function public.get_leaderboard() from anon;
grant execute on function public.get_leaderboard() to authenticated;
