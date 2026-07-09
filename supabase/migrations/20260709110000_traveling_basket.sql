-- ============================================================================
-- Traveling Basket — a limited weekly community event.
--
-- On a basket day (default: 3 deterministic-random days per week), one
-- eligible farmer receives an empty basket. Each holder either:
--   * KEEPS it — receives DOUBLE (configurable) the current contents, ends
--     the chain; or
--   * PASSES it — must add at least 1 item (water / seed / fertilizer, never
--     Fruits), then chooses the next eligible farmer.
-- If the chain reaches its target participant count (5 common / 10 rare),
-- it LOCKS IN: every farmer who touched it receives the full contents.
--
-- ECONOMY GUARANTEE: contributions and rewards are ONLY water / seed /
-- fertilizer (check constraints + function validation). Fruits can neither
-- enter nor leave the basket. Fruits stay harvest-only.
--
-- All gameplay goes through SECURITY DEFINER functions; the tables are not
-- client-writable and only admins can read them directly. Rewards are
-- server-side only.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------
create table public.traveling_basket_chains (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id) on delete cascade,
  basket_date date not null,
  status text not null default 'active'
    check (status in ('active', 'locked_in', 'kept', 'expired', 'cancelled')),
  target_participant_count integer not null check (target_participant_count >= 2),
  started_user_id uuid references auth.users (id) on delete set null,
  current_holder_user_id uuid references auth.users (id) on delete set null,
  locked_at timestamptz,
  kept_by_user_id uuid references auth.users (id) on delete set null,
  kept_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- one chain per basket day
create unique index traveling_basket_chains_one_per_day_key
  on public.traveling_basket_chains (basket_date);

create trigger traveling_basket_chains_set_updated_at
  before update on public.traveling_basket_chains
  for each row execute function public.set_updated_at();

