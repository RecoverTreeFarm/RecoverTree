-- ============================================================================
-- Admin console + database-backed game settings
--
-- Adds:
--   1. game_settings — a key/value_json override table. Code holds the safe
--      defaults; the DB only stores admin OVERRIDES. A key present here means
--      "customized"; absent means "use the built-in default".
--   2. game_setting_int / game_setting_text — internal readers used by reward
--      functions so amounts are configurable without code changes.
--   3. Existing reward AMOUNTS wired to settings (defaults preserve today's
--      economy exactly): meeting attendance, hosting, and seed give/receive.
--   4. Admin write functions (all guarded by is_admin(), all audit-logged):
--      set_user_role, set_user_ban, invalidate_meeting_code,
--      update_game_settings, reset_game_settings_to_defaults,
--      update_checklist_reward.
--   5. Admin read functions: list_admin_users, list_admin_meeting_sessions,
--      list_admin_audit_logs, list_admin_checklist_goals, get_game_settings.
--
-- ECONOMY GUARANTEE: Fruits are NEVER a reward type here. Rewards are only
-- water / seed / fertilizer, enforced server-side. Fruits stay harvest-only.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. game_settings table (admin overrides only; defaults live in code)
-- ----------------------------------------------------------------------------
create table if not exists public.game_settings (
  key text primary key,
  value_json jsonb not null,
  description text,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.game_settings enable row level security;

-- Game-balance params are not secret; any signed-in user (and future game
-- mechanics) may READ them. WRITES happen only via the SECURITY DEFINER admin
-- functions below — there is deliberately no insert/update/delete policy.
drop policy if exists "game_settings: readable by members" on public.game_settings;
create policy "game_settings: readable by members"
  on public.game_settings for select to authenticated
  using (true);

-- ----------------------------------------------------------------------------
-- 2. Internal readers (default-fallback). Used inside other SECURITY DEFINER
--    functions, so they don't need client grants.
-- ----------------------------------------------------------------------------
create or replace function public.game_setting_int(p_key text, p_default integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select (g.value_json #>> '{}')::integer
       from public.game_settings g where g.key = p_key),
    p_default);
$$;

create or replace function public.game_setting_text(p_key text, p_default text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select (g.value_json #>> '{}')
       from public.game_settings g where g.key = p_key),
    p_default);
$$;

revoke execute on function public.game_setting_int(text, integer) from public, anon, authenticated;
revoke execute on function public.game_setting_text(text, text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Wire existing reward AMOUNTS to settings (defaults = today's values).
--    Only the constant numbers change to setting reads; all other logic is
--    byte-for-byte the current behaviour.
-- ----------------------------------------------------------------------------

-- 3a. Meeting attendance: water only (Fruits are harvest-only). Amount now
--     configurable via meeting_attendance_reward_amount (default 10).
create or replace function public.redeem_meeting_code(p_code text)
returns table (water_awarded integer, host_username text)
language plpgsql
security definer
set search_path = public
as $$
declare
  c_water integer := public.game_setting_int('meeting_attendance_reward_amount', 10);
  v_user uuid := auth.uid();
  v_banned boolean;
  v_session record;
  v_farm uuid;
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select p.is_banned into v_banned
  from public.profiles p where p.user_id = v_user;
  if v_banned is null then
    raise exception 'NO_PROFILE';
  end if;
  if v_banned then
    raise exception 'BANNED';
  end if;

  if p_code !~ '^[0-9]{4}$' then
    raise exception 'INVALID_CODE';
  end if;

  select m.id, m.host_user_id, m.season_id, m.expires_at into v_session
  from public.meeting_sessions m
  where m.code = p_code and m.status = 'active'
  order by m.starts_at desc
  limit 1;

  if v_session.id is null then
    raise exception 'INVALID_CODE';
  end if;
  if v_session.expires_at <= now() then
    raise exception 'CODE_EXPIRED';
  end if;
  if exists (
    select 1 from public.meeting_attendance a
    where a.meeting_session_id = v_session.id and a.attendee_user_id = v_user
  ) then
    raise exception 'ALREADY_REDEEMED';
  end if;

  insert into public.farms (user_id, season_id)
  values (v_user, v_session.season_id)
  on conflict (user_id, season_id) do nothing;

  select f.id into v_farm
  from public.farms f
  where f.user_id = v_user and f.season_id = v_session.season_id;

  if not exists (
    select 1 from public.trees t
    where t.farm_id = v_farm and t.created_reason = 'starter'
  ) then
    insert into public.trees (farm_id, user_id, season_id, created_reason)
    values (v_farm, v_user, v_session.season_id, 'starter');
  end if;

  insert into public.meeting_attendance
    (meeting_session_id, host_user_id, attendee_user_id, season_id)
  values
    (v_session.id, v_session.host_user_id, v_user, v_session.season_id);

  -- water only — Fruits are earned by harvesting
  update public.farms
    set water_count = water_count + c_water
    where id = v_farm;

  return query
    select c_water,
      (select p.username from public.profiles p
        where p.user_id = v_session.host_user_id);
end;
$$;

revoke execute on function public.redeem_meeting_code(text) from public, anon;
grant execute on function public.redeem_meeting_code(text) to authenticated;

-- 3b. Hosting: +water for the host when a NEW code is created. Amount now
--     configurable via hosting_reward_amount (default 10).
create or replace function public.start_meeting()
returns table (meeting_session_id uuid, code text, expires_at timestamptz, already_active boolean, water_earned integer)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  c_code_lifetime constant interval := interval '90 minutes';
  c_host_water integer := public.game_setting_int('hosting_reward_amount', 10);
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

  -- Hosting is participation too: +water for the host's farm.
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

revoke execute on function public.start_meeting() from public, anon;
grant execute on function public.start_meeting() to authenticated;

-- 3c. Seeds: giver water + receiver seed(s) + optional receiver bonus water,
--     all configurable (defaults preserve today's economy: 10 / 1 / 0).
create or replace function public.give_seed(p_receiver_user_id uuid)
returns table (receiver_username text, water_earned integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  c_giver_water integer := public.game_setting_int('giving_seed_reward_amount', 10);
  c_receiver_seeds integer := public.game_setting_int('receiving_seed_reward_amount', 1);
  c_receiver_bonus_water integer := public.game_setting_int('receiving_seed_bonus_water', 0);
  v_user uuid := auth.uid();
  v_giver_banned boolean;
  v_receiver record;
  v_season uuid;
  v_giver_farm uuid;
  v_receiver_farm uuid;
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select p.is_banned into v_giver_banned
  from public.profiles p where p.user_id = v_user;
  if v_giver_banned is null then
    raise exception 'NO_PROFILE';
  end if;
  if v_giver_banned then
    raise exception 'BANNED';
  end if;

  if p_receiver_user_id = v_user then
    raise exception 'SELF_SEED';
  end if;

  select p.user_id, p.username, p.is_banned into v_receiver
  from public.profiles p where p.user_id = p_receiver_user_id;
  if v_receiver.user_id is null or v_receiver.is_banned then
    raise exception 'RECEIVER_NOT_FOUND';
  end if;

  update public.seasons
    set status = 'closed'
    where status = 'active' and ends_at <= now();
  v_season := public.ensure_active_season();

  if exists (
    select 1 from public.seed_events e
    where e.giver_user_id = v_user and e.given_on_date = current_date
  ) then
    raise exception 'ALREADY_SENT_TODAY';
  end if;

  -- Both farms must exist this Season (with their starter trees).
  insert into public.farms (user_id, season_id)
  values (v_user, v_season), (p_receiver_user_id, v_season)
  on conflict (user_id, season_id) do nothing;

  select f.id into v_giver_farm
  from public.farms f where f.user_id = v_user and f.season_id = v_season;
  select f.id into v_receiver_farm
  from public.farms f where f.user_id = p_receiver_user_id and f.season_id = v_season;

  if not exists (select 1 from public.trees t
                 where t.farm_id = v_giver_farm and t.created_reason = 'starter') then
    insert into public.trees (farm_id, user_id, season_id, created_reason)
    values (v_giver_farm, v_user, v_season, 'starter');
  end if;
  if not exists (select 1 from public.trees t
                 where t.farm_id = v_receiver_farm and t.created_reason = 'starter') then
    insert into public.trees (farm_id, user_id, season_id, created_reason)
    values (v_receiver_farm, p_receiver_user_id, v_season, 'starter');
  end if;

  -- The Seed itself (unique index backstops the daily limit).
  insert into public.seed_events (giver_user_id, receiver_user_id, season_id)
  values (v_user, p_receiver_user_id, v_season);

  -- Giver: +water. Receiver: +plantable seed(s) (+ optional bonus water).
  update public.farms set water_count = water_count + c_giver_water
    where id = v_giver_farm;
  update public.farms
    set seed_count = seed_count + c_receiver_seeds,
        water_count = water_count + c_receiver_bonus_water
    where id = v_receiver_farm;

  return query select v_receiver.username, c_giver_water;
exception
  when unique_violation then
    raise exception 'ALREADY_SENT_TODAY';
end;
$$;

revoke execute on function public.give_seed(uuid) from public, anon;
grant execute on function public.give_seed(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Admin write functions (guarded + audit-logged)
-- ----------------------------------------------------------------------------

-- 4a. Change a user's role. Cannot demote the last remaining active admin.
create or replace function public.set_user_role(p_target uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text;
  v_admin_count integer;
begin
  if not public.is_admin() then
    raise exception 'NOT_ADMIN';
  end if;
  if p_role not in ('member', 'meeting_host', 'admin') then
    raise exception 'INVALID_ROLE';
  end if;

  select role into v_old from public.profiles where user_id = p_target;
  if v_old is null then
    raise exception 'USER_NOT_FOUND';
  end if;
  if v_old = p_role then
    return; -- nothing to do; no audit noise
  end if;

  if v_old = 'admin' and p_role <> 'admin' then
    select count(*) into v_admin_count
    from public.profiles where role = 'admin' and not is_banned;
    if v_admin_count <= 1 then
      raise exception 'LAST_ADMIN';
    end if;
  end if;

  update public.profiles set role = p_role where user_id = p_target;

  insert into public.admin_audit_logs (actor_user_id, target_user_id, action, metadata_json)
  values (auth.uid(), p_target, 'role_changed',
          jsonb_build_object('old_role', v_old, 'new_role', p_role));
end;
$$;

revoke execute on function public.set_user_role(uuid, text) from public, anon;
grant execute on function public.set_user_role(uuid, text) to authenticated;

-- 4b. Ban / unban. Admins cannot ban themselves, nor ban the last active admin.
create or replace function public.set_user_ban(
  p_target uuid, p_is_banned boolean, p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old boolean;
  v_role text;
  v_admin_count integer;
begin
  if not public.is_admin() then
    raise exception 'NOT_ADMIN';
  end if;
  if p_target = auth.uid() and p_is_banned then
    raise exception 'CANNOT_BAN_SELF';
  end if;

  select is_banned, role into v_old, v_role
  from public.profiles where user_id = p_target;
  if v_old is null then
    raise exception 'USER_NOT_FOUND';
  end if;

  if p_is_banned and v_role = 'admin' then
    select count(*) into v_admin_count
    from public.profiles where role = 'admin' and not is_banned;
    if v_admin_count <= 1 then
      raise exception 'LAST_ADMIN';
    end if;
  end if;

  if v_old = p_is_banned then
    return; -- already in the requested state
  end if;

  update public.profiles
    set is_banned = p_is_banned,
        banned_reason = case when p_is_banned then p_reason else null end
    where user_id = p_target;

  insert into public.admin_audit_logs (actor_user_id, target_user_id, action, metadata_json)
  values (auth.uid(), p_target,
          case when p_is_banned then 'user_banned' else 'user_unbanned' end,
          jsonb_build_object('reason', p_reason));
end;
$$;

revoke execute on function public.set_user_ban(uuid, boolean, text) from public, anon;
grant execute on function public.set_user_ban(uuid, boolean, text) to authenticated;

-- 4c. Invalidate an active meeting code (kills it before its 90 minutes).
create or replace function public.invalidate_meeting_code(p_session uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host uuid;
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'NOT_ADMIN';
  end if;

  select host_user_id, status into v_host, v_status
  from public.meeting_sessions where id = p_session;
  if v_host is null then
    raise exception 'SESSION_NOT_FOUND';
  end if;
  if v_status <> 'active' then
    raise exception 'NOT_ACTIVE';
  end if;

  update public.meeting_sessions
    set status = 'invalidated', ended_at = now()
    where id = p_session;

  insert into public.admin_audit_logs (actor_user_id, target_user_id, action, metadata_json)
  values (auth.uid(), v_host, 'meeting_code_invalidated',
          jsonb_build_object('meeting_session_id', p_session));
end;
$$;

revoke execute on function public.invalidate_meeting_code(uuid) from public, anon;
grant execute on function public.invalidate_meeting_code(uuid) to authenticated;

-- 4d. Edit a checklist goal's reward (water + fertilizer, never Fruits).
create or replace function public.update_checklist_reward(
  p_definition_id uuid, p_water integer, p_fertilizer integer
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
begin
  if not public.is_admin() then
    raise exception 'NOT_ADMIN';
  end if;
  if p_water is null or p_fertilizer is null or p_water < 0 or p_fertilizer < 0 then
    raise exception 'NEGATIVE_NOT_ALLOWED';
  end if;

  select key, water_reward, fertilizer_reward
    into v_key, v_old_water, v_old_fert
  from public.checklist_definitions where id = p_definition_id;
  if v_key is null then
    raise exception 'GOAL_NOT_FOUND';
  end if;

  update public.checklist_definitions
    set water_reward = p_water, fertilizer_reward = p_fertilizer
    where id = p_definition_id;

  insert into public.admin_audit_logs (actor_user_id, action, metadata_json)
  values (auth.uid(), 'checklist_reward_updated',
          jsonb_build_object(
            'goal_id', p_definition_id, 'key', v_key,
            'old', jsonb_build_object('water', v_old_water, 'fertilizer', v_old_fert),
            'new', jsonb_build_object('water', p_water, 'fertilizer', p_fertilizer)));
end;
$$;

revoke execute on function public.update_checklist_reward(uuid, integer, integer) from public, anon;
grant execute on function public.update_checklist_reward(uuid, integer, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 4e. Game settings: validate + upsert overrides, audit the diff.
--     Rewards can ONLY be water/seed/fertilizer (fruits rejected). Negative
--     amounts rejected. Schedule values validated. Unknown keys rejected.
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
    'basket_receive_reward_type', 'basket_pass_reward_type',
    'basket_milestone_reward_type', 'goose_keeper_completion_reward_type'];
  schedule_mode_keys text[] := array['basket_schedule_mode', 'goose_schedule_mode'];
  days_per_week_keys text[] := array['basket_random_days_per_week', 'goose_random_days_per_week'];
  enabled_days_keys text[] := array['basket_enabled_days', 'goose_enabled_days'];
  boolean_keys text[] := array[
    'basket_contributions_enabled', 'basket_double_back_enabled',
    'goose_auto_select_enabled', 'goose_pass_enabled',
    'goose_opt_in_required_for_private_users'];
  number_keys text[] := array[
    'meeting_attendance_reward_amount', 'hosting_reward_amount',
    'giving_seed_reward_amount', 'receiving_seed_reward_amount',
    'receiving_seed_bonus_water',
    'basket_receive_reward_amount', 'basket_pass_reward_amount',
    'basket_milestone_interval', 'basket_milestone_reward_amount',
    'basket_max_water_per_pass', 'basket_max_seed_per_pass',
    'basket_max_fertilizer_per_pass', 'basket_max_water_per_day',
    'basket_max_seed_per_day', 'basket_max_fertilizer_per_day',
    'basket_double_back_multiplier',
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
             || enabled_days_keys || boolean_keys || number_keys;

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

-- 4f. Reset: drop all overrides so code defaults apply again.
create or replace function public.reset_game_settings_to_defaults()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.is_admin() then
    raise exception 'NOT_ADMIN';
  end if;

  select count(*) into v_count from public.game_settings;
  delete from public.game_settings;

  insert into public.admin_audit_logs (actor_user_id, action, metadata_json)
  values (auth.uid(), 'game_settings_reset',
          jsonb_build_object('cleared_overrides', v_count));
end;
$$;

revoke execute on function public.reset_game_settings_to_defaults() from public, anon;
grant execute on function public.reset_game_settings_to_defaults() to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Admin read functions
-- ----------------------------------------------------------------------------
create or replace function public.get_game_settings()
returns table (key text, value_json jsonb, updated_at timestamptz, updated_by uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
    select g.key, g.value_json, g.updated_at, g.updated_by
    from public.game_settings g
    order by g.key;
end;
$$;

revoke execute on function public.get_game_settings() from public, anon;
grant execute on function public.get_game_settings() to authenticated;

create or replace function public.list_admin_users()
returns table (
  user_id uuid, username text, display_name text, email text,
  role text, is_banned boolean, banned_reason text, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'NOT_ADMIN';
  end if;
  return query
    select p.user_id, p.username, p.display_name, u.email::text,
           p.role, p.is_banned, p.banned_reason, p.created_at
    from public.profiles p
    left join auth.users u on u.id = p.user_id
    order by p.created_at desc;
end;
$$;

revoke execute on function public.list_admin_users() from public, anon;
grant execute on function public.list_admin_users() to authenticated;

create or replace function public.list_admin_meeting_sessions()
returns table (
  id uuid, host_user_id uuid, host_username text, status text,
  starts_at timestamptz, expires_at timestamptz, ended_at timestamptz,
  attendance_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'NOT_ADMIN';
  end if;
  return query
    select m.id, m.host_user_id, p.username, m.status,
           m.starts_at, m.expires_at, m.ended_at,
           (select count(*) from public.meeting_attendance a
              where a.meeting_session_id = m.id)
    from public.meeting_sessions m
    left join public.profiles p on p.user_id = m.host_user_id
    order by m.starts_at desc
    limit 100;
end;
$$;

revoke execute on function public.list_admin_meeting_sessions() from public, anon;
grant execute on function public.list_admin_meeting_sessions() to authenticated;

create or replace function public.list_admin_audit_logs()
returns table (
  id uuid, created_at timestamptz,
  actor_user_id uuid, actor_username text,
  target_user_id uuid, target_username text,
  action text, metadata_json jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'NOT_ADMIN';
  end if;
  return query
    select l.id, l.created_at,
           l.actor_user_id, ap.username,
           l.target_user_id, tp.username,
           l.action, l.metadata_json
    from public.admin_audit_logs l
    left join public.profiles ap on ap.user_id = l.actor_user_id
    left join public.profiles tp on tp.user_id = l.target_user_id
    order by l.created_at desc
    limit 200;
end;
$$;

revoke execute on function public.list_admin_audit_logs() from public, anon;
grant execute on function public.list_admin_audit_logs() to authenticated;

create or replace function public.list_admin_checklist_goals()
returns table (
  id uuid, key text, name text, description text,
  water_reward integer, fertilizer_reward integer,
  active boolean, sort_order integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'NOT_ADMIN';
  end if;
  return query
    select d.id, d.key, d.name, d.description,
           d.water_reward, d.fertilizer_reward, d.active, d.sort_order
    from public.checklist_definitions d
    order by d.active desc, d.sort_order, d.name;
end;
$$;

revoke execute on function public.list_admin_checklist_goals() from public, anon;
grant execute on function public.list_admin_checklist_goals() to authenticated;
