-- ============================================================================
-- 1. GENERIC LOCATION PRESENCE (the standard for every location going forward)
--
--    community_garden_presence was event-scoped, so only the garden could show
--    other players. location_presence keys on a plain location string instead
--    ('garden', 'store', …), so any scene can ping it and list the neighbors
--    who are there right now. Privacy rules are unchanged: public → username +
--    avatar, anonymous → "A neighbor" (no avatar), hidden → never listed.
--
--    Greetings move with it: neighbor_greetings replaces garden_greetings and
--    records one greeting per (greeter, target, location, day). Reward stays
--    10 water — a multiple of 5, per the app-wide water rule.
--
-- 2. CHECKLIST COIN REWARDS
--    checklist_definitions gains coin_reward. This becomes the ONLY coin
--    source for a completed goal — recompute_checklists no longer applies the
--    generic coin_bonus_for(fertilizer) bonus to checklists, so coins can't
--    double-pay. Existing goals are backfilled to exactly what the old bonus
--    rule granted them (fertilizer → coin_bonus_fertilizer, else 0), so live
--    payouts don't change until an admin edits them.
--
-- 3. MUSIC PREFERENCE
--    profiles.music_enabled — background music on/off, per account.
--
-- ECONOMY unchanged: no Fruits are awarded anywhere here.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. location_presence + neighbor_greetings
-- ----------------------------------------------------------------------------
create table public.location_presence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  location_key text not null check (location_key in ('garden', 'store')),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint location_presence_once unique (user_id, location_key)
);
create index location_presence_recent_idx
  on public.location_presence (location_key, last_seen_at desc);

create trigger location_presence_set_updated_at
  before update on public.location_presence
  for each row execute function public.set_updated_at();

create table public.neighbor_greetings (
  id uuid primary key default gen_random_uuid(),
  greeter_user_id uuid not null references auth.users (id) on delete cascade,
  target_user_id uuid not null references auth.users (id) on delete cascade,
  location_key text not null,
  greeted_on_date date not null default current_date,
  water_awarded integer not null default 10 check (water_awarded % 5 = 0),
  created_at timestamptz not null default now(),
  constraint neighbor_greetings_daily
    unique (greeter_user_id, target_user_id, location_key, greeted_on_date)
);

alter table public.location_presence enable row level security;
alter table public.neighbor_greetings enable row level security;

create policy "location_presence: own or admin"
  on public.location_presence for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy "neighbor_greetings: own or admin"
  on public.neighbor_greetings for select to authenticated
  using (greeter_user_id = auth.uid() or target_user_id = auth.uid() or public.is_admin());

-- Who else is here? Privacy applied server-side; never exposes user_ids.
create or replace function public.location_presence_list(p_location text, p_exclude uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(entry order by entry->>'key'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'key', pr.id,
      'name', case
        when public.game_setting_text('garden_show_names', 'true')::boolean
             and p.leaderboard_visibility = 'public'
          then p.username
        else 'A neighbor' end,
      'avatar_sprite', case
        when public.game_setting_text('garden_show_names', 'true')::boolean
             and p.leaderboard_visibility = 'public'
          then p.avatar_config ->> 'sprite'
        else null end
    ) as entry
    from public.location_presence pr
    join public.profiles p on p.user_id = pr.user_id
    where pr.location_key = p_location
      and pr.user_id <> p_exclude
      and pr.last_seen_at > now() - interval '5 minutes'
      and not p.is_banned
      and p.leaderboard_visibility <> 'hidden'
    limit 8
  ) entries;
$$;

revoke execute on function public.location_presence_list(text, uuid) from public, anon, authenticated;

