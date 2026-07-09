-- ============================================================================
-- Admin debug tools (all admin-only, all audit-logged, all OFF by default).
--
-- 1. New game setting `debug_settings_enabled` (boolean, default false).
--    update_game_settings is recreated as v6 = the v5 arrays from
--    20260709170000 COPIED VERBATIM + this one key. ⚠️ Per the project's
--    migration ordering rule: never apply an older version of this function
--    on top; future recreations must copy THESE arrays first.
--
-- 2. Debug RPCs, each SECURITY DEFINER and double-gated: the caller must be
--    an admin (or the SQL editor / cron, where auth.uid() is null) AND the
--    `debug_settings_enabled` setting must be ON. Every mutation writes an
--    admin_audit_logs row prefixed `debug_`.
--
--      debug_list_inventories()               — players + current-season farm items
--      debug_set_inventory(user, w, s, f)     — set Water/Seed/Fertilizer (0..1e6)
--      debug_give_bundle(user)                — preset bundle (+25 W, +2 S, +2 F)
--      debug_reset_inventory(user)            — zero out Water/Seed/Fertilizer
--      debug_ripen_trees(user)                — all growing trees → ready to harvest
--      debug_advance_time(hours)              — pull every pending timer closer:
--                                               tree fruit timers, basket hold,
--                                               goose deadlines, season end
--      debug_run_game_tick()                  — run the scheduled jobs right now
--      debug_end_season_now()                 — end the active season + ceremony
--      debug_event_states()                   — snapshot of season/basket/goose
--
-- ECONOMY unchanged: nothing here grants Fruits. Inventory edits touch only
-- water_count / seed_count / fertilizer_count. fruit_total is read-only in
-- these tools; Fruits still come only from harvesting trees.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. update_game_settings v6 (v5 verbatim + debug_settings_enabled)
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
    'debug_settings_enabled'];
  percent_keys text[] := array['basket_large_basket_chance_percent', 'blossom_chance_percent'];
  min_two_keys text[] := array['basket_small_target_count', 'basket_large_target_count'];
  min_one_keys text[] := array['basket_keep_multiplier', 'basket_hold_hours', 'blossom_fruit_multiplier'];
  text_keys text[] := array[
    'house_name_house_1', 'house_name_house_2', 'house_name_house_3',
    'house_name_house_4', 'house_name_house_5', 'house_name_house_6',
    'season_name_1', 'season_name_2', 'season_name_3',
    'season_name_4', 'season_name_5'];
  season_length_keys text[] := array[
    'season_length_days_1', 'season_length_days_2', 'season_length_days_3',
    'season_length_days_4', 'season_length_days_5'];
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
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then raise exception 'INVALID_PAYLOAD'; end if;

  allowed := reward_type_keys || schedule_mode_keys || days_per_week_keys
             || enabled_days_keys || boolean_keys || percent_keys
             || min_two_keys || min_one_keys || text_keys
             || season_length_keys || number_keys;

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

-- ----------------------------------------------------------------------------
-- 2. Debug gate: admin (or owner/SQL editor) AND the setting switched ON.
-- ----------------------------------------------------------------------------
create or replace function public.assert_debug_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'NOT_ADMIN';
  end if;
  if not coalesce(public.game_setting_text('debug_settings_enabled', 'false')::boolean, false) then
    raise exception 'DEBUG_DISABLED';
  end if;
end;
$$;

