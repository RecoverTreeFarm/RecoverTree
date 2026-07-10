-- ============================================================================
-- 1. KUDOSEEDS — the daily Seed is now a "KudoSeed": a gift AND a note.
--    seed_events.message carries an optional encouraging message (≤ 300 chars)
--    that the receiver sees. give_seed takes it; get_my_kudoseeds returns the
--    ones sent to you today so the dashboard can surface them.
--
-- 2. COINS ON EVERY REWARD
--    A flat `reward_coin_bonus` (default 5, admin-editable) rides along with
--    EVERY reward the app pays out: meeting attendance, hosting, giving a
--    KudoSeed, receiving one, the Golden Goose egg + keeper reward, the
--    Traveling Basket lock-in/keep, and Community Garden bundles. Rewards
--    that already carry their own SPECIFIC coin amount (ceremony medals,
--    garden bundle coins, checklist coin_reward) keep theirs — the flat bonus
--    never stacks on those.
--
-- 3. NEW MONTHLY GOALS for the features added since the checklist was written:
--    visiting the Community Garden / General Store, contributing to the
--    garden, greeting neighbors, answering the Golden Goose, and shopping.
--    Each new rule_type is computed in recompute_checklists.
--
-- ECONOMY unchanged in spirit: Fruits still ONLY come from harvesting trees.
-- Coins may be granted directly and never touch the leaderboard.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. KudoSeed messages
-- ----------------------------------------------------------------------------
alter table public.seed_events
  add column if not exists message text
    constraint seed_events_message_len check (message is null or length(message) <= 300);

-- ledger reason for the flat bonus
alter table public.coin_events drop constraint coin_events_reason_check;
alter table public.coin_events
  add constraint coin_events_reason_check
  check (reason in
    ('medal_reward', 'badge_reward', 'checklist_reward', 'seed_received',
     'golden_goose', 'basket_reward', 'basket_contribution',
     'garden_reward', 'debug_adjustment', 'admin_adjustment',
     'store_purchase', 'reward_bonus', 'meeting_reward', 'seed_given'));

-- The flat "every reward pays a few coins" bonus.
create or replace function public.reward_coin_bonus()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(public.game_setting_int('reward_coin_bonus', 5), 0);
$$;

revoke execute on function public.reward_coin_bonus() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. give_seed v3: optional message + coins for BOTH farmers.
-- ----------------------------------------------------------------------------
drop function if exists public.give_seed(uuid);
create function public.give_seed(p_receiver_user_id uuid, p_message text default null)
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
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
  v_bonus integer := public.reward_coin_bonus();
begin
  if v_user is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if v_msg is not null and length(v_msg) > 300 then raise exception 'MESSAGE_TOO_LONG'; end if;

  select p.is_banned into v_giver_banned
  from public.profiles p where p.user_id = v_user;
  if v_giver_banned is null then raise exception 'NO_PROFILE'; end if;
  if v_giver_banned then raise exception 'BANNED'; end if;
  if p_receiver_user_id = v_user then raise exception 'SELF_SEED'; end if;

  select p.user_id, p.username, p.is_banned into v_receiver
  from public.profiles p where p.user_id = p_receiver_user_id;
  if v_receiver.user_id is null or v_receiver.is_banned then
    raise exception 'RECEIVER_NOT_FOUND';
  end if;

  update public.seasons set status = 'closed'
    where status = 'active' and ends_at <= now();
  v_season := public.ensure_active_season();

  if exists (
    select 1 from public.seed_events e
    where e.giver_user_id = v_user and e.given_on_date = current_date
  ) then
    raise exception 'ALREADY_SENT_TODAY';
  end if;

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

  insert into public.seed_events (giver_user_id, receiver_user_id, season_id, message)
  values (v_user, p_receiver_user_id, v_season, v_msg);

  update public.farms set water_count = water_count + c_giver_water
    where id = v_giver_farm;
  update public.farms
    set seed_count = seed_count + c_receiver_seeds,
        water_count = water_count + c_receiver_bonus_water
    where id = v_receiver_farm;

  -- receiver: the seed coin bonus, as before. giver + receiver: the flat
  -- "every reward pays coins" bonus.
  perform public.grant_coins(p_receiver_user_id, v_season,
    public.coin_bonus_for(c_receiver_seeds, 0), 'seed_received');
  perform public.grant_coins(p_receiver_user_id, v_season, v_bonus, 'reward_bonus');
  perform public.grant_coins(v_user, v_season, v_bonus, 'seed_given');

  return query select v_receiver.username, c_giver_water;
exception
  when unique_violation then
    raise exception 'ALREADY_SENT_TODAY';
end;
$$;

revoke execute on function public.give_seed(uuid, text) from public, anon;
grant execute on function public.give_seed(uuid, text) to authenticated;

/** KudoSeeds sent TO me today, with their notes (giver named per privacy). */
create or replace function public.get_my_kudoseeds()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'from', case when p.leaderboard_visibility = 'public' then p.username else 'A neighbor' end,
    'message', e.message,
    'given_on_date', e.given_on_date) order by e.created_at desc), '[]'::jsonb)
  from public.seed_events e
  join public.profiles p on p.user_id = e.giver_user_id
  where e.receiver_user_id = auth.uid()
    and e.given_on_date >= current_date - 1;
$$;

revoke execute on function public.get_my_kudoseeds() from public, anon;
grant execute on function public.get_my_kudoseeds() to authenticated;

-- ----------------------------------------------------------------------------
-- 3. The flat coin bonus on the other reward paths.
-- ----------------------------------------------------------------------------
-- Meetings: attending + hosting each pay the flat coin bonus. Both functions
-- are reproduced from their live definitions with only the coin lines added.
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

  -- every reward pays a few coins
  perform public.grant_coins(v_user, v_session.season_id,
    public.reward_coin_bonus(), 'meeting_reward');

  return query
    select c_water,
      (select p.username from public.profiles p
        where p.user_id = v_session.host_user_id);
