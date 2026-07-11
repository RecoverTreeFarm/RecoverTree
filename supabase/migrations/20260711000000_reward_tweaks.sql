-- ============================================================================
-- Reward tweaks (owner-requested, 2026-07-11):
--   1. Meeting code redemption now pays 25 Coins (was reward_coin_bonus())
--      alongside the existing 10 Water.
--   2. Greeting a neighbor pays 20 Water (was 10).
--   3. Patting the store dog pays 20 Water + 1 Fertilizer (was 10 Water),
--      still once per day. Adds a 'store_pet' fertilizer_events reason.
--   4. Community Garden completion bundle DEFAULTS doubled via game_settings
--      overrides: water 25->50, seeds 2->4, fertilizer 1->2, coins 15->30.
--
-- Economy rule preserved: NONE of these grant Fruits. Water stays a multiple
-- of 5. Coins never touch the leaderboard.
-- ============================================================================

-- ---- (3a) allow the new fertilizer reason -------------------------------
alter table public.fertilizer_events drop constraint fertilizer_events_reason_check;
alter table public.fertilizer_events
  add constraint fertilizer_events_reason_check
  check (reason = any (array[
    'medal_reward', 'badge_reward', 'checklist_reward', 'used_on_tree',
    'admin_adjustment', 'basket_contribution', 'basket_reward', 'golden_goose',
    'garden_contribution', 'garden_reward', 'store_purchase', 'store_pet'
  ]));

-- ---- (1) meeting code = 25 Coins + 10 Water -----------------------------
create or replace function public.redeem_meeting_code(p_code text)
returns table (water_awarded integer, host_username text)
language plpgsql
security definer
set search_path = public
as $$
declare
  c_water integer := public.game_setting_int('meeting_attendance_reward_amount', 10);
  c_coins integer := public.game_setting_int('meeting_reward_coins', 25);
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

  -- meetings now pay a flat 25 Coins (admin-tunable via meeting_reward_coins)
  perform public.grant_coins(v_user, v_session.season_id, c_coins, 'meeting_reward');

  return query
    select c_water,
      (select p.username from public.profiles p
        where p.user_id = v_session.host_user_id);
end;
$$;

-- ---- (2) greet a neighbor = 20 Water ------------------------------------
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
  v_water integer := 20;  -- always a multiple of 5
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

-- ---- (3b) pat the store dog = 20 Water + 1 Fertilizer -------------------
create or replace function public.greet_store_pet()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_banned boolean;
  v_season uuid;
  v_water integer := 20;  -- always a multiple of 5
  v_fert integer := 1;
begin
  if v_user is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select is_banned into v_banned from public.profiles where user_id = v_user;
  if v_banned is null then raise exception 'NO_PROFILE'; end if;
  if v_banned then raise exception 'BANNED'; end if;

  begin
    insert into public.store_pet_greetings (user_id, water_awarded)
      values (v_user, v_water);
  exception when unique_violation then
    raise exception 'ALREADY_GREETED_TODAY';
  end;

  select id into v_season from public.seasons where status = 'active'
    order by ends_at limit 1;
  if v_season is not null then
    update public.farms set water_count = water_count + v_water
      where user_id = v_user and season_id = v_season;
    perform public.grant_fertilizer(v_user, v_season, v_fert, 'store_pet');
  end if;

  return jsonb_build_object('water_earned', v_water, 'fertilizer_earned', v_fert);
end;
$$;

-- ---- (4) double the Community Garden completion bundle -------------------
-- Overrides live immediately; also mirrored as new defaults in
-- src/lib/gameSettings.ts so the admin panel shows the doubled defaults.
insert into public.game_settings (key, value_json) values
  ('garden_reward_water', to_jsonb(50)),
  ('garden_reward_seeds', to_jsonb(4)),
  ('garden_reward_fertilizer', to_jsonb(2)),
  ('garden_reward_coins', to_jsonb(30))
on conflict (key) do update set value_json = excluded.value_json, updated_at = now();