revoke execute on function public.assert_debug_admin() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Inventory tools (Water / Seed / Fertilizer ONLY — never Fruits)
-- ----------------------------------------------------------------------------
create or replace function public.debug_list_inventories()
returns table (
  user_id uuid, username text, display_name text,
  water integer, seeds integer, fertilizer integer,
  fruit_total integer, tree_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_debug_admin();
  return query
    select p.user_id, p.username, p.display_name,
      f.water_count, f.seed_count, f.fertilizer_count,
      f.fruit_total,
      (select count(*) from public.trees t
        where t.farm_id = f.id and t.status = 'active')
    from public.farms f
    join public.seasons s on s.id = f.season_id and s.status = 'active'
    join public.profiles p on p.user_id = f.user_id
    order by p.username;
end;
$$;

create or replace function public.debug_set_inventory(
  p_user uuid, p_water integer, p_seed integer, p_fertilizer integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_farm uuid;
  v_old record;
begin
  perform public.assert_debug_admin();
  if p_water is null or p_seed is null or p_fertilizer is null
     or p_water < 0 or p_seed < 0 or p_fertilizer < 0
     or p_water > 1000000 or p_seed > 1000000 or p_fertilizer > 1000000 then
    raise exception 'QUANTITY_OUT_OF_RANGE';
  end if;

  select f.id, f.water_count, f.seed_count, f.fertilizer_count into v_old
  from public.farms f
  join public.seasons s on s.id = f.season_id and s.status = 'active'
  where f.user_id = p_user
  for update of f;
  if v_old.id is null then raise exception 'USER_NOT_FOUND'; end if;
  v_farm := v_old.id;

  update public.farms
    set water_count = p_water, seed_count = p_seed, fertilizer_count = p_fertilizer
    where id = v_farm;

  insert into public.admin_audit_logs (actor_user_id, action, metadata_json)
  values (auth.uid(), 'debug_inventory_set', jsonb_build_object(
    'target_user_id', p_user,
    'old', jsonb_build_object('water', v_old.water_count, 'seed', v_old.seed_count, 'fertilizer', v_old.fertilizer_count),
    'new', jsonb_build_object('water', p_water, 'seed', p_seed, 'fertilizer', p_fertilizer)));
end;
$$;

-- Preset test bundle. Server-side constants on purpose (never trust the
-- client): +25 Water, +2 Seeds, +2 Fertilizer. No Fruits — ever.
create or replace function public.debug_give_bundle(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_farm uuid;
begin
  perform public.assert_debug_admin();

  select f.id into v_farm
  from public.farms f
  join public.seasons s on s.id = f.season_id and s.status = 'active'
  where f.user_id = p_user
  for update of f;
  if v_farm is null then raise exception 'USER_NOT_FOUND'; end if;

  update public.farms
    set water_count = least(water_count + 25, 1000000),
        seed_count = least(seed_count + 2, 1000000),
        fertilizer_count = least(fertilizer_count + 2, 1000000)
    where id = v_farm;

  insert into public.admin_audit_logs (actor_user_id, action, metadata_json)
  values (auth.uid(), 'debug_bundle_granted', jsonb_build_object(
    'target_user_id', p_user, 'bundle', jsonb_build_object('water', 25, 'seed', 2, 'fertilizer', 2)));
end;
$$;

create or replace function public.debug_reset_inventory(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_farm uuid;
begin
  perform public.assert_debug_admin();

  select f.id into v_farm
  from public.farms f
  join public.seasons s on s.id = f.season_id and s.status = 'active'
  where f.user_id = p_user
  for update of f;
  if v_farm is null then raise exception 'USER_NOT_FOUND'; end if;

  update public.farms
    set water_count = 0, seed_count = 0, fertilizer_count = 0
    where id = v_farm;

  insert into public.admin_audit_logs (actor_user_id, action, metadata_json)
  values (auth.uid(), 'debug_inventory_reset', jsonb_build_object('target_user_id', p_user));
end;
$$;

-- All of a player's growing trees become ready to harvest. The 2x blossom
-- flag is untouched; Fruits are still only paid when the PLAYER harvests.
create or replace function public.debug_ripen_trees(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_farm uuid;
  v_count integer;
begin
  perform public.assert_debug_admin();

  select f.id into v_farm
  from public.farms f
  join public.seasons s on s.id = f.season_id and s.status = 'active'
  where f.user_id = p_user;
  if v_farm is null then raise exception 'USER_NOT_FOUND'; end if;

  update public.trees
    set growth_stage = 5, fruits_ready_at = null
    where farm_id = v_farm and status = 'active' and growth_stage < 5;
  get diagnostics v_count = row_count;

  insert into public.admin_audit_logs (actor_user_id, action, metadata_json)
  values (auth.uid(), 'debug_trees_ripened', jsonb_build_object(
    'target_user_id', p_user, 'trees', v_count));
  return v_count;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Time tools
-- ----------------------------------------------------------------------------
-- "Advance time" = pull every pending timer N hours closer to now: tree fruit
-- timers, the Traveling Basket hold deadline, Golden Goose phase deadlines,
-- and the active season's end. Follow with debug_run_game_tick() (or wait up
-- to 10 minutes for cron) to let expired timers resolve.
create or replace function public.debug_advance_time(p_hours integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift interval;
begin
  perform public.assert_debug_admin();
  if p_hours is null or p_hours < 1 or p_hours > 720 then
    raise exception 'HOURS_OUT_OF_RANGE';
  end if;
  v_shift := make_interval(hours => p_hours);

  update public.trees
    set fruits_ready_at = fruits_ready_at - v_shift
    where status = 'active' and fruits_ready_at is not null;

  update public.traveling_basket_chains
    set expires_at = expires_at - v_shift
    where status = 'active';

  update public.golden_goose_assignments
    set answer_collection_ends_at = answer_collection_ends_at - v_shift,
        selection_opens_at = selection_opens_at - v_shift,
        selection_deadline_at = selection_deadline_at - v_shift
    where status in ('answer_collection', 'selection_open');

  update public.seasons
    set ends_at = greatest(ends_at - v_shift, starts_at + interval '1 minute')
    where status = 'active';

  insert into public.admin_audit_logs (actor_user_id, action, metadata_json)
  values (auth.uid(), 'debug_time_advanced', jsonb_build_object('hours', p_hours));
end;
$$;

create or replace function public.debug_run_game_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_debug_admin();
  perform public.run_scheduled_game_jobs();
  insert into public.admin_audit_logs (actor_user_id, action, metadata_json)
  values (auth.uid(), 'debug_game_tick_run', '{}'::jsonb);
end;
$$;

-- End the active season right now and run the full ceremony (medals, badges,
-- fertilizer, next season in the cycle). Destructive-ish — the UI must ask
-- for strong confirmation.
create or replace function public.debug_end_season_now()
returns table (closed_season uuid, next_season uuid, medals_awarded integer, badges_awarded integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_debug_admin();

  update public.seasons set ends_at = now() where status = 'active';

  insert into public.admin_audit_logs (actor_user_id, action, metadata_json)
  values (auth.uid(), 'debug_season_ended', '{}'::jsonb);

  return query select * from public.close_season();
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Event-state snapshot (read-only)
-- ----------------------------------------------------------------------------
create or replace function public.debug_event_states()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  perform public.assert_debug_admin();
  select jsonb_build_object(
    'season', (select to_jsonb(x) from (
      select s.name, s.cycle_position, s.starts_at, s.ends_at
      from public.seasons s where s.status = 'active' limit 1) x),
    'basket', (select to_jsonb(x) from (
      select c.id, c.status, c.basket_date, c.target_participant_count,
             c.expires_at, p.username as holder
      from public.traveling_basket_chains c
      left join public.profiles p on p.user_id = c.current_holder_user_id
      order by c.created_at desc limit 1) x),
    'goose', (select to_jsonb(x) from (
      select g.id, g.status, g.assigned_date, g.selection_deadline_at,
             p.username as keeper
      from public.golden_goose_assignments g
      left join public.profiles p on p.user_id = g.keeper_user_id
      order by g.created_at desc limit 1) x)
  ) into v;
  return v;
end;
$$;

-- ----------------------------------------------------------------------------
-- Grants: clients may call (each function re-gates itself), never anon.
-- ----------------------------------------------------------------------------
revoke execute on function public.debug_list_inventories() from public, anon;
grant execute on function public.debug_list_inventories() to authenticated;
revoke execute on function public.debug_set_inventory(uuid, integer, integer, integer) from public, anon;
grant execute on function public.debug_set_inventory(uuid, integer, integer, integer) to authenticated;
revoke execute on function public.debug_give_bundle(uuid) from public, anon;
grant execute on function public.debug_give_bundle(uuid) to authenticated;
revoke execute on function public.debug_reset_inventory(uuid) from public, anon;
grant execute on function public.debug_reset_inventory(uuid) to authenticated;
revoke execute on function public.debug_ripen_trees(uuid) from public, anon;
grant execute on function public.debug_ripen_trees(uuid) to authenticated;
revoke execute on function public.debug_advance_time(integer) from public, anon;
grant execute on function public.debug_advance_time(integer) to authenticated;
revoke execute on function public.debug_run_game_tick() from public, anon;
grant execute on function public.debug_run_game_tick() to authenticated;
revoke execute on function public.debug_end_season_now() from public, anon;
grant execute on function public.debug_end_season_now() to authenticated;
revoke execute on function public.debug_event_states() from public, anon;
grant execute on function public.debug_event_states() to authenticated;
