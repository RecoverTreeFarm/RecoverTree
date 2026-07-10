-- ============================================================================
-- Community Garden — a collaborative shared event.
--
-- The whole group contributes Water, Seeds, and Fertilizer toward ONE shared
-- garden (a giant community tree). No passing, no winners, no leaderboard.
-- If every goal is met before the timer runs out, every contributor receives
-- a Garden Share Bundle. Optionally (admin setting, OFF by default) a small
-- partial reward goes out when the garden reaches at least a threshold of
-- combined progress.
--
-- ECONOMY: contributions SPEND water/seed/fertilizer; rewards PAY only
-- water/seed/fertilizer — NEVER Fruits. (Coins do not exist in this app, so
-- no coin rewards.) All writes go through SECURITY DEFINER functions; the
-- tables are not client-writable.
--
-- Scheduling: 'weekly' (default) auto-starts one event per ISO week (Monday)
-- and ends it Sunday night; 'manual' events are started/ended by an admin.
-- TODO(garden-monthly): a 'monthly' frequency is not implemented yet.
--
-- ⚠️ update_game_settings is recreated below as v7 = the v6 arrays from
-- 20260709180000 COPIED VERBATIM + the garden keys. Per the project's
-- migration ordering rule: never apply an older version of this function on
-- top; future recreations must copy THESE arrays first.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. fertilizer ledger: garden reasons
-- ----------------------------------------------------------------------------
alter table public.fertilizer_events drop constraint fertilizer_events_reason_check;
alter table public.fertilizer_events
  add constraint fertilizer_events_reason_check
  check (reason in
    ('medal_reward', 'badge_reward', 'checklist_reward', 'used_on_tree',
     'admin_adjustment', 'basket_contribution', 'basket_reward', 'golden_goose',
     'garden_contribution', 'garden_reward'));