create table public.traveling_basket_touches (
  id uuid primary key default gen_random_uuid(),
  chain_id uuid not null references public.traveling_basket_chains (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  received_from_user_id uuid references auth.users (id) on delete set null,
  received_at timestamptz not null default now(),
  passed_to_user_id uuid references auth.users (id) on delete set null,
  passed_at timestamptz,
  action text not null default 'holding'
    check (action in ('holding', 'passed', 'kept', 'locked_in')),
  sequence_number integer not null check (sequence_number >= 1),
  constraint traveling_basket_touches_once_per_user unique (chain_id, user_id),
  constraint traveling_basket_touches_sequence unique (chain_id, sequence_number)
);

create index traveling_basket_touches_chain_idx
  on public.traveling_basket_touches (chain_id);

create table public.traveling_basket_contributions (
  id uuid primary key default gen_random_uuid(),
  chain_id uuid not null references public.traveling_basket_chains (id) on delete cascade,
  contributor_user_id uuid not null references auth.users (id) on delete cascade,
  receiver_user_id uuid references auth.users (id) on delete set null,
  touch_id uuid references public.traveling_basket_touches (id) on delete set null,
  reward_type text not null check (reward_type in ('water', 'seed', 'fertilizer')),
  amount integer not null check (amount > 0),
  contributed_at timestamptz not null default now()
);

create index traveling_basket_contributions_chain_idx
  on public.traveling_basket_contributions (chain_id);
create index traveling_basket_contributions_contributor_idx
  on public.traveling_basket_contributions (contributor_user_id, contributed_at);

create table public.traveling_basket_reward_events (
  id uuid primary key default gen_random_uuid(),
  chain_id uuid not null references public.traveling_basket_chains (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  reward_type text not null check (reward_type in ('water', 'seed', 'fertilizer')),
  amount integer not null check (amount > 0),
  reason text not null
    check (reason in ('basket_keep_double', 'basket_lock_in_reward', 'basket_contribution_received')),
  source_type text not null default 'traveling_basket',
  source_id uuid,
  created_at timestamptz not null default now()
);

create index traveling_basket_reward_events_user_idx
  on public.traveling_basket_reward_events (user_id, created_at desc);

-- RLS: gameplay reads go through get_traveling_basket_state(); direct table
-- access is admin-only (plus your own reward history).
alter table public.traveling_basket_chains enable row level security;
alter table public.traveling_basket_touches enable row level security;
alter table public.traveling_basket_contributions enable row level security;
alter table public.traveling_basket_reward_events enable row level security;

create policy "basket_chains: admins only"
  on public.traveling_basket_chains for select to authenticated
  using (public.is_admin());
create policy "basket_touches: admins only"
  on public.traveling_basket_touches for select to authenticated
  using (public.is_admin());
create policy "basket_contributions: admins only"
  on public.traveling_basket_contributions for select to authenticated
  using (public.is_admin());
create policy "basket_reward_events: read own or as admin"
  on public.traveling_basket_reward_events for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- Fertilizer moves through the basket also hit the fertilizer ledger.
alter table public.fertilizer_events drop constraint fertilizer_events_reason_check;
alter table public.fertilizer_events
  add constraint fertilizer_events_reason_check
  check (reason in
    ('medal_reward', 'badge_reward', 'checklist_reward', 'used_on_tree',
     'admin_adjustment', 'basket_contribution', 'basket_reward'));

-- ----------------------------------------------------------------------------
-- 2. Settings rework: the real Traveling Basket keys replace the early
--    placeholders. Remove stale overrides for keys that no longer exist.
-- ----------------------------------------------------------------------------
delete from public.game_settings where key in (
  'basket_receive_reward_type', 'basket_receive_reward_amount',
  'basket_pass_reward_type', 'basket_pass_reward_amount',
  'basket_milestone_interval', 'basket_milestone_reward_type',
  'basket_milestone_reward_amount', 'basket_contributions_enabled',
  'basket_double_back_enabled', 'basket_double_back_multiplier');

-- Rewritten validator with the current key list (drop-in replacement).
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
  reward_type_keys text[] := array[
    'meeting_attendance_reward_type', 'hosting_reward_type',
    'giving_seed_reward_type', 'receiving_seed_reward_type',
    'goose_keeper_completion_reward_type'];
  schedule_mode_keys text[] := array['basket_schedule_mode', 'goose_schedule_mode'];
  days_per_week_keys text[] := array['basket_random_days_per_week', 'goose_random_days_per_week'];
  enabled_days_keys text[] := array['basket_enabled_days', 'goose_enabled_days'];
  boolean_keys text[] := array[
    'basket_enabled',
    'goose_auto_select_enabled', 'goose_pass_enabled',
    'goose_opt_in_required_for_private_users'];
  percent_keys text[] := array['basket_large_basket_chance_percent'];
  min_two_keys text[] := array['basket_small_target_count', 'basket_large_target_count'];
  min_one_keys text[] := array['basket_keep_multiplier'];
  number_keys text[] := array[
    'meeting_attendance_reward_amount', 'hosting_reward_amount',
    'giving_seed_reward_amount', 'receiving_seed_reward_amount',
    'receiving_seed_bonus_water',
    'basket_max_water_per_pass', 'basket_max_seed_per_pass',
    'basket_max_fertilizer_per_pass', 'basket_max_water_per_day',
    'basket_max_seed_per_day', 'basket_max_fertilizer_per_day',
    'goose_answer_collection_hours', 'goose_selection_hours',
    'goose_total_cycle_hours', 'goose_exclusion_months_on_missed_selection',
    'goose_egg_seed_amount', 'goose_egg_fertilizer_amount',
    'goose_egg_water_amount', 'goose_keeper_completion_reward_amount'];
  allowed text[];
begin
  if not public.is_admin() then
    raise exception 'NOT_ADMIN';
  end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    raise exception 'INVALID_PAYLOAD';
  end if;

  allowed := reward_type_keys || schedule_mode_keys || days_per_week_keys
             || enabled_days_keys || boolean_keys || percent_keys
             || min_two_keys || min_one_keys || number_keys;

  for v_key, v_val in select * from jsonb_each(p_settings) loop
    if not (v_key = any(allowed)) then
      raise exception 'UNKNOWN_SETTING_KEY: %', v_key;
    end if;

    if v_key = any(reward_type_keys) then
      if jsonb_typeof(v_val) <> 'string'
         or (v_val #>> '{}') not in ('water', 'seed', 'fertilizer') then
        raise exception 'INVALID_REWARD_TYPE for %', v_key;
      end if;
    elsif v_key = any(schedule_mode_keys) then
      if jsonb_typeof(v_val) <> 'string'
         or (v_val #>> '{}') not in ('random', 'specific') then
        raise exception 'INVALID_SCHEDULE_MODE for %', v_key;
      end if;
    elsif v_key = any(days_per_week_keys) then
      if jsonb_typeof(v_val) <> 'number' then
        raise exception 'INVALID_NUMBER for %', v_key;
      end if;
      v_num := (v_val #>> '{}')::numeric;
      if v_num < 0 or v_num > 7 or v_num <> floor(v_num) then
        raise exception 'DAYS_PER_WEEK_OUT_OF_RANGE for %', v_key;
      end if;
    elsif v_key = any(enabled_days_keys) then
      if jsonb_typeof(v_val) <> 'array' then
        raise exception 'INVALID_DAYS_ARRAY for %', v_key;
      end if;
      for v_elem in select * from jsonb_array_elements(v_val) loop
        if jsonb_typeof(v_elem) <> 'number' then
          raise exception 'INVALID_DAY for %', v_key;
        end if;
        v_i := (v_elem #>> '{}')::integer;
        if v_i < 0 or v_i > 6 then
          raise exception 'DAY_OUT_OF_RANGE for %', v_key;
        end if;
      end loop;
    elsif v_key = any(boolean_keys) then
      if jsonb_typeof(v_val) <> 'boolean' then
        raise exception 'INVALID_BOOLEAN for %', v_key;
      end if;
    elsif v_key = any(percent_keys) then
      if jsonb_typeof(v_val) <> 'number' then
        raise exception 'INVALID_NUMBER for %', v_key;
      end if;
      v_num := (v_val #>> '{}')::numeric;
      if v_num < 0 or v_num > 100 then
        raise exception 'PERCENT_OUT_OF_RANGE for %', v_key;
      end if;
    elsif v_key = any(min_two_keys) then
      if jsonb_typeof(v_val) <> 'number' then
        raise exception 'INVALID_NUMBER for %', v_key;
      end if;
      v_num := (v_val #>> '{}')::numeric;
      if v_num < 2 or v_num <> floor(v_num) then
        raise exception 'TARGET_TOO_SMALL for %', v_key;
      end if;
    elsif v_key = any(min_one_keys) then
      if jsonb_typeof(v_val) <> 'number' then
        raise exception 'INVALID_NUMBER for %', v_key;
      end if;
      v_num := (v_val #>> '{}')::numeric;
      if v_num < 1 then
        raise exception 'MULTIPLIER_TOO_SMALL for %', v_key;
      end if;
    elsif v_key = any(number_keys) then
      if jsonb_typeof(v_val) <> 'number' then
        raise exception 'INVALID_NUMBER for %', v_key;
      end if;
      v_num := (v_val #>> '{}')::numeric;
      if v_num < 0 then
        raise exception 'NEGATIVE_NOT_ALLOWED for %', v_key;
      end if;
    end if;

    select value_json into v_old from public.game_settings where key = v_key;
    if v_old is distinct from v_val then
      insert into public.game_settings (key, value_json, updated_by, updated_at)
        values (v_key, v_val, auth.uid(), now())
      on conflict (key) do update
        set value_json = excluded.value_json,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at;
      v_changes := v_changes
        || jsonb_build_object(v_key, jsonb_build_object('old', v_old, 'new', v_val));
    end if;
  end loop;

  if v_changes <> '{}'::jsonb then
    insert into public.admin_audit_logs (actor_user_id, action, metadata_json)
    values (auth.uid(), 'game_settings_updated',
            jsonb_build_object('changes', v_changes));
  end if;
end;
$$;

revoke execute on function public.update_game_settings(jsonb) from public, anon;
grant execute on function public.update_game_settings(jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Schedule: is a given date a basket day?
--    Random mode is DETERMINISTIC per week: the week's days are picked by
--    hashing the week start, so "3 random days" stays stable all week and
--    every server agrees on them.
-- ----------------------------------------------------------------------------
create or replace function public.basket_is_basket_day(p_date date)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_enabled boolean := public.game_setting_text('basket_enabled', 'true')::boolean;
  v_mode text := public.game_setting_text('basket_schedule_mode', 'random');
  v_days_per_week integer := public.game_setting_int('basket_random_days_per_week', 3);
  v_enabled_days jsonb;
  v_dow integer := extract(dow from p_date)::integer; -- 0=Sun … 6=Sat
  v_week_start date := date_trunc('week', p_date::timestamptz)::date;
  v_rank integer;
begin
  if not v_enabled then
    return false;
  end if;

  if v_mode = 'specific' then
    select value_json into v_enabled_days
    from public.game_settings where key = 'basket_enabled_days';
    if v_enabled_days is null or jsonb_typeof(v_enabled_days) <> 'array' then
      return false; -- specific mode with no days chosen = no basket days
    end if;
    return exists (
      select 1 from jsonb_array_elements(v_enabled_days) d
      where (d #>> '{}')::integer = v_dow);
  end if;

  -- random mode: rank the 7 weekdays by a week-seeded hash; the first N are
  -- this week's basket days.
  if v_days_per_week <= 0 then
    return false;
  end if;
  if v_days_per_week >= 7 then
    return true;
  end if;
  select rnk into v_rank from (
    select d as dow, row_number() over (
      order by md5(v_week_start::text || ':' || d::text)) as rnk
    from generate_series(0, 6) d
  ) ranked where dow = v_dow;
  return v_rank <= v_days_per_week;
end;
$$;

revoke execute on function public.basket_is_basket_day(date) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Eligibility: who can receive the basket?
--    Not banned, farm in the given season, PUBLIC profile (hidden/anonymous
--    farmers can't be chosen by name, so Private Mode acts as an opt-out),
--    and hasn't already touched the chain.
-- ----------------------------------------------------------------------------
create or replace function public.basket_eligible_users(p_season uuid, p_chain uuid)
returns table (user_id uuid, username text, display_name text)
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id, p.username, p.display_name
  from public.profiles p
  join public.farms f on f.user_id = p.user_id and f.season_id = p_season
  where not p.is_banned
    and p.leaderboard_visibility = 'public'
    and (p_chain is null or not exists (
      select 1 from public.traveling_basket_touches t
      where t.chain_id = p_chain and t.user_id = p.user_id))
  order by p.username;
$$;

revoke execute on function public.basket_eligible_users(uuid, uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. Basket contents = sum of all contributions in the chain.
-- ----------------------------------------------------------------------------
create or replace function public.basket_contents(p_chain uuid)
returns table (water integer, seed integer, fertilizer integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(amount) filter (where reward_type = 'water'), 0)::integer,
    coalesce(sum(amount) filter (where reward_type = 'seed'), 0)::integer,
    coalesce(sum(amount) filter (where reward_type = 'fertilizer'), 0)::integer
  from public.traveling_basket_contributions
  where chain_id = p_chain;
$$;

revoke execute on function public.basket_contents(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6. Award helper: hand water/seed/fertilizer to a user's farm + ledgers.
--    NEVER touches fruit_total — Fruits stay harvest-only.
-- ----------------------------------------------------------------------------
create or replace function public.basket_award(
  p_chain uuid, p_user uuid, p_season uuid,
  p_water integer, p_seed integer, p_fert integer, p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_water <= 0 and p_seed <= 0 and p_fert <= 0 then
    return;
  end if;

  insert into public.farms (user_id, season_id) values (p_user, p_season)
    on conflict (user_id, season_id) do nothing;

  update public.farms
    set water_count = water_count + greatest(p_water, 0),
        seed_count = seed_count + greatest(p_seed, 0),
        fertilizer_count = fertilizer_count + greatest(p_fert, 0)
    where user_id = p_user and season_id = p_season;

  if p_water > 0 then
    insert into public.traveling_basket_reward_events (chain_id, user_id, reward_type, amount, reason, source_id)
    values (p_chain, p_user, 'water', p_water, p_reason, p_chain);
  end if;
  if p_seed > 0 then
    insert into public.traveling_basket_reward_events (chain_id, user_id, reward_type, amount, reason, source_id)
    values (p_chain, p_user, 'seed', p_seed, p_reason, p_chain);
  end if;
  if p_fert > 0 then
    insert into public.traveling_basket_reward_events (chain_id, user_id, reward_type, amount, reason, source_id)
    values (p_chain, p_user, 'fertilizer', p_fert, p_reason, p_chain);
    insert into public.fertilizer_events (user_id, season_id, amount, reason)
    values (p_user, p_season, p_fert, 'basket_reward');
  end if;
end;
$$;

revoke execute on function public.basket_award(uuid, uuid, uuid, integer, integer, integer, text)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7. create_or_get_today_basket (internal): expires stale chains; on a basket
--    day, creates today's chain (once — unique index backstops races), picks
--    the size (5 common / 10 rare) and a random eligible first holder.
-- ----------------------------------------------------------------------------
create or replace function public.create_or_get_today_basket()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season uuid;
  v_chain uuid;
  v_target integer;
  v_small integer := greatest(public.game_setting_int('basket_small_target_count', 5), 2);
  v_large integer := greatest(public.game_setting_int('basket_large_target_count', 10), 2);
  v_chance integer := least(greatest(public.game_setting_int('basket_large_basket_chance_percent', 15), 0), 100);
  v_first uuid;
begin
  -- lazily expire yesterday's (and older) unfinished chains
  update public.traveling_basket_chains
    set status = 'expired'
    where status = 'active' and basket_date < current_date;

  select id into v_chain from public.traveling_basket_chains
    where basket_date = current_date;
  if v_chain is not null then
    return v_chain;
  end if;

  if not public.basket_is_basket_day(current_date) then
    return null;
  end if;

  select id into v_season from public.seasons where status = 'active'
    order by ends_at limit 1;
  if v_season is null then
    return null;
  end if;

  -- random eligible first holder; no eligible farmers → no basket today (yet)
  select u.user_id into v_first
  from public.basket_eligible_users(v_season, null) u
  order by random() limit 1;
  if v_first is null then
    return null;
  end if;

  v_target := case when random() * 100 < v_chance then v_large else v_small end;

  begin
    insert into public.traveling_basket_chains
      (season_id, basket_date, status, target_participant_count,
       started_user_id, current_holder_user_id, expires_at)
    values
      (v_season, current_date, 'active', v_target,
       v_first, v_first, (current_date + 1)::timestamptz)
    returning id into v_chain;
  exception
    when unique_violation then
      -- another request created it first — use theirs
      select id into v_chain from public.traveling_basket_chains
        where basket_date = current_date;
      return v_chain;
  end;

  insert into public.traveling_basket_touches
    (chain_id, user_id, received_from_user_id, action, sequence_number)
  values (v_chain, v_first, null, 'holding', 1);

  return v_chain;
end;
$$;

revoke execute on function public.create_or_get_today_basket() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 8. get_traveling_basket_state: everything the dashboard panel needs.
-- ----------------------------------------------------------------------------
create or replace function public.get_traveling_basket_state()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_chain uuid;
  c record;
  v_contents record;
  v_participants integer;
  v_my_touch record;
  v_holder_name text;
  v_recipients jsonb := '[]'::jsonb;
  v_my_rewards jsonb := '[]'::jsonb;
  v_is_basket_day boolean;
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  v_is_basket_day := public.basket_is_basket_day(current_date);
  v_chain := public.create_or_get_today_basket();

  if v_chain is null then
    return jsonb_build_object(
      'is_basket_day', v_is_basket_day,
      'has_chain', false);
  end if;

  select * into c from public.traveling_basket_chains where id = v_chain;
  select * into v_contents from public.basket_contents(v_chain);
  select count(*)::integer into v_participants
    from public.traveling_basket_touches where chain_id = v_chain;
  select * into v_my_touch from public.traveling_basket_touches
    where chain_id = v_chain and user_id = v_user;
  select username into v_holder_name from public.profiles
    where user_id = c.current_holder_user_id and leaderboard_visibility = 'public';

  if c.status = 'active' and c.current_holder_user_id = v_user then
    select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', u.user_id, 'username', u.username, 'display_name', u.display_name)), '[]'::jsonb)
      into v_recipients
    from public.basket_eligible_users(c.season_id, v_chain) u
    where u.user_id <> v_user;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('reward_type', reward_type, 'amount', amount)), '[]'::jsonb)
    into v_my_rewards
  from public.traveling_basket_reward_events
  where chain_id = v_chain and user_id = v_user;

  return jsonb_build_object(
    'is_basket_day', v_is_basket_day,
    'has_chain', true,
    'chain_id', c.id,
    'status', c.status,
    'target', c.target_participant_count,
    'participants', v_participants,
    'contents', jsonb_build_object(
      'water', v_contents.water, 'seed', v_contents.seed, 'fertilizer', v_contents.fertilizer),
    'i_hold_it', c.status = 'active' and c.current_holder_user_id = v_user,
    'i_touched_it', v_my_touch.id is not null,
    'holder_username', v_holder_name,
    'keep_multiplier', greatest(public.game_setting_int('basket_keep_multiplier', 2), 1),
    'limits', jsonb_build_object(
      'water_per_pass', public.game_setting_int('basket_max_water_per_pass', 25),
      'seed_per_pass', public.game_setting_int('basket_max_seed_per_pass', 1),
      'fertilizer_per_pass', public.game_setting_int('basket_max_fertilizer_per_pass', 2),
      'water_per_day', public.game_setting_int('basket_max_water_per_day', 50),
      'seed_per_day', public.game_setting_int('basket_max_seed_per_day', 1),
      'fertilizer_per_day', public.game_setting_int('basket_max_fertilizer_per_day', 3)),
    'eligible_recipients', v_recipients,
    'my_rewards', v_my_rewards);
end;
$$;

revoke execute on function public.get_traveling_basket_state() from public, anon;
grant execute on function public.get_traveling_basket_state() to authenticated;

-- ----------------------------------------------------------------------------
-- 9. pass_traveling_basket: holder adds ≥1 item and hands it on. If the
--    receiver is participant #target, the basket LOCKS IN and everyone who
--    touched it receives the full contents.
-- ----------------------------------------------------------------------------
create or replace function public.pass_traveling_basket(
  p_receiver uuid, p_water integer, p_seed integer, p_fertilizer integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_banned boolean;
  c record;
  v_farm record;
  v_my_touch record;
  v_water integer := coalesce(p_water, 0);
  v_seed integer := coalesce(p_seed, 0);
  v_fert integer := coalesce(p_fertilizer, 0);
  v_max_water_pass integer := public.game_setting_int('basket_max_water_per_pass', 25);
  v_max_seed_pass integer := public.game_setting_int('basket_max_seed_per_pass', 1);
  v_max_fert_pass integer := public.game_setting_int('basket_max_fertilizer_per_pass', 2);
  v_max_water_day integer := public.game_setting_int('basket_max_water_per_day', 50);
  v_max_seed_day integer := public.game_setting_int('basket_max_seed_per_day', 1);
  v_max_fert_day integer := public.game_setting_int('basket_max_fertilizer_per_day', 3);
  v_today_water integer;
  v_today_seed integer;
  v_today_fert integer;
  v_receiver_touch uuid;
  v_seq integer;
  v_participants integer;
  v_contents record;
  r record;
  v_locked boolean := false;
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  select is_banned into v_banned from public.profiles where user_id = v_user;
  if v_banned is null then
    raise exception 'NO_PROFILE';
  end if;
  if v_banned then
    raise exception 'BANNED';
  end if;

  if v_water < 0 or v_seed < 0 or v_fert < 0 then
    raise exception 'NEGATIVE_NOT_ALLOWED';
  end if;
  if v_water + v_seed + v_fert < 1 then
    raise exception 'MUST_ADD_ITEM';
  end if;
  if v_water > v_max_water_pass or v_seed > v_max_seed_pass or v_fert > v_max_fert_pass then
    raise exception 'PASS_LIMIT_EXCEEDED';
  end if;
  if p_receiver = v_user then
    raise exception 'CANNOT_PASS_TO_SELF';
  end if;

  -- lock today's chain row to serialize concurrent passes
  select * into c from public.traveling_basket_chains
    where basket_date = current_date and status = 'active'
    for update;
  if c.id is null then
    raise exception 'NO_ACTIVE_BASKET';
  end if;
  if c.current_holder_user_id <> v_user then
    raise exception 'NOT_HOLDER';
  end if;
  if c.expires_at <= now() then
    raise exception 'BASKET_EXPIRED';
  end if;

  -- per-basket-day totals (all chains share the date; one chain per day)
  select
    coalesce(sum(amount) filter (where reward_type = 'water'), 0),
    coalesce(sum(amount) filter (where reward_type = 'seed'), 0),
    coalesce(sum(amount) filter (where reward_type = 'fertilizer'), 0)
    into v_today_water, v_today_seed, v_today_fert
  from public.traveling_basket_contributions tc
  join public.traveling_basket_chains ch on ch.id = tc.chain_id
  where tc.contributor_user_id = v_user and ch.basket_date = current_date;

  if v_today_water + v_water > v_max_water_day
     or v_today_seed + v_seed > v_max_seed_day
     or v_today_fert + v_fert > v_max_fert_day then
    raise exception 'DAILY_LIMIT_EXCEEDED';
  end if;

  -- receiver must be eligible (public, unbanned, farm this season, untouched)
  if not exists (
    select 1 from public.basket_eligible_users(c.season_id, c.id) u
    where u.user_id = p_receiver
  ) then
    raise exception 'RECEIVER_NOT_ELIGIBLE';
  end if;

  -- holder must own what they're contributing
  select * into v_farm from public.farms
    where user_id = v_user and season_id = c.season_id
    for update;
  if v_farm.id is null then
    raise exception 'NO_FARM';
  end if;
  if v_farm.water_count < v_water or v_farm.seed_count < v_seed
     or v_farm.fertilizer_count < v_fert then
    raise exception 'NOT_ENOUGH_ITEMS';
  end if;

  select * into v_my_touch from public.traveling_basket_touches
    where chain_id = c.id and user_id = v_user;

  -- deduct from the holder's farm; items now live inside the basket
  update public.farms
    set water_count = water_count - v_water,
        seed_count = seed_count - v_seed,
        fertilizer_count = fertilizer_count - v_fert
    where id = v_farm.id;
  if v_fert > 0 then
    insert into public.fertilizer_events (user_id, season_id, amount, reason)
    values (v_user, c.season_id, -v_fert, 'basket_contribution');
  end if;

  if v_water > 0 then
    insert into public.traveling_basket_contributions
      (chain_id, contributor_user_id, receiver_user_id, touch_id, reward_type, amount)
    values (c.id, v_user, p_receiver, v_my_touch.id, 'water', v_water);
  end if;
  if v_seed > 0 then
    insert into public.traveling_basket_contributions
      (chain_id, contributor_user_id, receiver_user_id, touch_id, reward_type, amount)
    values (c.id, v_user, p_receiver, v_my_touch.id, 'seed', v_seed);
  end if;
  if v_fert > 0 then
    insert into public.traveling_basket_contributions
      (chain_id, contributor_user_id, receiver_user_id, touch_id, reward_type, amount)
    values (c.id, v_user, p_receiver, v_my_touch.id, 'fertilizer', v_fert);
  end if;

  -- hand it over
  update public.traveling_basket_touches
    set action = 'passed', passed_to_user_id = p_receiver, passed_at = now()
    where id = v_my_touch.id;

  select coalesce(max(sequence_number), 0) + 1 into v_seq
    from public.traveling_basket_touches where chain_id = c.id;

  insert into public.traveling_basket_touches
    (chain_id, user_id, received_from_user_id, action, sequence_number)
  values (c.id, p_receiver, v_user, 'holding', v_seq)
  returning id into v_receiver_touch;

  update public.traveling_basket_chains
    set current_holder_user_id = p_receiver where id = c.id;

  -- did this pass reach the target? → LOCK IN
  select count(*)::integer into v_participants
    from public.traveling_basket_touches where chain_id = c.id;

  if v_participants >= c.target_participant_count then
    v_locked := true;
    select * into v_contents from public.basket_contents(c.id);

    update public.traveling_basket_chains
      set status = 'locked_in', locked_at = now(), current_holder_user_id = null
      where id = c.id;
    update public.traveling_basket_touches
      set action = 'locked_in' where id = v_receiver_touch;

    -- everyone who touched it receives the FULL contents (banned users skip)
    for r in
      select t.user_id from public.traveling_basket_touches t
      join public.profiles p on p.user_id = t.user_id and not p.is_banned
      where t.chain_id = c.id
    loop
      perform public.basket_award(
        c.id, r.user_id, c.season_id,
        v_contents.water, v_contents.seed, v_contents.fertilizer,
        'basket_lock_in_reward');
    end loop;
  end if;

  return jsonb_build_object('locked_in', v_locked, 'participants', v_participants);
end;
$$;

revoke execute on function public.pass_traveling_basket(uuid, integer, integer, integer) from public, anon;
grant execute on function public.pass_traveling_basket(uuid, integer, integer, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 10. keep_traveling_basket: holder takes contents × multiplier; chain ends.
-- ----------------------------------------------------------------------------
create or replace function public.keep_traveling_basket()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_banned boolean;
  c record;
  v_contents record;
  v_mult integer := greatest(public.game_setting_int('basket_keep_multiplier', 2), 1);
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  select is_banned into v_banned from public.profiles where user_id = v_user;
  if v_banned is null then
    raise exception 'NO_PROFILE';
  end if;
  if v_banned then
    raise exception 'BANNED';
  end if;

  select * into c from public.traveling_basket_chains
    where basket_date = current_date and status = 'active'
    for update;
  if c.id is null then
    raise exception 'NO_ACTIVE_BASKET';
  end if;
  if c.current_holder_user_id <> v_user then
    raise exception 'NOT_HOLDER';
  end if;

  select * into v_contents from public.basket_contents(c.id);

  update public.traveling_basket_chains
    set status = 'kept', kept_by_user_id = v_user, kept_at = now(),
        current_holder_user_id = null
    where id = c.id;
  update public.traveling_basket_touches
    set action = 'kept' where chain_id = c.id and user_id = v_user;

  perform public.basket_award(
    c.id, v_user, c.season_id,
    v_contents.water * v_mult, v_contents.seed * v_mult, v_contents.fertilizer * v_mult,
    'basket_keep_double');

  return jsonb_build_object(
    'water', v_contents.water * v_mult,
    'seed', v_contents.seed * v_mult,
    'fertilizer', v_contents.fertilizer * v_mult);
end;
$$;

revoke execute on function public.keep_traveling_basket() from public, anon;
grant execute on function public.keep_traveling_basket() to authenticated;

-- ----------------------------------------------------------------------------
-- 11. Admin: cancel today's chain (audit-logged). Contributions already in
--     the basket are NOT refunded (keeps the function simple + idempotent);
--     cancel early if a chain needs to be killed.
-- ----------------------------------------------------------------------------
create or replace function public.admin_cancel_traveling_basket()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chain uuid;
begin
  if not public.is_admin() then
    raise exception 'NOT_ADMIN';
  end if;

  select id into v_chain from public.traveling_basket_chains
    where basket_date = current_date and status = 'active'
    for update;
  if v_chain is null then
    raise exception 'NO_ACTIVE_BASKET';
  end if;

  update public.traveling_basket_chains
    set status = 'cancelled', current_holder_user_id = null
    where id = v_chain;

  insert into public.admin_audit_logs (actor_user_id, action, metadata_json)
  values (auth.uid(), 'basket_cancelled', jsonb_build_object('chain_id', v_chain));
end;
$$;

revoke execute on function public.admin_cancel_traveling_basket() from public, anon;
grant execute on function public.admin_cancel_traveling_basket() to authenticated;
