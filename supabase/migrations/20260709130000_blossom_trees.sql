-- ============================================================================
-- Pink blossom trees (visual + a 2x harvest bonus).
--
-- When a tree finishes growing (reaches stage 4 and starts its fruit timer),
-- it has a chance (default 15%, admin-configurable) to become a PINK BLOSSOM
-- tree. A blossom tree looks pink while bearing and pays out DOUBLE Fruits on
-- harvest (default 2x, configurable). After harvest it reverts to a normal
-- green tree.
--
-- ECONOMY: Fruits still come ONLY from harvesting a tree — this is a harvest
-- multiplier, not a new direct award. Water/seed/fertilizer are untouched.
-- ============================================================================

alter table public.trees
  add column if not exists is_blossom boolean not null default false;

-- ----------------------------------------------------------------------------
-- water_my_trees v7: reaching stage 4 rolls the blossom chance.
-- ----------------------------------------------------------------------------
create or replace function public.water_my_trees()
returns table (water_left integer, trees_advanced integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  c_water_per_plant constant integer := 10;
  c_fruit_wait constant interval := interval '4 hours';
  v_chance integer := least(greatest(public.game_setting_int('blossom_chance_percent', 15), 0), 100);
  v_user uuid := auth.uid();
  v_farm uuid;
  v_water integer;
  v_afford integer;
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

  -- settle finished fruit timers first
  update public.trees
    set growth_stage = 5, fruits_ready_at = null
    where farm_id = v_farm and status = 'active'
      and growth_stage = 4 and fruits_ready_at <= now();

  v_afford := floor(v_water / c_water_per_plant);

  if v_afford > 0 then
    with targets as (
      select t.id from public.trees t
      where t.farm_id = v_farm and t.status = 'active' and t.growth_stage < 4
      order by t.created_at
      limit v_afford
    )
    update public.trees tr
      set growth_stage = tr.growth_stage + 1,
          fruits_ready_at = case
            when tr.growth_stage + 1 = 4 then now() + c_fruit_wait
            else tr.fruits_ready_at
          end,
          -- roll the rare pink blossom the moment the tree finishes growing
          is_blossom = case
            when tr.growth_stage + 1 = 4 then (random() * 100 < v_chance)
            else tr.is_blossom
          end
      from targets
      where tr.id = targets.id;
    get diagnostics v_advanced = row_count;

    if v_advanced > 0 then
      v_water := v_water - (v_advanced * c_water_per_plant);
      update public.farms set water_count = v_water where id = v_farm;
    end if;
  end if;

  return query select v_water, v_advanced;
end;
$$;

revoke execute on function public.water_my_trees() from public, anon;
grant execute on function public.water_my_trees() to authenticated;

-- ----------------------------------------------------------------------------
-- harvest_my_trees v2: blossom trees pay 2x; reverts to green on harvest.
-- ----------------------------------------------------------------------------
create or replace function public.harvest_my_trees()
returns table (trees_harvested integer, fruits_earned integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  c_fruits_per_tree constant integer := 10;
  v_mult integer := greatest(public.game_setting_int('blossom_fruit_multiplier', 2), 1);
  v_user uuid := auth.uid();
  v_farm uuid;
  v_season uuid;
  v_count integer := 0;
  v_total integer := 0;
  v_amt integer;
  r record;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select f.id, f.season_id into v_farm, v_season
  from public.farms f
  join public.seasons s on s.id = f.season_id and s.status = 'active'
  where f.user_id = v_user
  for update of f;

  if v_farm is null then
    raise exception 'No farm this Season';
  end if;

  update public.trees
    set growth_stage = 5, fruits_ready_at = null
    where farm_id = v_farm and status = 'active'
      and growth_stage = 4 and fruits_ready_at <= now();

  for r in
    select t.id, t.is_blossom from public.trees t
    where t.farm_id = v_farm and t.status = 'active' and t.growth_stage = 5
    order by t.created_at
  loop
    v_amt := c_fruits_per_tree * (case when r.is_blossom then v_mult else 1 end);

    update public.trees
      set growth_stage = 1,
          fruits_ready_at = null,
          is_blossom = false,
          fruits_generated = fruits_generated + v_amt
      where id = r.id;

    insert into public.fruit_events
      (user_id, season_id, amount, source_type, source_id, description)
    values
      (v_user, v_season, v_amt, 'harvest', r.id,
       case when r.is_blossom then 'Harvested a blossom tree (2x)' else 'Harvested a tree' end);

    v_count := v_count + 1;
    v_total := v_total + v_amt;
  end loop;

  if v_count > 0 then
    update public.farms
      set fruit_total = fruit_total + v_total
      where id = v_farm;
  end if;

  return query select v_count, v_total;
end;
$$;

revoke execute on function public.harvest_my_trees() from public, anon;
grant execute on function public.harvest_my_trees() to authenticated;

-- ----------------------------------------------------------------------------
-- update_game_settings: add blossom_chance_percent (0-100) and
-- blossom_fruit_multiplier (>= 1) to the validated key list.
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
  percent_keys text[] := array['basket_large_basket_chance_percent', 'blossom_chance_percent'];
  min_two_keys text[] := array['basket_small_target_count', 'basket_large_target_count'];
  min_one_keys text[] := array['basket_keep_multiplier', 'basket_hold_hours', 'blossom_fruit_multiplier'];
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
