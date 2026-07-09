-- ============================================================================
-- Polish: admin-renamable house/barn names + blossom-first fertilizer.
--
-- 1. House/barn display names become game settings (house_name_house_1..6,
--    free text 1–40 chars). Defaults live in code ("Big Barn" is now
--    "Bando Barn"); the DB stores only admin overrides — the existing
--    update/reset/audit machinery applies unchanged. No new table needed,
--    and existing users' selected houses (avatar_config.house) are untouched.
--
-- 2. use_fertilizer now targets a waiting PINK BLOSSOM tree first (they pay
--    2x on harvest, so ripening them first is what players want), falling
--    back to the oldest waiting tree. Requires the blossom migration
--    (20260709130000) to be applied first.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. update_game_settings: add house-name text keys.
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
  percent_keys text[] := array['basket_large_basket_chance_percent', 'blossom_chance_percent'];
  min_two_keys text[] := array['basket_small_target_count', 'basket_large_target_count'];
  min_one_keys text[] := array['basket_keep_multiplier', 'basket_hold_hours', 'blossom_fruit_multiplier'];
  text_keys text[] := array[
    'house_name_house_1', 'house_name_house_2', 'house_name_house_3',
    'house_name_house_4', 'house_name_house_5', 'house_name_house_6'];
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
             || min_two_keys || min_one_keys || text_keys || number_keys;

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
    elsif v_key = any(text_keys) then
      if jsonb_typeof(v_val) <> 'string' then
        raise exception 'INVALID_TEXT for %', v_key;
      end if;
      v_txt := trim(v_val #>> '{}');
      if length(v_txt) < 1 or length(v_txt) > 40 then
        raise exception 'TEXT_LENGTH for %', v_key;
      end if;
      v_val := to_jsonb(v_txt);
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

-- ----------------------------------------------------------------------------
-- 2. use_fertilizer: pink blossom waiting trees ripen FIRST (they pay 2x on
--    harvest), then the oldest waiting tree. Everything else unchanged.
-- ----------------------------------------------------------------------------
create or replace function public.use_fertilizer()
returns table (fertilizer_left integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_farm uuid;
  v_season uuid;
  v_fert integer;
  v_tree uuid;
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select f.id, f.season_id, f.fertilizer_count into v_farm, v_season, v_fert
  from public.farms f
  join public.seasons s on s.id = f.season_id and s.status = 'active'
  where f.user_id = v_user
  for update of f;

  if v_farm is null then
    raise exception 'No farm this Season';
  end if;

  -- settle finished timers first (those trees are bearing, not waiting)
  update public.trees
    set growth_stage = 5, fruits_ready_at = null
    where farm_id = v_farm and status = 'active'
      and growth_stage = 4 and fruits_ready_at <= now();

  if v_fert < 1 then
    raise exception 'NO_FERTILIZER';
  end if;

  -- blossom trees first (2x harvest), then oldest waiting
  select t.id into v_tree
  from public.trees t
  where t.farm_id = v_farm and t.status = 'active'
    and t.growth_stage = 4 and t.fruits_ready_at > now()
  order by t.is_blossom desc, t.created_at
  limit 1;

  if v_tree is null then
    raise exception 'NO_WAITING_TREE';
  end if;

  -- ripen: the tree bears fruit NOW; harvesting stays the player's moment
  update public.trees
    set growth_stage = 5, fruits_ready_at = null
    where id = v_tree;

  update public.farms
    set fertilizer_count = fertilizer_count - 1
    where id = v_farm;

  insert into public.fertilizer_events (user_id, season_id, amount, reason)
  values (v_user, v_season, -1, 'used_on_tree');

  return query select v_fert - 1;
end;
$$;

revoke execute on function public.use_fertilizer() from public, anon;
grant execute on function public.use_fertilizer() to authenticated;