end;
$$;

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

  -- every reward pays a few coins
  perform public.grant_coins(v_user, v_season, public.reward_coin_bonus(), 'meeting_reward');

  return query select v_id, v_code, v_expires, false, c_host_water;
end;
$$;

-- Golden Goose egg + keeper reward: flat bonus alongside the existing coins.
create or replace function public.goose_award_egg(p_assignment uuid, p_user uuid, p_season uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seed integer := public.game_setting_int('goose_egg_seed_amount', 1);
  v_fert integer := public.game_setting_int('goose_egg_fertilizer_amount', 1);
begin
  perform public.goose_credit(p_assignment, p_user, p_season, 'seed',
    v_seed, 'golden_goose_egg_seed');
  perform public.goose_credit(p_assignment, p_user, p_season, 'water',
    public.game_setting_int('goose_egg_water_amount', 10), 'golden_goose_egg_water');
  perform public.goose_credit(p_assignment, p_user, p_season, 'fertilizer',
    v_fert, 'golden_goose_egg_fertilizer');
  -- the seed/fert coin bonus PLUS the flat every-reward bonus
  perform public.goose_credit(p_assignment, p_user, p_season, 'coin',
    public.coin_bonus_for(v_seed, v_fert) + public.reward_coin_bonus(),
    'golden_goose_egg_coin');
end;
$$;

revoke execute on function public.goose_award_egg(uuid, uuid, uuid) from public, anon, authenticated;

-- Basket payouts: coins ride along with the contents.
create or replace function public.basket_award(
  p_chain uuid, p_user uuid, p_season uuid,
  p_water integer, p_seed integer, p_fert integer, p_coin integer, p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coin integer := greatest(p_coin, 0) + public.reward_coin_bonus();
begin
  if p_water <= 0 and p_seed <= 0 and p_fert <= 0 and v_coin <= 0 then
    return;
  end if;

  insert into public.farms (user_id, season_id) values (p_user, p_season)
    on conflict (user_id, season_id) do nothing;

  update public.farms
    set water_count = water_count + greatest(p_water, 0),
        seed_count = seed_count + greatest(p_seed, 0),
        fertilizer_count = fertilizer_count + greatest(p_fert, 0),
        coin_count = coin_count + v_coin
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
  if v_coin > 0 then
    insert into public.traveling_basket_reward_events (chain_id, user_id, reward_type, amount, reason, source_id)
    values (p_chain, p_user, 'coin', v_coin, p_reason, p_chain);
    insert into public.coin_events (user_id, season_id, amount, reason)
    values (p_user, p_season, v_coin, 'basket_reward');
  end if;
end;
$$;

revoke execute on function public.basket_award(uuid, uuid, uuid, integer, integer, integer, integer, text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. New monthly goals covering the features added since launch.
-- ----------------------------------------------------------------------------
insert into public.checklist_definitions
  (key, name, description, rule_type, config, water_reward, fertilizer_reward, coin_reward, active, sort_order)
values
  ('garden_contribution', 'Tend the Community Garden',
   'Add supplies to the shared garden 3 times this season.',
   'garden_contribution_count', '{"target": 3}'::jsonb, 15, 1, 10, true, 20),
  ('garden_visit', 'Visit the Community Garden',
   'Stop by the garden and see how the shared tree is growing.',
   'garden_visit', '{"target": 1}'::jsonb, 10, 0, 5, true, 21),
  ('greet_neighbors', 'Say hello',
   'Greet 3 neighbors out in the world — a wave costs nothing.',
   'greet_count', '{"target": 3}'::jsonb, 15, 0, 10, true, 22),
  ('store_visit', 'Browse the General Store',
   'Pay the shopkeeper a visit.',
   'store_visit', '{"target": 1}'::jsonb, 10, 0, 5, true, 23),
  ('store_purchase', 'Treat your farm',
   'Buy something from the General Store.',
   'store_purchase_count', '{"target": 1}'::jsonb, 10, 0, 10, true, 24),
  ('goose_answer', 'Answer the Golden Goose',
   'Share an answer when the Golden Goose comes calling.',
   'goose_answer_count', '{"target": 1}'::jsonb, 15, 1, 10, true, 25),
  ('kudoseed_notes', 'Send some kindness',
   'Send 3 KudoSeeds with an encouraging note attached.',
   'kudoseed_message_count', '{"target": 3}'::jsonb, 15, 1, 10, true, 26)
on conflict (key) do nothing;

-- recompute_checklists v4: understands the new rule types.
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
      -- ---- new rule types -------------------------------------------------
      when 'kudoseed_message_count' then
        (select count(*) from public.seed_events
          where giver_user_id = p_user and season_id = p_season
            and message is not null)
      when 'garden_contribution_count' then
        (select count(*) from public.community_garden_contributions c
          join public.community_garden_events e on e.id = c.event_id
          where c.user_id = p_user)
      when 'garden_visit' then
        (select count(*) from public.location_presence
          where user_id = p_user and location_key = 'garden')
      when 'store_visit' then
        (select count(*) from public.location_presence
          where user_id = p_user and location_key = 'store')
      when 'greet_count' then
        (select count(*) from public.neighbor_greetings
          where greeter_user_id = p_user)
      when 'store_purchase_count' then
        (select count(*) from public.store_purchases where user_id = p_user)
      when 'goose_answer_count' then
        (select count(*) from public.golden_goose_submissions
          where user_id = p_user and not is_deleted)
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
      -- the goal's own coin reward (specific → no flat bonus stacking)
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