-- "I'm here" heartbeat. Called every 60s while a location scene is open.
create or replace function public.ping_location_presence(p_location text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_location not in ('garden', 'store') then raise exception 'UNKNOWN_LOCATION'; end if;

  insert into public.location_presence (user_id, location_key, last_seen_at)
    values (v_user, p_location, now())
  on conflict (user_id, location_key) do update set last_seen_at = now();

  -- leaving one place clears your presence anywhere else
  update public.location_presence
    set last_seen_at = now() - interval '10 minutes'
    where user_id = v_user and location_key <> p_location;

  return jsonb_build_object(
    'others', public.location_presence_list(p_location, v_user));
end;
$$;

revoke execute on function public.ping_location_presence(text) from public, anon;
grant execute on function public.ping_location_presence(text) to authenticated;

-- Say hi to a neighbor anywhere. +10 water (multiple of 5), once per person
-- per location per day. Presence never affects event rewards.
create or replace function public.greet_neighbor(p_presence uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_banned boolean;
  v_target uuid;
  v_location text;
  v_last timestamptz;
  v_season uuid;
  v_water integer := 10;  -- always a multiple of 5
begin
  if v_user is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select is_banned into v_banned from public.profiles where user_id = v_user;
  if v_banned is null then raise exception 'NO_PROFILE'; end if;
  if v_banned then raise exception 'BANNED'; end if;

  select user_id, location_key, last_seen_at
    into v_target, v_location, v_last
  from public.location_presence where id = p_presence;
  if v_target is null then raise exception 'NEIGHBOR_NOT_FOUND'; end if;
  if v_target = v_user then raise exception 'CANNOT_GREET_SELF'; end if;
  if v_last < now() - interval '5 minutes' then raise exception 'NEIGHBOR_LEFT'; end if;

  begin
    insert into public.neighbor_greetings
      (greeter_user_id, target_user_id, location_key, water_awarded)
      values (v_user, v_target, v_location, v_water);
  exception
    when unique_violation then
      raise exception 'ALREADY_GREETED_TODAY';
  end;

  select id into v_season from public.seasons where status = 'active' order by ends_at limit 1;
  if v_season is not null then
    update public.farms set water_count = water_count + v_water
      where user_id = v_user and season_id = v_season;
  end if;

  return jsonb_build_object('water_earned', v_water);
end;
$$;

revoke execute on function public.greet_neighbor(uuid) from public, anon;
grant execute on function public.greet_neighbor(uuid) to authenticated;

-- The garden reads the shared presence table now.
create or replace function public.get_community_garden_state()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  e record;
  v_last record;
  v_my_water integer;
  v_my_seed integer;
  v_my_fert integer;
  v_today_water integer;
  v_today_seed integer;
  v_today_fert integer;
  v_my_rewards jsonb;
begin
  if v_user is null then raise exception 'NOT_AUTHENTICATED'; end if;

  v_id := public.create_or_get_current_community_garden();

  if v_id is null then
    select * into v_last from public.community_garden_events
      order by starts_at desc limit 1;
    if v_last.id is not null then
      select coalesce(jsonb_agg(jsonb_build_object(
               'reward_type', reward_type, 'amount', amount, 'reward_kind', reward_kind)), '[]'::jsonb)
        into v_my_rewards
      from public.community_garden_rewards
      where event_id = v_last.id and user_id = v_user;
    end if;
    return jsonb_build_object(
      'enabled', public.game_setting_text('garden_enabled', 'true')::boolean,
      'has_event', false,
      'last_event', case when v_last.id is null then null else jsonb_build_object(
        'event_id', v_last.id,
        'status', v_last.status,
        'ends_at', v_last.ends_at,
        'progress_percent', public.garden_progress_percent(v_last.id),
        'my_rewards', coalesce(v_my_rewards, '[]'::jsonb)) end);
  end if;

  select * into e from public.community_garden_events where id = v_id;

  select coalesce(sum(water_amount), 0), coalesce(sum(seed_amount), 0),
         coalesce(sum(fertilizer_amount), 0)
    into v_my_water, v_my_seed, v_my_fert
  from public.community_garden_contributions
  where event_id = e.id and user_id = v_user;

  select coalesce(sum(water_amount), 0), coalesce(sum(seed_amount), 0),
         coalesce(sum(fertilizer_amount), 0)
    into v_today_water, v_today_seed, v_today_fert
  from public.community_garden_contributions
  where event_id = e.id and user_id = v_user and contributed_on_date = current_date;

  select coalesce(jsonb_agg(jsonb_build_object(
           'reward_type', reward_type, 'amount', amount, 'reward_kind', reward_kind)), '[]'::jsonb)
    into v_my_rewards
  from public.community_garden_rewards
  where event_id = e.id and user_id = v_user;

  return jsonb_build_object(
    'enabled', public.game_setting_text('garden_enabled', 'true')::boolean,
    'has_event', true,
    'event_id', e.id,
    'status', e.status,
    'starts_at', e.starts_at,
    'ends_at', e.ends_at,
    'required_water', e.required_water,
    'required_seeds', e.required_seeds,
    'required_fertilizer', e.required_fertilizer,
    'current_water', e.current_water,
    'current_seeds', e.current_seeds,
    'current_fertilizer', e.current_fertilizer,
    'progress_percent', public.garden_progress_percent(e.id),
    'completed', e.status = 'completed',
    'i_contributed', (v_my_water + v_my_seed + v_my_fert) > 0,
    'my_water', v_my_water,
    'my_seed', v_my_seed,
    'my_fertilizer', v_my_fert,
    'today_water_left', greatest(greatest(public.game_setting_int('garden_daily_water_limit', 50), 0) - v_today_water, 0),
    'today_seed_left', greatest(greatest(public.game_setting_int('garden_daily_seed_limit', 3), 0) - v_today_seed, 0),
    'today_fertilizer_left', greatest(greatest(public.game_setting_int('garden_daily_fertilizer_limit', 3), 0) - v_today_fert, 0),
    'my_rewards', v_my_rewards,
    'others', public.location_presence_list('garden', v_user));
end;
$$;

revoke execute on function public.get_community_garden_state() from public, anon;
grant execute on function public.get_community_garden_state() to authenticated;

-- Retire the garden-only presence/greeting paths.
drop function if exists public.ping_community_garden_presence();
drop function if exists public.greet_garden_neighbor(uuid);
drop function if exists public.garden_presence_list(uuid, uuid);
drop table if exists public.garden_greetings;
drop table if exists public.community_garden_presence;

-- ----------------------------------------------------------------------------
-- 2. Checklist coin rewards
-- ----------------------------------------------------------------------------
alter table public.checklist_definitions
  add column if not exists coin_reward integer not null default 0
    constraint checklist_definitions_coin_reward_check check (coin_reward >= 0);

-- Backfill to exactly what the old automatic bonus granted, so nothing changes
-- for players until an admin edits a goal.
update public.checklist_definitions
  set coin_reward = greatest(public.game_setting_int('coin_bonus_fertilizer', 10), 0)
  where fertilizer_reward > 0;

drop function if exists public.get_my_checklist();
create function public.get_my_checklist()
returns table (
  key text, name text, description text, progress integer, target integer,
  completed boolean, water_reward integer, fertilizer_reward integer, coin_reward integer
)
language sql
stable
security definer
set search_path = public
as $$
  with s as (select id from public.seasons where status = 'active' limit 1)
  select
    d.key,
    d.name,
    d.description,
    coalesce(p.progress_value, 0),
    coalesce((d.config->>'target')::int, 1),
    (p.completed_at is not null),
    d.water_reward,
    d.fertilizer_reward,
    d.coin_reward
  from public.season_checklist_goals sg
  join public.checklist_definitions d on d.id = sg.checklist_definition_id
  left join public.user_checklist_progress p
    on p.checklist_definition_id = d.id
   and p.user_id = auth.uid()
   and p.season_id = sg.season_id
  where sg.season_id = (select id from s)
  order by d.sort_order;
$$;

revoke execute on function public.get_my_checklist() from public, anon;
grant execute on function public.get_my_checklist() to authenticated;

-- Goals now pay their OWN coin_reward (the generic fertilizer coin bonus no
-- longer applies here — that would double-pay).
create or replace function public.recompute_checklists(p_user uuid, p_season uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_farm uuid;
  d record;
  v_val integer;
  v_target integer;
  v_completed boolean;
  v_claimed timestamptz;
begin
  select id into v_farm from public.farms
    where user_id = p_user and season_id = p_season;
  if v_farm is null then
    return;
  end if;

  for d in
    select cd.*
    from public.season_checklist_goals sg
    join public.checklist_definitions cd on cd.id = sg.checklist_definition_id
    where sg.season_id = p_season
  loop
    v_target := coalesce((d.config->>'target')::int, 1);
    v_val := case d.rule_type
      when 'meeting_count' then
        (select count(*) from public.meeting_attendance
          where attendee_user_id = p_user and season_id = p_season)
      when 'distinct_hosts' then
        (select count(distinct host_user_id) from public.meeting_attendance
          where attendee_user_id = p_user and season_id = p_season)
      when 'seed_given_count' then
        (select count(*) from public.seed_events
          where giver_user_id = p_user and season_id = p_season)
      when 'seed_received_count' then
        (select count(*) from public.seed_events
          where receiver_user_id = p_user and season_id = p_season)
      when 'weekly_meeting' then
        (select count(*) from public.meeting_attendance
          where attendee_user_id = p_user and season_id = p_season
            and attended_at >= date_trunc('week', now()))
      else 0
    end;
    v_completed := v_val >= v_target;

    insert into public.user_checklist_progress
      (user_id, season_id, checklist_definition_id, progress_value, completed_at)
    values
      (p_user, p_season, d.id, v_val,
       case when v_completed then now() else null end)
    on conflict (user_id, season_id, checklist_definition_id) do update
      set progress_value = excluded.progress_value,
          completed_at = coalesce(
            public.user_checklist_progress.completed_at, excluded.completed_at);

    select reward_claimed_at into v_claimed
    from public.user_checklist_progress
    where user_id = p_user and season_id = p_season
      and checklist_definition_id = d.id;

    if v_completed and v_claimed is null then
      if d.water_reward > 0 then
        update public.farms set water_count = water_count + d.water_reward
          where id = v_farm;
      end if;
      if d.fertilizer_reward > 0 then
        update public.farms set fertilizer_count = fertilizer_count + d.fertilizer_reward
          where id = v_farm;
        insert into public.fertilizer_events (user_id, season_id, amount, reason)
        values (p_user, p_season, d.fertilizer_reward, 'checklist_reward');
      end if;
      -- the goal's OWN coin reward (no generic bonus stacking)
      if d.coin_reward > 0 then
        perform public.grant_coins(p_user, p_season, d.coin_reward, 'checklist_reward');
      end if;
      update public.user_checklist_progress set reward_claimed_at = now()
        where user_id = p_user and season_id = p_season
          and checklist_definition_id = d.id;
    end if;
  end loop;
end;
$$;

-- Admin editor gains the coin field (water still validated as a multiple of 5).
drop function if exists public.update_checklist_reward(uuid, integer, integer);
create function public.update_checklist_reward(
  p_definition_id uuid, p_water integer, p_fertilizer integer, p_coins integer default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_old_water integer;
  v_old_fert integer;
  v_old_coins integer;
begin
  if not public.is_admin() then
    raise exception 'NOT_ADMIN';
  end if;
  if p_water is null or p_fertilizer is null or p_coins is null
     or p_water < 0 or p_fertilizer < 0 or p_coins < 0 then
    raise exception 'NEGATIVE_NOT_ALLOWED';
  end if;
  if p_water % 5 <> 0 then
    raise exception 'WATER_MULTIPLE_OF_5';
  end if;

  select key, water_reward, fertilizer_reward, coin_reward
    into v_key, v_old_water, v_old_fert, v_old_coins
  from public.checklist_definitions where id = p_definition_id;
  if v_key is null then
    raise exception 'GOAL_NOT_FOUND';
  end if;

  update public.checklist_definitions
    set water_reward = p_water, fertilizer_reward = p_fertilizer, coin_reward = p_coins
    where id = p_definition_id;

  insert into public.admin_audit_logs (actor_user_id, action, metadata_json)
  values (auth.uid(), 'checklist_reward_updated',
          jsonb_build_object(
            'goal_id', p_definition_id, 'key', v_key,
            'old', jsonb_build_object('water', v_old_water, 'fertilizer', v_old_fert, 'coins', v_old_coins),
            'new', jsonb_build_object('water', p_water, 'fertilizer', p_fertilizer, 'coins', p_coins)));
end;
$$;

revoke execute on function public.update_checklist_reward(uuid, integer, integer, integer) from public, anon;
grant execute on function public.update_checklist_reward(uuid, integer, integer, integer) to authenticated;

-- The admin list shows the coin column too.
drop function if exists public.list_admin_checklist_goals();
create function public.list_admin_checklist_goals()
returns table (
  id uuid, key text, name text, description text,
  water_reward integer, fertilizer_reward integer, coin_reward integer,
  active boolean, sort_order integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  return query
    select d.id, d.key, d.name, d.description,
      d.water_reward, d.fertilizer_reward, d.coin_reward, d.active, d.sort_order
    from public.checklist_definitions d
    order by d.sort_order;
end;
$$;

revoke execute on function public.list_admin_checklist_goals() from public, anon;
grant execute on function public.list_admin_checklist_goals() to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Music preference (per account)
-- ----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists music_enabled boolean not null default true;
