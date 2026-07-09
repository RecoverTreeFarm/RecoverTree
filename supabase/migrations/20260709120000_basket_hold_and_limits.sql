-- ============================================================================
-- Traveling Basket tweaks (per feedback):
--
--   1. Contribution limits are TOTAL per person (per basket), not per day.
--      Since a user only touches a basket once per chain, the per-pass number
--      IS that total — so the separate per-day limits are removed.
--
--   2. 24-hour hold timeout. The current holder must pass or keep within
--      `basket_hold_hours` (default 24). If they don't, the basket takes
--      `basket_auto_pass_water` (default 5) water from them (or as much as
--      they have) and auto-passes to a random eligible farmer.
--      NOTE: there is no scheduler in this project, so the timeout is applied
--      LAZILY — whenever anyone loads the dashboard, get_traveling_basket_state
--      resolves any overdue basket before returning.
--
--   3. Water floor to receive. A farmer must have at least
--      `basket_auto_pass_water` water to be an eligible recipient (whether
--      chosen by the holder or picked at random). This guarantees a receiver
--      can always be auto-passed later.
--
-- Lifecycle simplifies to ONE active chain at a time: a chain ends only by
-- lock-in, keep, or running out of eligible recipients. A new chain starts on
-- a basket day once the previous one has ended.
--
-- Economy unchanged: basket contents/rewards are still only water/seed/
-- fertilizer; Fruits never enter or leave the basket. `expires_at` now means
-- "the current hold's deadline".
-- ============================================================================

-- Drop the now-unused per-day override rows.
delete from public.game_settings where key in (
  'basket_max_water_per_day', 'basket_max_seed_per_day', 'basket_max_fertilizer_per_day');

-- ----------------------------------------------------------------------------
-- Eligibility now also requires enough water to receive.
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
    and f.water_count >= public.game_setting_int('basket_auto_pass_water', 5)
    and (p_chain is null or not exists (
      select 1 from public.traveling_basket_touches t
      where t.chain_id = p_chain and t.user_id = p.user_id))
  order by p.username;
$$;

