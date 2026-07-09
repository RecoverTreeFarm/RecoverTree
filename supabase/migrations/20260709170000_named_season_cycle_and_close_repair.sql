-- ============================================================================
-- Named season cycle + close_season repair + pg_cron scheduling.
--
-- WHAT CHANGES
-- 1. Seasons are no longer calendar months. Five named seasons cycle forever:
--      1 Sparch → 2 Maypril → 3 Junduly → 4 Suntember → 5 Octobrrr → 1 Sparch…
--    Each is 30 days by default. Admins can rename each season and change each
--    length (settings keys season_name_1..5 / season_length_days_1..5); edits
--    apply to the CURRENTLY RUNNING season immediately (name + end date).
--    The very first season a community ever gets is Sparch.
--
-- 2. close_season is repaired. Previously it closed whatever season was
--    "active" — even one that hadn't ended (that is how the dev DB got a
--    month-ahead season), and once the lazy rollover in ensure_my_farm /
--    start_meeting / give_seed had flipped the ended season to 'closed' and
--    created the next one, close_season could no longer ceremony the ended
--    month at all (bare call targeted the NEW season; explicit call collided
--    with the seasons_one_active_key unique index). Now it:
--      * targets the season whose ends_at has passed and whose ceremony has
--        not run (new seasons.ceremony_completed_at marker),
--      * refuses to close a season that has not ended,
--      * reuses an already-created next season instead of inserting a second
--        'active' row,
--      * returns quietly (no rows) when there is nothing to close, so it is
--        safe to run on a schedule.
--
-- 3. pg_cron runs public.run_scheduled_game_jobs() every 10 minutes: season
--    close/ceremony, Traveling Basket auto-advance, Golden Goose auto-close.
--    All three were previously lazy-only (resolved on dashboard load).
--
-- ⚠️ update_game_settings is recreated below. Per the project's migration
-- ordering rule, its allowed-key arrays are copied VERBATIM from the live
-- v4 definition (150000 lineage, including goose keys) and only EXTENDED with
-- the ten season keys. Never apply an older version of this function on top.
--
-- ECONOMY unchanged: ceremony rewards remain fertilizer; Fruits still come
-- only from harvesting trees.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Schema: cycle position + ceremony marker
-- ----------------------------------------------------------------------------
alter table public.seasons
  add column if not exists cycle_position integer
    check (cycle_position between 1 and 5);

alter table public.seasons
  add column if not exists ceremony_completed_at timestamptz;

-- ----------------------------------------------------------------------------
-- 2. Season-cycle helpers (defaults live here; admin overrides in settings)
-- ----------------------------------------------------------------------------
create or replace function public.season_cycle_name(p_pos integer)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.game_setting_text(
    'season_name_' || p_pos,
    (array['Sparch', 'Maypril', 'Junduly', 'Suntember', 'Octobrrr'])[p_pos]
  );
$$;