-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------
create table public.community_garden_events (
  id uuid primary key default gen_random_uuid(),
  season_id uuid references public.seasons (id) on delete set null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  status text not null default 'active'
    check (status in ('active', 'completed', 'expired', 'cancelled')),
  required_water integer not null check (required_water >= 1),
  required_seeds integer not null check (required_seeds >= 1),
  required_fertilizer integer not null check (required_fertilizer >= 1),
  current_water integer not null default 0 check (current_water >= 0),
  current_seeds integer not null default 0 check (current_seeds >= 0),
  current_fertilizer integer not null default 0 check (current_fertilizer >= 0),
  completed_at timestamptz,
  rewards_distributed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- only one garden may be active at a time
create unique index community_garden_one_active
  on public.community_garden_events ((true))
  where status = 'active';
create index community_garden_events_starts_idx
  on public.community_garden_events (starts_at desc);

create trigger community_garden_events_set_updated_at
  before update on public.community_garden_events
  for each row execute function public.set_updated_at();

create table public.community_garden_contributions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.community_garden_events (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  water_amount integer not null default 0 check (water_amount >= 0),
  seed_amount integer not null default 0 check (seed_amount >= 0),
  fertilizer_amount integer not null default 0 check (fertilizer_amount >= 0),
  contributed_on_date date not null default current_date,
  created_at timestamptz not null default now()
);
create index community_garden_contributions_daily_idx
  on public.community_garden_contributions (event_id, user_id, contributed_on_date);

create table public.community_garden_rewards (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.community_garden_events (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  reward_type text not null check (reward_type in ('seed', 'water', 'fertilizer')),
  amount integer not null check (amount > 0),
  reward_kind text not null check (reward_kind in ('completion', 'partial')),
  created_at timestamptz not null default now(),
  -- belt & braces on top of the rewards_distributed_at guard
  constraint community_garden_rewards_once unique (event_id, user_id, reward_type, reward_kind)
);
create index community_garden_rewards_user_idx
  on public.community_garden_rewards (user_id, created_at desc);

create table public.community_garden_presence (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.community_garden_events (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint community_garden_presence_once unique (event_id, user_id)
);

create trigger community_garden_presence_set_updated_at
  before update on public.community_garden_presence
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. RLS — events are readable; you see only YOUR contributions/rewards.
--    Presence is never read directly (the state function applies privacy).
-- ----------------------------------------------------------------------------
alter table public.community_garden_events enable row level security;
alter table public.community_garden_contributions enable row level security;
alter table public.community_garden_rewards enable row level security;
alter table public.community_garden_presence enable row level security;

create policy "garden_events: readable by members"
  on public.community_garden_events for select to authenticated using (true);
create policy "garden_contributions: own or admin"
  on public.community_garden_contributions for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy "garden_rewards: own or admin"
  on public.community_garden_rewards for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy "garden_presence: own or admin"
  on public.community_garden_presence for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ----------------------------------------------------------------------------
-- 3. Progress helper: combined percent across the three goals (each capped).
-- ----------------------------------------------------------------------------
create or replace function public.garden_progress_percent(p_event uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select round((
      least(current_water::numeric / required_water, 1)
    + least(current_seeds::numeric / required_seeds, 1)
    + least(current_fertilizer::numeric / required_fertilizer, 1)
  ) / 3 * 100, 1)
  from public.community_garden_events where id = p_event;
$$;

revoke execute on function public.garden_progress_percent(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. garden_credit: pay water/seed/fertilizer (NEVER Fruits) + record it.
-- ----------------------------------------------------------------------------
create or replace function public.garden_credit(
  p_event uuid, p_user uuid, p_season uuid, p_type text, p_amount integer, p_kind text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_amount is null or p_amount <= 0 then return; end if;
  insert into public.farms (user_id, season_id) values (p_user, p_season)
    on conflict (user_id, season_id) do nothing;

  if p_type = 'water' then
    update public.farms set water_count = water_count + p_amount
      where user_id = p_user and season_id = p_season;
  elsif p_type = 'seed' then
    update public.farms set seed_count = seed_count + p_amount
      where user_id = p_user and season_id = p_season;
  elsif p_type = 'fertilizer' then
    update public.farms set fertilizer_count = fertilizer_count + p_amount
      where user_id = p_user and season_id = p_season;
    insert into public.fertilizer_events (user_id, season_id, amount, reason)
      values (p_user, p_season, p_amount, 'garden_reward');
  else
    raise exception 'INVALID_REWARD_TYPE: %', p_type;
  end if;

  insert into public.community_garden_rewards (event_id, user_id, reward_type, amount, reward_kind)
    values (p_event, p_user, p_type, p_amount, p_kind)
  on conflict (event_id, user_id, reward_type, reward_kind) do nothing;
end;
$$;

revoke execute on function public.garden_credit(uuid, uuid, uuid, text, integer, text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. garden_distribute_rewards: pay every contributor once (idempotent).
-- ----------------------------------------------------------------------------
create or replace function public.garden_distribute_rewards(p_event uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  e record;
  r record;
  v_season uuid;
  v_water integer;
  v_seeds integer;
  v_fert integer;
begin
  select * into e from public.community_garden_events where id = p_event for update;
  if e.id is null or e.rewards_distributed_at is not null then return; end if;

  perform public.ensure_active_season();
  select id into v_season from public.seasons where status = 'active' order by ends_at limit 1;
  if v_season is null then return; end if;

  if p_kind = 'completion' then
    v_water := greatest(public.game_setting_int('garden_reward_water', 25), 0);
    v_seeds := greatest(public.game_setting_int('garden_reward_seeds', 2), 0);
    v_fert  := greatest(public.game_setting_int('garden_reward_fertilizer', 1), 0);
  else
    v_water := greatest(public.game_setting_int('garden_partial_reward_water', 10), 0);
    v_seeds := 0;
    v_fert  := 0;
  end if;

  -- everyone who contributed at least once (and is still active)
  for r in
    select distinct c.user_id
    from public.community_garden_contributions c
    join public.profiles p on p.user_id = c.user_id and not p.is_banned
    where c.event_id = p_event
      and (c.water_amount > 0 or c.seed_amount > 0 or c.fertilizer_amount > 0)
  loop
    perform public.garden_credit(p_event, r.user_id, v_season, 'water', v_water, p_kind);
    perform public.garden_credit(p_event, r.user_id, v_season, 'seed', v_seeds, p_kind);
    perform public.garden_credit(p_event, r.user_id, v_season, 'fertilizer', v_fert, p_kind);
  end loop;

  update public.community_garden_events
    set rewards_distributed_at = now()
    where id = p_event;
end;
$$;

revoke execute on function public.garden_distribute_rewards(uuid, text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6. garden_finish_event: close an event whose time is up (or admin-ended).
-- ----------------------------------------------------------------------------
create or replace function public.garden_finish_event(p_event uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  e record;
  v_pct numeric;
  v_partial_on boolean := public.game_setting_text('garden_partial_reward_enabled', 'false')::boolean;
  v_threshold numeric := public.game_setting_int('garden_partial_threshold_percent', 50);
begin
  select * into e from public.community_garden_events where id = p_event for update;
  if e.id is null or e.status <> 'active' then return; end if;

  if e.current_water >= e.required_water
     and e.current_seeds >= e.required_seeds
     and e.current_fertilizer >= e.required_fertilizer then
    update public.community_garden_events
      set status = 'completed', completed_at = coalesce(completed_at, now())
      where id = p_event;
    perform public.garden_distribute_rewards(p_event, 'completion');
    return;
  end if;

  update public.community_garden_events set status = 'expired' where id = p_event;

  v_pct := public.garden_progress_percent(p_event);
  if v_partial_on and v_pct >= v_threshold then
    perform public.garden_distribute_rewards(p_event, 'partial');
  end if;
end;
$$;

revoke execute on function public.garden_finish_event(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7. create_or_get_current_community_garden: expire overdue events; auto-start
--    the weekly event (Monday → Sunday). 'manual' events start via admin only.
-- ----------------------------------------------------------------------------
create or replace function public.create_or_get_current_community_garden()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_enabled boolean := public.game_setting_text('garden_enabled', 'true')::boolean;
  v_freq text := public.game_setting_text('garden_frequency', 'weekly');
  v_week_start timestamptz := date_trunc('week', now());
  v_season uuid;
  r record;
begin
  -- close anything overdue first (idempotent)
  for r in
    select id from public.community_garden_events
    where status = 'active' and now() >= ends_at
  loop
    perform public.garden_finish_event(r.id);
  end loop;

  select id into v_id from public.community_garden_events where status = 'active' limit 1;
  if v_id is not null then return v_id; end if;

  if not v_enabled or v_freq <> 'weekly' then return null; end if;

  -- one event per week: if this week's event already ran (completed early,
  -- expired, or was cancelled), the garden rests until Monday
  if exists (
    select 1 from public.community_garden_events
    where starts_at >= v_week_start
  ) then
    return null;
  end if;

  select id into v_season from public.seasons where status = 'active' order by ends_at limit 1;

  begin
    insert into public.community_garden_events
      (season_id, starts_at, ends_at, required_water, required_seeds, required_fertilizer)
    values (
      v_season, now(), v_week_start + interval '7 days',
      greatest(public.game_setting_int('garden_required_water', 250), 1),
      greatest(public.game_setting_int('garden_required_seeds', 25), 1),
      greatest(public.game_setting_int('garden_required_fertilizer', 25), 1)
    )
    returning id into v_id;
  exception
    when unique_violation then
      select id into v_id from public.community_garden_events where status = 'active' limit 1;
  end;

  return v_id;
end;
$$;

revoke execute on function public.create_or_get_current_community_garden() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 8. contribute_to_community_garden: atomic, validated, daily-limited.
--    NO total per-event limits — later days of the same event are fine.
-- ----------------------------------------------------------------------------
create or replace function public.contribute_to_community_garden(
  p_water integer, p_seed integer, p_fertilizer integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_water integer := coalesce(p_water, 0);
  v_seed integer := coalesce(p_seed, 0);
  v_fert integer := coalesce(p_fertilizer, 0);
  v_banned boolean;
  v_visibility text;
  v_private_ok boolean := public.game_setting_text('garden_private_users_can_contribute', 'true')::boolean;
  e record;
  v_season uuid;
  f record;
  v_today_water integer;
  v_today_seed integer;
  v_today_fert integer;
  v_lim_water integer := greatest(public.game_setting_int('garden_daily_water_limit', 50), 0);
  v_lim_seed integer := greatest(public.game_setting_int('garden_daily_seed_limit', 3), 0);
  v_lim_fert integer := greatest(public.game_setting_int('garden_daily_fertilizer_limit', 3), 0);
  v_completed boolean := false;
begin
  if v_user is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select is_banned, leaderboard_visibility into v_banned, v_visibility
    from public.profiles where user_id = v_user;
  if v_banned is null then raise exception 'NO_PROFILE'; end if;
  if v_banned then raise exception 'BANNED'; end if;
  if not v_private_ok and v_visibility <> 'public' then
    raise exception 'PRIVATE_CONTRIBUTIONS_DISABLED';
  end if;

  if v_water < 0 or v_seed < 0 or v_fert < 0 then raise exception 'NEGATIVE_NOT_ALLOWED'; end if;
  if v_water + v_seed + v_fert = 0 then raise exception 'MUST_ADD_ITEM'; end if;

  select * into e from public.community_garden_events
    where status = 'active' limit 1
    for update;
  if e.id is null then raise exception 'NO_ACTIVE_GARDEN'; end if;
  if now() >= e.ends_at then raise exception 'GARDEN_ENDED'; end if;
  if e.current_water >= e.required_water
     and e.current_seeds >= e.required_seeds
     and e.current_fertilizer >= e.required_fertilizer then
    raise exception 'GARDEN_COMPLETE';
  end if;

  -- daily limits (per user, per event, per calendar date)
  select coalesce(sum(water_amount), 0), coalesce(sum(seed_amount), 0),
         coalesce(sum(fertilizer_amount), 0)
    into v_today_water, v_today_seed, v_today_fert
  from public.community_garden_contributions
  where event_id = e.id and user_id = v_user and contributed_on_date = current_date;

  if v_today_water + v_water > v_lim_water
     or v_today_seed + v_seed > v_lim_seed
     or v_today_fert + v_fert > v_lim_fert then
    raise exception 'DAILY_LIMIT_EXCEEDED';
  end if;

  -- inventory (current-season farm), deducted atomically
  select id into v_season from public.seasons where status = 'active' order by ends_at limit 1;
  if v_season is null then raise exception 'NO_FARM'; end if;
  select * into f from public.farms
    where user_id = v_user and season_id = v_season
    for update;
  if f.id is null then raise exception 'NO_FARM'; end if;
  if f.water_count < v_water or f.seed_count < v_seed or f.fertilizer_count < v_fert then
    raise exception 'NOT_ENOUGH_ITEMS';
  end if;

  update public.farms
    set water_count = water_count - v_water,
        seed_count = seed_count - v_seed,
        fertilizer_count = fertilizer_count - v_fert
    where id = f.id;
  if v_fert > 0 then
    insert into public.fertilizer_events (user_id, season_id, amount, reason)
      values (v_user, v_season, -v_fert, 'garden_contribution');
  end if;

  insert into public.community_garden_contributions
    (event_id, user_id, water_amount, seed_amount, fertilizer_amount)
    values (e.id, v_user, v_water, v_seed, v_fert);

  update public.community_garden_events
    set current_water = current_water + v_water,
        current_seeds = current_seeds + v_seed,
        current_fertilizer = current_fertilizer + v_fert
    where id = e.id
    returning * into e;

  -- all three goals met → the garden blooms; contributors get their bundle
  if e.current_water >= e.required_water
     and e.current_seeds >= e.required_seeds
     and e.current_fertilizer >= e.required_fertilizer then
    update public.community_garden_events
      set status = 'completed', completed_at = now()
      where id = e.id;
    perform public.garden_distribute_rewards(e.id, 'completion');
    v_completed := true;
  end if;

  return jsonb_build_object(
    'contributed', true,
    'completed', v_completed,
    'current_water', e.current_water,
    'current_seeds', e.current_seeds,
    'current_fertilizer', e.current_fertilizer,
    'progress_percent', public.garden_progress_percent(e.id));
end;
$$;

revoke execute on function public.contribute_to_community_garden(integer, integer, integer) from public, anon;
grant execute on function public.contribute_to_community_garden(integer, integer, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 9. Presence. A ping marks "I'm in the garden"; the list applies privacy:
--    public → username (+ avatar), anonymous → "A neighbor", hidden → not
--    shown at all. Never exposes user_ids. Presence never affects rewards.
-- ----------------------------------------------------------------------------
create or replace function public.garden_presence_list(p_event uuid, p_exclude uuid)
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
    from public.community_garden_presence pr
    join public.profiles p on p.user_id = pr.user_id
    where pr.event_id = p_event
      and pr.user_id <> p_exclude
      and pr.last_seen_at > now() - interval '5 minutes'
      and not p.is_banned
      and p.leaderboard_visibility <> 'hidden'
    limit 8
  ) entries;
$$;

revoke execute on function public.garden_presence_list(uuid, uuid) from public, anon, authenticated;

create or replace function public.ping_community_garden_presence()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_event uuid;
begin
  if v_user is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select id into v_event from public.community_garden_events
    where status = 'active' and now() < ends_at limit 1;
  if v_event is null then
    return jsonb_build_object('has_event', false, 'others', '[]'::jsonb);
  end if;

  insert into public.community_garden_presence (event_id, user_id, last_seen_at)
    values (v_event, v_user, now())
  on conflict (event_id, user_id) do update set last_seen_at = now();

  return jsonb_build_object(
    'has_event', true,
    'others', public.garden_presence_list(v_event, v_user));
end;
$$;

revoke execute on function public.ping_community_garden_presence() from public, anon;
grant execute on function public.ping_community_garden_presence() to authenticated;

-- ----------------------------------------------------------------------------
-- 10. get_community_garden_state: everything the garden scene needs.
-- ----------------------------------------------------------------------------
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
    -- no active garden: surface the most recent finished one so the client
    -- can show "wrapped up" / reward notifications
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
    'others', public.garden_presence_list(e.id, v_user));
end;
$$;

revoke execute on function public.get_community_garden_state() from public, anon;
grant execute on function public.get_community_garden_state() to authenticated;

-- ----------------------------------------------------------------------------
-- 11. Admin: list, start, end, distribute (all is_admin-gated + audit-logged).
-- ----------------------------------------------------------------------------
create or replace function public.list_admin_community_garden()
returns table (
  id uuid, status text, starts_at timestamptz, ends_at timestamptz,
  required_water integer, required_seeds integer, required_fertilizer integer,
  current_water integer, current_seeds integer, current_fertilizer integer,
  progress_percent numeric, contributor_count bigint,
  completed_at timestamptz, rewards_distributed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  return query
    select e.id, e.status, e.starts_at, e.ends_at,
      e.required_water, e.required_seeds, e.required_fertilizer,
      e.current_water, e.current_seeds, e.current_fertilizer,
      public.garden_progress_percent(e.id),
      (select count(distinct c.user_id) from public.community_garden_contributions c
         where c.event_id = e.id),
      e.completed_at, e.rewards_distributed_at
    from public.community_garden_events e
    order by e.starts_at desc
    limit 20;
end;
$$;

revoke execute on function public.list_admin_community_garden() from public, anon;
grant execute on function public.list_admin_community_garden() to authenticated;

create or replace function public.admin_start_community_garden()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_season uuid;
  v_days integer := greatest(public.game_setting_int('garden_event_duration_days', 7), 1);
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  if exists (select 1 from public.community_garden_events where status = 'active') then
    raise exception 'GARDEN_ALREADY_ACTIVE';
  end if;

  select id into v_season from public.seasons where status = 'active' order by ends_at limit 1;

  insert into public.community_garden_events
    (season_id, starts_at, ends_at, required_water, required_seeds, required_fertilizer)
  values (
    v_season, now(), now() + make_interval(days => v_days),
    greatest(public.game_setting_int('garden_required_water', 250), 1),
    greatest(public.game_setting_int('garden_required_seeds', 25), 1),
    greatest(public.game_setting_int('garden_required_fertilizer', 25), 1)
  )
  returning id into v_id;

  insert into public.admin_audit_logs (actor_user_id, action, metadata_json)
    values (auth.uid(), 'garden_started', jsonb_build_object('event_id', v_id));
  return v_id;
end;
$$;

revoke execute on function public.admin_start_community_garden() from public, anon;
grant execute on function public.admin_start_community_garden() to authenticated;

create or replace function public.admin_end_community_garden(p_event uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_status text;
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  select status into v_status from public.community_garden_events where id = p_event;
  if v_status is null then raise exception 'NOT_FOUND'; end if;
  if v_status <> 'active' then raise exception 'NOT_ACTIVE'; end if;

  perform public.garden_finish_event(p_event);
  insert into public.admin_audit_logs (actor_user_id, action, metadata_json)
    values (auth.uid(), 'garden_ended', jsonb_build_object('event_id', p_event));
end;
$$;

revoke execute on function public.admin_end_community_garden(uuid) from public, anon;
grant execute on function public.admin_end_community_garden(uuid) to authenticated;

-- Safety valve: re-run distribution for a finished event whose rewards never
-- went out (e.g. the partial setting was flipped on after it expired).
create or replace function public.admin_distribute_garden_rewards(p_event uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  e record;
  v_partial_on boolean := public.game_setting_text('garden_partial_reward_enabled', 'false')::boolean;
  v_threshold numeric := public.game_setting_int('garden_partial_threshold_percent', 50);
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  select * into e from public.community_garden_events where id = p_event for update;
  if e.id is null then raise exception 'NOT_FOUND'; end if;
  if e.rewards_distributed_at is not null then raise exception 'ALREADY_DISTRIBUTED'; end if;

  if e.status = 'completed' then
    perform public.garden_distribute_rewards(p_event, 'completion');
  elsif e.status = 'expired' and v_partial_on
        and public.garden_progress_percent(p_event) >= v_threshold then
    perform public.garden_distribute_rewards(p_event, 'partial');
  else
    raise exception 'NOTHING_TO_DISTRIBUTE';
  end if;

  insert into public.admin_audit_logs (actor_user_id, action, metadata_json)
    values (auth.uid(), 'garden_rewards_distributed', jsonb_build_object('event_id', p_event));
end;
$$;

revoke execute on function public.admin_distribute_garden_rewards(uuid) from public, anon;
grant execute on function public.admin_distribute_garden_rewards(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 12. run_scheduled_game_jobs v2: + garden tick (copied from 20260709170000,
--     each job still exception-isolated).
-- ----------------------------------------------------------------------------
create or replace function public.run_scheduled_game_jobs()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  begin
    perform public.close_season();
  exception when others then
    raise warning 'scheduled close_season failed: %', sqlerrm;
  end;

  begin
    for r in
      select id from public.traveling_basket_chains
      where status = 'active' order by created_at
    loop
      perform public.basket_auto_advance(r.id);
    end loop;
  exception when others then
    raise warning 'scheduled basket_auto_advance failed: %', sqlerrm;
  end;

  begin
    perform public.auto_close_golden_goose_assignments();
  exception when others then
    raise warning 'scheduled goose auto-close failed: %', sqlerrm;
  end;

  begin
    perform public.create_or_get_current_community_garden();
  exception when others then
    raise warning 'scheduled community garden tick failed: %', sqlerrm;
  end;
end;
$$;

revoke execute on function public.run_scheduled_game_jobs() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 13. update_game_settings v7 (v6 arrays from 20260709180000 VERBATIM
--     + garden keys). ⚠️ Future recreations must copy THESE arrays.
-- ----------------------------------------------------------------------------
create or replace function public.update_game_settings(p_settings jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_val jsonb;
  v_old jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_num numeric;
  v_i integer;
  v_elem jsonb;
  v_txt text;
  v_season_changed boolean := false;
  reward_type_keys text[] := array[
    'meeting_attendance_reward_type', 'hosting_reward_type',
    'giving_seed_reward_type', 'receiving_seed_reward_type',
    'goose_keeper_completion_reward_type'];
  schedule_mode_keys text[] := array['basket_schedule_mode', 'goose_schedule_mode'];
  days_per_week_keys text[] := array['basket_random_days_per_week', 'goose_random_days_per_week'];
  enabled_days_keys text[] := array['basket_enabled_days', 'goose_enabled_days'];
  boolean_keys text[] := array[
    'basket_enabled', 'goose_enabled',
    'goose_auto_select_enabled', 'goose_pass_enabled',
    'goose_opt_in_required_for_private_users',
    'debug_settings_enabled',
    'garden_enabled', 'garden_partial_reward_enabled',
    'garden_show_names', 'garden_private_users_can_contribute'];
  percent_keys text[] := array[
    'basket_large_basket_chance_percent', 'blossom_chance_percent',
    'garden_partial_threshold_percent'];
  min_two_keys text[] := array['basket_small_target_count', 'basket_large_target_count'];
  min_one_keys text[] := array[
    'basket_keep_multiplier', 'basket_hold_hours', 'blossom_fruit_multiplier',
    'garden_event_duration_days', 'garden_required_water',
    'garden_required_seeds', 'garden_required_fertilizer'];
  text_keys text[] := array[
    'house_name_house_1', 'house_name_house_2', 'house_name_house_3',
    'house_name_house_4', 'house_name_house_5', 'house_name_house_6',
    'season_name_1', 'season_name_2', 'season_name_3',
    'season_name_4', 'season_name_5'];
  season_length_keys text[] := array[
    'season_length_days_1', 'season_length_days_2', 'season_length_days_3',
    'season_length_days_4', 'season_length_days_5'];
  garden_frequency_keys text[] := array['garden_frequency'];
  number_keys text[] := array[
    'meeting_attendance_reward_amount', 'hosting_reward_amount',
    'giving_seed_reward_amount', 'receiving_seed_reward_amount',
    'receiving_seed_bonus_water',
    'basket_max_water_per_pass', 'basket_max_seed_per_pass',
    'basket_max_fertilizer_per_pass', 'basket_auto_pass_water',
    'goose_answer_collection_hours', 'goose_selection_hours',
    'goose_total_cycle_hours', 'goose_exclusion_months_on_missed_selection',
    'goose_egg_seed_amount', 'goose_egg_fertilizer_amount',
    'goose_egg_water_amount', 'goose_keeper_completion_reward_amount',
    'garden_daily_water_limit', 'garden_daily_seed_limit',
    'garden_daily_fertilizer_limit',
    'garden_reward_water', 'garden_reward_seeds', 'garden_reward_fertilizer',
    'garden_partial_reward_water'];
  allowed text[];
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then raise exception 'INVALID_PAYLOAD'; end if;

  allowed := reward_type_keys || schedule_mode_keys || days_per_week_keys
             || enabled_days_keys || boolean_keys || percent_keys
             || min_two_keys || min_one_keys || text_keys
             || season_length_keys || garden_frequency_keys || number_keys;

  for v_key, v_val in select * from jsonb_each(p_settings) loop
    if not (v_key = any(allowed)) then raise exception 'UNKNOWN_SETTING_KEY: %', v_key; end if;

    if v_key = any(reward_type_keys) then
      if jsonb_typeof(v_val) <> 'string' or (v_val #>> '{}') not in ('water', 'seed', 'fertilizer') then
        raise exception 'INVALID_REWARD_TYPE for %', v_key;
      end if;
    elsif v_key = any(schedule_mode_keys) then
      if jsonb_typeof(v_val) <> 'string' or (v_val #>> '{}') not in ('random', 'specific') then
        raise exception 'INVALID_SCHEDULE_MODE for %', v_key;
      end if;
    elsif v_key = any(garden_frequency_keys) then
      -- TODO(garden-monthly): add 'monthly' once implemented
      if jsonb_typeof(v_val) <> 'string' or (v_val #>> '{}') not in ('weekly', 'manual') then
        raise exception 'INVALID_GARDEN_FREQUENCY for %', v_key;
      end if;
    elsif v_key = any(text_keys) then
      if jsonb_typeof(v_val) <> 'string' then raise exception 'INVALID_TEXT for %', v_key; end if;
      v_txt := trim(v_val #>> '{}');
      if length(v_txt) < 1 or length(v_txt) > 40 then raise exception 'TEXT_LENGTH for %', v_key; end if;
      v_val := to_jsonb(v_txt);
    elsif v_key = any(season_length_keys) then
      if jsonb_typeof(v_val) <> 'number' then raise exception 'INVALID_NUMBER for %', v_key; end if;
      v_num := (v_val #>> '{}')::numeric;
      if v_num < 1 or v_num > 365 or v_num <> floor(v_num) then
        raise exception 'SEASON_LENGTH_OUT_OF_RANGE for %', v_key;
      end if;
    elsif v_key = any(days_per_week_keys) then
      if jsonb_typeof(v_val) <> 'number' then raise exception 'INVALID_NUMBER for %', v_key; end if;
      v_num := (v_val #>> '{}')::numeric;
      if v_num < 0 or v_num > 7 or v_num <> floor(v_num) then raise exception 'DAYS_PER_WEEK_OUT_OF_RANGE for %', v_key; end if;
    elsif v_key = any(enabled_days_keys) then
      if jsonb_typeof(v_val) <> 'array' then raise exception 'INVALID_DAYS_ARRAY for %', v_key; end if;
      for v_elem in select * from jsonb_array_elements(v_val) loop
        if jsonb_typeof(v_elem) <> 'number' then raise exception 'INVALID_DAY for %', v_key; end if;
        v_i := (v_elem #>> '{}')::integer;
        if v_i < 0 or v_i > 6 then raise exception 'DAY_OUT_OF_RANGE for %', v_key; end if;
      end loop;
    elsif v_key = any(boolean_keys) then
      if jsonb_typeof(v_val) <> 'boolean' then raise exception 'INVALID_BOOLEAN for %', v_key; end if;
    elsif v_key = any(percent_keys) then
      if jsonb_typeof(v_val) <> 'number' then raise exception 'INVALID_NUMBER for %', v_key; end if;
      v_num := (v_val #>> '{}')::numeric;
      if v_num < 0 or v_num > 100 then raise exception 'PERCENT_OUT_OF_RANGE for %', v_key; end if;
    elsif v_key = any(min_two_keys) then
      if jsonb_typeof(v_val) <> 'number' then raise exception 'INVALID_NUMBER for %', v_key; end if;
      v_num := (v_val #>> '{}')::numeric;
      if v_num < 2 or v_num <> floor(v_num) then raise exception 'TARGET_TOO_SMALL for %', v_key; end if;
    elsif v_key = any(min_one_keys) then
      if jsonb_typeof(v_val) <> 'number' then raise exception 'INVALID_NUMBER for %', v_key; end if;
      v_num := (v_val #>> '{}')::numeric;
      if v_num < 1 then raise exception 'VALUE_TOO_SMALL for %', v_key; end if;
    elsif v_key = any(number_keys) then
      if jsonb_typeof(v_val) <> 'number' then raise exception 'INVALID_NUMBER for %', v_key; end if;
      v_num := (v_val #>> '{}')::numeric;
      if v_num < 0 then raise exception 'NEGATIVE_NOT_ALLOWED for %', v_key; end if;
    end if;

    select value_json into v_old from public.game_settings where key = v_key;
    if v_old is distinct from v_val then
      insert into public.game_settings (key, value_json, updated_by, updated_at)
        values (v_key, v_val, auth.uid(), now())
      on conflict (key) do update
        set value_json = excluded.value_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
      v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object('old', v_old, 'new', v_val));
      if v_key like 'season_name_%' or v_key like 'season_length_days_%' then
        v_season_changed := true;
      end if;
    end if;
  end loop;

  -- season edits apply to the running season immediately
  if v_season_changed then
    update public.seasons s
      set name = public.season_cycle_name(s.cycle_position),
          ends_at = s.starts_at + make_interval(days => public.season_cycle_length_days(s.cycle_position))
      where s.status = 'active' and s.cycle_position is not null;
  end if;

  if v_changes <> '{}'::jsonb then
    insert into public.admin_audit_logs (actor_user_id, action, metadata_json)
    values (auth.uid(), 'game_settings_updated', jsonb_build_object('changes', v_changes));
  end if;
end;
$$;

revoke execute on function public.update_game_settings(jsonb) from public, anon;
grant execute on function public.update_game_settings(jsonb) to authenticated;