revoke execute on function public.basket_eligible_users(uuid, uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Shared hand-off: record contributions (already debited from the sender's
-- farm by the caller), pass to the receiver, and lock in if the target is
-- reached. Returns true if the chain locked in.
-- ----------------------------------------------------------------------------
create or replace function public.basket_do_pass(
  p_chain uuid, p_from uuid, p_to uuid,
  p_water integer, p_seed integer, p_fert integer, p_season uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from_touch uuid;
  v_seq integer;
  v_recv_touch uuid;
  v_participants integer;
  v_target integer;
  v_contents record;
  v_hold integer := greatest(public.game_setting_int('basket_hold_hours', 24), 1);
  r record;
begin
  select id into v_from_touch from public.traveling_basket_touches
    where chain_id = p_chain and user_id = p_from;

  if p_water > 0 then
    insert into public.traveling_basket_contributions
      (chain_id, contributor_user_id, receiver_user_id, touch_id, reward_type, amount)
    values (p_chain, p_from, p_to, v_from_touch, 'water', p_water);
  end if;
  if p_seed > 0 then
    insert into public.traveling_basket_contributions
      (chain_id, contributor_user_id, receiver_user_id, touch_id, reward_type, amount)
    values (p_chain, p_from, p_to, v_from_touch, 'seed', p_seed);
  end if;
  if p_fert > 0 then
    insert into public.traveling_basket_contributions
      (chain_id, contributor_user_id, receiver_user_id, touch_id, reward_type, amount)
    values (p_chain, p_from, p_to, v_from_touch, 'fertilizer', p_fert);
  end if;

  update public.traveling_basket_touches
    set action = 'passed', passed_to_user_id = p_to, passed_at = now()
    where id = v_from_touch;

  select coalesce(max(sequence_number), 0) + 1 into v_seq
    from public.traveling_basket_touches where chain_id = p_chain;

  insert into public.traveling_basket_touches
    (chain_id, user_id, received_from_user_id, action, sequence_number)
  values (p_chain, p_to, p_from, 'holding', v_seq)
  returning id into v_recv_touch;

  update public.traveling_basket_chains
    set current_holder_user_id = p_to,
        expires_at = now() + make_interval(hours => v_hold)
    where id = p_chain;

  select count(*)::integer into v_participants
    from public.traveling_basket_touches where chain_id = p_chain;
  select target_participant_count into v_target
    from public.traveling_basket_chains where id = p_chain;

  if v_participants >= v_target then
    select * into v_contents from public.basket_contents(p_chain);
    update public.traveling_basket_chains
      set status = 'locked_in', locked_at = now(), current_holder_user_id = null
      where id = p_chain;
    update public.traveling_basket_touches
      set action = 'locked_in' where id = v_recv_touch;
    for r in
      select t.user_id from public.traveling_basket_touches t
      join public.profiles p on p.user_id = t.user_id and not p.is_banned
      where t.chain_id = p_chain
    loop
      perform public.basket_award(
        p_chain, r.user_id, p_season,
        v_contents.water, v_contents.seed, v_contents.fertilizer,
        'basket_lock_in_reward');
    end loop;
    return true;
  end if;

  return false;
end;
$$;

revoke execute on function public.basket_do_pass(uuid, uuid, uuid, integer, integer, integer, uuid)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Lazy auto-advance: while the current hold is overdue, take the auto-pass
-- water (or as much as the holder has) and pass to a random eligible farmer.
-- If nobody eligible remains, the chain expires.
-- ----------------------------------------------------------------------------
create or replace function public.basket_auto_advance(p_chain uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_holder uuid;
  v_season uuid;
  v_next uuid;
  v_water integer;
  v_take integer;
  v_auto integer := greatest(public.game_setting_int('basket_auto_pass_water', 5), 0);
begin
  loop
    select * into c from public.traveling_basket_chains
      where id = p_chain and status = 'active'
      for update;
    exit when c.id is null;          -- chain ended
    exit when c.expires_at > now();  -- current hold still within its window

    v_holder := c.current_holder_user_id;
    v_season := c.season_id;

    select u.user_id into v_next
    from public.basket_eligible_users(v_season, p_chain) u
    where u.user_id <> v_holder
    order by random() limit 1;

    if v_next is null then
      update public.traveling_basket_chains
        set status = 'expired', current_holder_user_id = null
        where id = p_chain;
      exit;
    end if;

    select water_count into v_water from public.farms
      where user_id = v_holder and season_id = v_season
      for update;
    v_take := least(v_auto, coalesce(v_water, 0));
    if v_take > 0 then
      update public.farms set water_count = water_count - v_take
        where user_id = v_holder and season_id = v_season;
    end if;

    perform public.basket_do_pass(p_chain, v_holder, v_next, v_take, 0, 0, v_season);
    -- the new hold has a fresh (future) deadline, so the loop exits next pass
  end loop;
end;
$$;

revoke execute on function public.basket_auto_advance(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- create_or_get_today_basket: resolve any overdue chain, keep exactly one
-- active chain at a time, and start today's on a basket day.
-- ----------------------------------------------------------------------------
create or replace function public.create_or_get_today_basket()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active uuid;
  v_today uuid;
  v_season uuid;
  v_chain uuid;
  v_target integer;
  v_small integer := greatest(public.game_setting_int('basket_small_target_count', 5), 2);
  v_large integer := greatest(public.game_setting_int('basket_large_target_count', 10), 2);
  v_chance integer := least(greatest(public.game_setting_int('basket_large_basket_chance_percent', 15), 0), 100);
  v_hold integer := greatest(public.game_setting_int('basket_hold_hours', 24), 1);
  v_first uuid;
begin
  -- resolve any overdue holds on the current active chain
  select id into v_active from public.traveling_basket_chains
    where status = 'active' order by created_at limit 1;
  if v_active is not null then
    perform public.basket_auto_advance(v_active);
  end if;

  -- still an active chain? that's the one in play
  select id into v_active from public.traveling_basket_chains
    where status = 'active' order by created_at limit 1;
  if v_active is not null then
    return v_active;
  end if;

  -- no active chain — show today's resolved chain if it already ran
  select id into v_today from public.traveling_basket_chains
    where basket_date = current_date order by created_at desc limit 1;
  if v_today is not null then
    return v_today;
  end if;

  -- otherwise, start a fresh chain if today is a basket day
  if not public.basket_is_basket_day(current_date) then
    return null;
  end if;

  select id into v_season from public.seasons where status = 'active'
    order by ends_at limit 1;
  if v_season is null then
    return null;
  end if;

  select u.user_id into v_first
  from public.basket_eligible_users(v_season, null) u
  order by random() limit 1;
  if v_first is null then
    return null; -- nobody has enough water to hold it yet
  end if;

  v_target := case when random() * 100 < v_chance then v_large else v_small end;

  begin
    insert into public.traveling_basket_chains
      (season_id, basket_date, status, target_participant_count,
       started_user_id, current_holder_user_id, expires_at)
    values
      (v_season, current_date, 'active', v_target,
       v_first, v_first, now() + make_interval(hours => v_hold))
    returning id into v_chain;
  exception
    when unique_violation then
      select id into v_chain from public.traveling_basket_chains
        where basket_date = current_date order by created_at desc limit 1;
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
-- get_traveling_basket_state: limits are now per-person totals; also exposes
-- the hold deadline, the auto-pass amount, and the water floor to receive.
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
  v_floor integer := public.game_setting_int('basket_auto_pass_water', 5);
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
    'hold_expires_at', c.expires_at,
    'auto_pass_water', v_floor,
    'min_receive_water', v_floor,
    'limits', jsonb_build_object(
      'water_per_pass', public.game_setting_int('basket_max_water_per_pass', 25),
      'seed_per_pass', public.game_setting_int('basket_max_seed_per_pass', 1),
      'fertilizer_per_pass', public.game_setting_int('basket_max_fertilizer_per_pass', 2)),
    'eligible_recipients', v_recipients,
    'my_rewards', v_my_rewards);
end;
$$;

revoke execute on function public.get_traveling_basket_state() from public, anon;
grant execute on function public.get_traveling_basket_state() to authenticated;

-- ----------------------------------------------------------------------------
-- pass_traveling_basket: single active chain; TOTAL per-person limits (no
-- per-day layer); receiver water-floor enforced via eligibility.
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
  v_water integer := coalesce(p_water, 0);
  v_seed integer := coalesce(p_seed, 0);
  v_fert integer := coalesce(p_fertilizer, 0);
  v_max_water integer := public.game_setting_int('basket_max_water_per_pass', 25);
  v_max_seed integer := public.game_setting_int('basket_max_seed_per_pass', 1);
  v_max_fert integer := public.game_setting_int('basket_max_fertilizer_per_pass', 2);
  v_participants integer;
  v_locked boolean;
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
  if v_water > v_max_water or v_seed > v_max_seed or v_fert > v_max_fert then
    raise exception 'PASS_LIMIT_EXCEEDED';
  end if;
  if p_receiver = v_user then
    raise exception 'CANNOT_PASS_TO_SELF';
  end if;

  select * into c from public.traveling_basket_chains
    where status = 'active' order by created_at limit 1
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

  if not exists (
    select 1 from public.basket_eligible_users(c.season_id, c.id) u
    where u.user_id = p_receiver
  ) then
    raise exception 'RECEIVER_NOT_ELIGIBLE';
  end if;

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

  -- debit the holder; items now live in the basket
  update public.farms
    set water_count = water_count - v_water,
        seed_count = seed_count - v_seed,
        fertilizer_count = fertilizer_count - v_fert
    where id = v_farm.id;
  if v_fert > 0 then
    insert into public.fertilizer_events (user_id, season_id, amount, reason)
    values (v_user, c.season_id, -v_fert, 'basket_contribution');
  end if;

  v_locked := public.basket_do_pass(c.id, v_user, p_receiver, v_water, v_seed, v_fert, c.season_id);

  select count(*)::integer into v_participants
    from public.traveling_basket_touches where chain_id = c.id;

  return jsonb_build_object('locked_in', v_locked, 'participants', v_participants);
end;
$$;

revoke execute on function public.pass_traveling_basket(uuid, integer, integer, integer) from public, anon;
grant execute on function public.pass_traveling_basket(uuid, integer, integer, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- keep_traveling_basket: single active chain; must be within the hold window.
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
    where status = 'active' order by created_at limit 1
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
-- admin_cancel: operate on the single active chain.
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
    where status = 'active' order by created_at limit 1
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

-- ----------------------------------------------------------------------------
-- update_game_settings validator: drop per-day keys, add basket_hold_hours
-- (>= 1) and basket_auto_pass_water (>= 0).
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
  min_one_keys text[] := array['basket_keep_multiplier', 'basket_hold_hours'];
  number_keys text[] := array[
    'meeting_attendance_reward_amount', 'hosting_reward_amount',
    'giving_seed_reward_amount', 'receiving_seed_reward_amount',
    'receiving_seed_bonus_water',
    'basket_max_water_per_pass', 'basket_max_seed_per_pass',
    'basket_max_fertilizer_per_pass', 'basket_auto_pass_water',
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
        raise exception 'VALUE_TOO_SMALL for %', v_key;
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