create or replace function public.season_cycle_length_days(p_pos integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(public.game_setting_int('season_length_days_' || p_pos, 30), 1);
$$;

revoke execute on function public.season_cycle_name(integer) from public, anon, authenticated;
revoke execute on function public.season_cycle_length_days(integer) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. ensure_active_season v3: creates the NEXT season in the cycle.
--    First season ever = Sparch (position 1), starting now, regardless of the
--    calendar month. Pre-cycle seasons (cycle_position null) roll into Sparch.
-- ----------------------------------------------------------------------------
create or replace function public.ensure_active_season()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_pos integer;
begin
  select id into v_id from public.seasons where status = 'active' limit 1;
  if v_id is null then
    select coalesce(cycle_position, 0) % 5 + 1 into v_pos
    from public.seasons order by ends_at desc limit 1;
    v_pos := coalesce(v_pos, 1);

    insert into public.seasons (name, starts_at, ends_at, status, cycle_position)
    values (
      public.season_cycle_name(v_pos),
      now(),
      now() + make_interval(days => public.season_cycle_length_days(v_pos)),
      'active',
      v_pos
    )
    returning id into v_id;
  end if;
  perform public.pick_season_checklist(v_id);
  return v_id;
end;
$$;

revoke execute on function public.ensure_active_season() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. close_season v2: ceremony for a season that has actually ENDED.
--    Safe under cron, safe after a lazy rollover, quiet when nothing to do.
--    To end a season early, shorten its length in Admin → Game settings
--    (applies immediately) — do not force-close.
-- ----------------------------------------------------------------------------
create or replace function public.close_season(p_season uuid default null)
returns table (closed_season uuid, next_season uuid, medals_awarded integer, badges_awarded integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season uuid;
  v_next uuid;
  v_pos integer;
  v_medals integer := 0;
  v_badges integer := 0;
  v_chosen integer := 0;
  r record;
  v_medal text;
  v_fert integer;
  v_key text;
  v_win record;
  v_badge_id uuid;
begin
  -- admins (or cron / the SQL editor / service role, where auth.uid() is null)
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Only admins can close a season';
  end if;

  -- target: an ENDED season whose ceremony has not run yet
  select s.id into v_season
  from public.seasons s
  where s.ceremony_completed_at is null
    and s.ends_at <= now()
    and s.status in ('active', 'closed')
    and (p_season is null or s.id = p_season)
  order by s.ends_at
  limit 1;

  if v_season is null then
    return;  -- nothing has ended (or already processed) — quiet no-op for cron
  end if;

  update public.seasons
    set status = 'closed', ceremony_completed_at = now()
    where id = v_season;

  -- next season: reuse the one the lazy rollover may already have created,
  -- otherwise create the next season in the cycle
  select id into v_next from public.seasons where status = 'active' limit 1;
  if v_next is null then
    select coalesce(cycle_position, 0) % 5 + 1 into v_pos
      from public.seasons where id = v_season;
    v_pos := coalesce(v_pos, 1);

    insert into public.seasons (name, starts_at, ends_at, status, cycle_position)
    values (
      public.season_cycle_name(v_pos),
      now(),
      now() + make_interval(days => public.season_cycle_length_days(v_pos)),
      'active',
      v_pos
    )
    returning id into v_next;
    perform public.pick_season_checklist(v_next);
  end if;

  -- MEDALS: top 3 by Fruits (fertilizer rewards land in the next season)
  for r in
    select f.user_id, f.fruit_total,
      row_number() over (order by f.fruit_total desc, f.created_at) as rn
    from public.farms f
    join public.profiles p on p.user_id = f.user_id and not p.is_banned
    where f.season_id = v_season and f.fruit_total > 0
    order by f.fruit_total desc
    limit 3
  loop
    v_medal := case r.rn when 1 then 'gold' when 2 then 'silver' else 'bronze' end;
    v_fert := case r.rn when 1 then 3 when 2 then 2 else 1 end;
    insert into public.user_medals (user_id, season_id, medal_type, rank)
      values (r.user_id, v_season, v_medal, r.rn::int)
      on conflict do nothing;
    perform public.grant_fertilizer(r.user_id, v_next, v_fert, 'medal_reward');
    v_medals := v_medals + 1;
  end loop;

  -- BADGES: shuffle categories, take the first 3 that have a valid winner
  for v_key in
    select key from public.badge_definitions where active order by random()
  loop
    exit when v_chosen >= 3;
    select * into v_win from public.pick_badge_winner(v_season, v_key);
    if v_win.valid then
      select id into v_badge_id from public.badge_definitions where key = v_key;
      insert into public.season_badge_categories (season_id, badge_definition_id)
        values (v_season, v_badge_id) on conflict do nothing;
      insert into public.user_badges (user_id, season_id, badge_definition_id)
        values (v_win.winner, v_season, v_badge_id) on conflict do nothing;
      perform public.grant_fertilizer(v_win.winner, v_next, 1, 'badge_reward');
      v_badges := v_badges + 1;
      v_chosen := v_chosen + 1;
    end if;
  end loop;

  return query select v_season, v_next, v_medals, v_badges;
end;
$$;

revoke execute on function public.close_season(uuid) from public, anon;
grant execute on function public.close_season(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. update_game_settings v5 = live v4 (verbatim key arrays) + season keys.
--    New: season_name_1..5 (text, validated with the house names) and
--    season_length_days_1..5 (integer days, 1–365). When a season setting
--    changes, the ACTIVE season's name and end date are re-derived immediately.
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
    'goose_opt_in_required_for_private_users'];
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
-- 6. The scheduled tick: season ceremony, basket auto-advance, goose auto-close.
--    Each job is isolated so one failure cannot starve the others.
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
end;
$$;

revoke execute on function public.run_scheduled_game_jobs() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7. pg_cron: every 10 minutes
-- ----------------------------------------------------------------------------
create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'recovertree-game-tick') then
    perform cron.unschedule('recovertree-game-tick');
  end if;
  perform cron.schedule(
    'recovertree-game-tick',
    '*/10 * * * *',
    'select public.run_scheduled_game_jobs()'
  );
end
$$;

-- ----------------------------------------------------------------------------
-- 8. Backfill + one-time reset onto the cycle.
--    Every pre-cycle closed season is marked ceremony-done so cron never
--    revisits it; any currently active pre-cycle season is retired quietly
--    (dev DB: the accidental future-dated "August 2026"); then a fresh Sparch
--    starts today. Users get their new farm + starter tree on next dashboard
--    load via ensure_my_farm. On a fresh database this simply creates Sparch.
-- ----------------------------------------------------------------------------
update public.seasons
  set ceremony_completed_at = now()
  where status = 'closed' and ceremony_completed_at is null;

update public.seasons
  set status = 'closed', ceremony_completed_at = now()
  where status = 'active' and cycle_position is null;

select public.ensure_active_season();
