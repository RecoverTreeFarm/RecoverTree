-- ============================================================================
-- Coins — a new player currency. 🪙
--
-- Coins behave like Water/Seeds/Fertilizer: a per-farm inventory quantity,
-- server-side only, never negative. They are ALLOWED to be awarded directly
-- (unlike Fruits), but they do NOT count toward the leaderboard — the
-- leaderboard still ranks harvested Fruits only, and nothing here touches
-- fruit_total. Coins will later buy shop/cosmetic things; no shop exists yet.
--
-- WHAT AWARDS COINS (all settings-driven, defaults in parentheses):
--   * Community Garden bundle: completion +15 / partial +5
--     (garden_reward_coins / garden_partial_reward_coins)
--   * Traveling Basket: coins can be CONTRIBUTED (basket_max_coin_per_pass 25,
--     total per person like the other basket limits) and are paid out with
--     the rest of the contents on lock-in / keep.
--   * Ceremony medals: gold 100 / silver 60 / bronze 35
--     (medal_coin_gold/silver/bronze) — a specific amount, so the automatic
--     fertilizer bonus below does NOT stack on top of it.
--   * The seed/fertilizer bonus rule: any reward that grants Seeds also
--     grants coin_bonus_seed (5) coins; any reward that grants Fertilizer
--     also grants coin_bonus_fertilizer (10). Applied to: the Golden Goose
--     Egg (1 seed + 1 fert → +15), the Keeper completion fertilizer (→ +10),
--     receiving the daily Seed (→ +5), checklist fertilizer rewards (→ +10),
--     and ceremony badge fertilizer (→ +10).
--
-- Every coin movement lands in the coin_events ledger. Debug tools can edit
-- coin balances (admin + debug switch, audit-logged) but still cannot grant
-- Fruits.
--
-- ⚠️ update_game_settings is recreated below as v8 = the v7 arrays from
-- 20260709220000 COPIED VERBATIM + the coin keys. Future recreations must
-- copy THESE arrays first.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Inventory column + ledger
-- ----------------------------------------------------------------------------
alter table public.farms
  add column if not exists coin_count integer not null default 0
    constraint farms_coin_count_check check (coin_count >= 0);

create table public.coin_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  season_id uuid references public.seasons (id) on delete set null,
  amount integer not null,
  reason text not null check (reason in
    ('medal_reward', 'badge_reward', 'checklist_reward', 'seed_received',
     'golden_goose', 'basket_reward', 'basket_contribution',
     'garden_reward', 'debug_adjustment', 'admin_adjustment')),
  created_at timestamptz not null default now()
);
create index coin_events_user_idx on public.coin_events (user_id, created_at desc);

alter table public.coin_events enable row level security;
create policy "coin_events: own or admin"
  on public.coin_events for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- Mirrors grant_fertilizer: credit coins + write the ledger row.
create or replace function public.grant_coins(p_user uuid, p_season uuid, p_amount integer, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_amount is null or p_amount <= 0 then return; end if;
  insert into public.farms (user_id, season_id) values (p_user, p_season)
    on conflict (user_id, season_id) do nothing;
  update public.farms set coin_count = coin_count + p_amount
    where user_id = p_user and season_id = p_season;
  insert into public.coin_events (user_id, season_id, amount, reason)
    values (p_user, p_season, p_amount, p_reason);
end;
$$;

revoke execute on function public.grant_coins(uuid, uuid, integer, text) from public, anon, authenticated;

-- The seed/fertilizer → coins bonus rule, in one place.
create or replace function public.coin_bonus_for(p_seeds integer, p_fertilizer integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select (case when coalesce(p_seeds, 0) > 0
               then greatest(public.game_setting_int('coin_bonus_seed', 5), 0) else 0 end)
       + (case when coalesce(p_fertilizer, 0) > 0
               then greatest(public.game_setting_int('coin_bonus_fertilizer', 10), 0) else 0 end);
$$;

revoke execute on function public.coin_bonus_for(integer, integer) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Reward tables learn the 'coin' type (+ goose coin reasons)
-- ----------------------------------------------------------------------------
alter table public.traveling_basket_contributions
  drop constraint traveling_basket_contributions_reward_type_check;
alter table public.traveling_basket_contributions
  add constraint traveling_basket_contributions_reward_type_check
  check (reward_type in ('water', 'seed', 'fertilizer', 'coin'));

alter table public.traveling_basket_reward_events
  drop constraint traveling_basket_reward_events_reward_type_check;
alter table public.traveling_basket_reward_events
  add constraint traveling_basket_reward_events_reward_type_check
  check (reward_type in ('water', 'seed', 'fertilizer', 'coin'));

alter table public.golden_goose_rewards
  drop constraint golden_goose_rewards_reward_type_check;
alter table public.golden_goose_rewards
  add constraint golden_goose_rewards_reward_type_check
  check (reward_type in ('seed', 'water', 'fertilizer', 'coin'));

alter table public.golden_goose_rewards
  drop constraint golden_goose_rewards_reason_check;
alter table public.golden_goose_rewards
  add constraint golden_goose_rewards_reason_check
  check (reason in
    ('golden_goose_egg_seed', 'golden_goose_egg_water', 'golden_goose_egg_fertilizer',
     'golden_goose_egg_coin', 'keeper_completion_fertilizer', 'keeper_completion_coin'));

alter table public.community_garden_rewards
  drop constraint community_garden_rewards_reward_type_check;
alter table public.community_garden_rewards
  add constraint community_garden_rewards_reward_type_check
  check (reward_type in ('seed', 'water', 'fertilizer', 'coin'));

-- ----------------------------------------------------------------------------
-- 3. Community Garden: coin branch in garden_credit + bundle amounts
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
  elsif p_type = 'coin' then
    update public.farms set coin_count = coin_count + p_amount
      where user_id = p_user and season_id = p_season;
    insert into public.coin_events (user_id, season_id, amount, reason)
      values (p_user, p_season, p_amount, 'garden_reward');
  else
    raise exception 'INVALID_REWARD_TYPE: %', p_type;
  end if;

  insert into public.community_garden_rewards (event_id, user_id, reward_type, amount, reward_kind)
    values (p_event, p_user, p_type, p_amount, p_kind)
  on conflict (event_id, user_id, reward_type, reward_kind) do nothing;
end;
$$;

-- Bundle now includes coins; the garden's SPECIFIC coin settings are used
-- (no automatic seed/fert bonus stacking on top).
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
  v_coins integer;
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
    v_coins := greatest(public.game_setting_int('garden_reward_coins', 15), 0);
  else
    v_water := greatest(public.game_setting_int('garden_partial_reward_water', 10), 0);
    v_seeds := 0;
    v_fert  := 0;
    v_coins := greatest(public.game_setting_int('garden_partial_reward_coins', 5), 0);
  end if;

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
    perform public.garden_credit(p_event, r.user_id, v_season, 'coin', v_coins, p_kind);
  end loop;

  update public.community_garden_events
    set rewards_distributed_at = now()
    where id = p_event;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Golden Goose: coin branch + egg/keeper coin bonuses
-- ----------------------------------------------------------------------------
create or replace function public.goose_credit(
  p_assignment uuid, p_user uuid, p_season uuid, p_type text, p_amount integer, p_reason text
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
      values (p_user, p_season, p_amount, 'golden_goose');
  elsif p_type = 'coin' then
    update public.farms set coin_count = coin_count + p_amount
      where user_id = p_user and season_id = p_season;
    insert into public.coin_events (user_id, season_id, amount, reason)
      values (p_user, p_season, p_amount, 'golden_goose');
  else
    raise exception 'INVALID_REWARD_TYPE: %', p_type;
  end if;

  insert into public.golden_goose_rewards (assignment_id, user_id, reward_type, amount, reason)
    values (p_assignment, p_user, p_type, p_amount, p_reason);
end;
$$;

revoke execute on function public.goose_credit(uuid, uuid, uuid, text, integer, text) from public, anon, authenticated;

-- The egg gives seed + fertilizer, so it also carries the coin bonus (15).
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
  perform public.goose_credit(p_assignment, p_user, p_season, 'coin',
    public.coin_bonus_for(v_seed, v_fert), 'golden_goose_egg_coin');
end;
$$;

revoke execute on function public.goose_award_egg(uuid, uuid, uuid) from public, anon, authenticated;

-- Keeper completion pays fertilizer → also the fertilizer coin bonus (10).
create or replace function public.auto_close_golden_goose_assignments()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_sub record;
  v_auto boolean := public.game_setting_text('goose_auto_select_enabled', 'true')::boolean;
  v_keeper_reward integer := greatest(public.game_setting_int('goose_keeper_completion_reward_amount', 1), 0);
begin
  for c in
    select * from public.golden_goose_assignments
    where status in ('answer_collection', 'selection_open')
      and now() >= selection_deadline_at
    for update
  loop
    v_sub := null;

    if c.selected_submission_id is not null then
      select s.* into v_sub
      from public.golden_goose_submissions s
      join public.profiles p on p.user_id = s.user_id and not p.is_banned
      where s.id = c.selected_submission_id
        and s.assignment_id = c.id and not s.is_deleted;
    end if;

    if v_sub.id is not null then
      perform public.goose_award_egg(c.id, v_sub.user_id, c.season_id);
      update public.golden_goose_submissions set selected_at = now() where id = v_sub.id;
      if v_keeper_reward > 0 and c.keeper_user_id is not null then
        perform public.goose_credit(c.id, c.keeper_user_id, c.season_id, 'fertilizer',
          v_keeper_reward, 'keeper_completion_fertilizer');
        perform public.goose_credit(c.id, c.keeper_user_id, c.season_id, 'coin',
          public.coin_bonus_for(0, v_keeper_reward), 'keeper_completion_coin');
      end if;
      update public.golden_goose_assignments
        set status = 'completed', auto_selected = false, completed_at = now(), expired_at = now()
        where id = c.id;
      continue;
    end if;

    select s.* into v_sub
    from public.golden_goose_submissions s
    join public.profiles p on p.user_id = s.user_id and not p.is_banned
    where s.assignment_id = c.id and not s.is_deleted
    order by random()
    limit 1;

    if v_auto and v_sub.id is not null then
      perform public.goose_award_egg(c.id, v_sub.user_id, c.season_id);
      update public.golden_goose_submissions set selected_at = now() where id = v_sub.id;
      update public.golden_goose_assignments
        set status = 'auto_completed', auto_selected = true,
            selected_submission_id = v_sub.id, completed_at = now(), expired_at = now()
        where id = c.id;
    else
      update public.golden_goose_assignments
        set status = 'expired_no_submissions', expired_at = now()
        where id = c.id;
    end if;

    perform public.goose_exclude_keeper(c.keeper_user_id);
  end loop;
end;
$$;

revoke execute on function public.auto_close_golden_goose_assignments() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. Traveling Basket: coins ride along. basket_contents / basket_award /
--    basket_do_pass change shape, so drop the old signatures first (their
--    only callers are recreated right here).
-- ----------------------------------------------------------------------------
drop function public.basket_contents(uuid);
create function public.basket_contents(p_chain uuid)
returns table (water integer, seed integer, fertilizer integer, coin integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(amount) filter (where reward_type = 'water'), 0)::integer,
    coalesce(sum(amount) filter (where reward_type = 'seed'), 0)::integer,
    coalesce(sum(amount) filter (where reward_type = 'fertilizer'), 0)::integer,
    coalesce(sum(amount) filter (where reward_type = 'coin'), 0)::integer
  from public.traveling_basket_contributions
  where chain_id = p_chain;
$$;

revoke execute on function public.basket_contents(uuid) from public, anon, authenticated;

drop function public.basket_award(uuid, uuid, uuid, integer, integer, integer, text);
create function public.basket_award(
  p_chain uuid, p_user uuid, p_season uuid,
  p_water integer, p_seed integer, p_fert integer, p_coin integer, p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_water <= 0 and p_seed <= 0 and p_fert <= 0 and p_coin <= 0 then
    return;
  end if;

  insert into public.farms (user_id, season_id) values (p_user, p_season)
    on conflict (user_id, season_id) do nothing;

  update public.farms
    set water_count = water_count + greatest(p_water, 0),
        seed_count = seed_count + greatest(p_seed, 0),
        fertilizer_count = fertilizer_count + greatest(p_fert, 0),
        coin_count = coin_count + greatest(p_coin, 0)
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
  if p_coin > 0 then
    insert into public.traveling_basket_reward_events (chain_id, user_id, reward_type, amount, reason, source_id)
    values (p_chain, p_user, 'coin', p_coin, p_reason, p_chain);
    insert into public.coin_events (user_id, season_id, amount, reason)
    values (p_user, p_season, p_coin, 'basket_reward');
  end if;
end;
$$;

revoke execute on function public.basket_award(uuid, uuid, uuid, integer, integer, integer, integer, text) from public, anon, authenticated;

drop function public.basket_do_pass(uuid, uuid, uuid, integer, integer, integer, uuid);
create function public.basket_do_pass(
  p_chain uuid, p_from uuid, p_to uuid,
  p_water integer, p_seed integer, p_fert integer, p_coin integer, p_season uuid
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
  if p_coin > 0 then
    insert into public.traveling_basket_contributions
      (chain_id, contributor_user_id, receiver_user_id, touch_id, reward_type, amount)
    values (p_chain, p_from, p_to, v_from_touch, 'coin', p_coin);
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
        v_contents.water, v_contents.seed, v_contents.fertilizer, v_contents.coin,
        'basket_lock_in_reward');
    end loop;
    return true;
  end if;

  return false;
end;
$$;

revoke execute on function public.basket_do_pass(uuid, uuid, uuid, integer, integer, integer, integer, uuid) from public, anon, authenticated;

-- pass: new p_coin arg (defaults 0 so old clients keep working)
create or replace function public.pass_traveling_basket(
  p_receiver uuid, p_water integer, p_seed integer, p_fertilizer integer, p_coin integer default 0
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
  v_coin integer := coalesce(p_coin, 0);
  v_max_water integer := public.game_setting_int('basket_max_water_per_pass', 25);
  v_max_seed integer := public.game_setting_int('basket_max_seed_per_pass', 1);
  v_max_fert integer := public.game_setting_int('basket_max_fertilizer_per_pass', 2);
  v_max_coin integer := public.game_setting_int('basket_max_coin_per_pass', 25);
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

  if v_water < 0 or v_seed < 0 or v_fert < 0 or v_coin < 0 then
    raise exception 'NEGATIVE_NOT_ALLOWED';
  end if;
  if v_water + v_seed + v_fert + v_coin < 1 then
    raise exception 'MUST_ADD_ITEM';
  end if;
  if v_water > v_max_water or v_seed > v_max_seed or v_fert > v_max_fert or v_coin > v_max_coin then
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
     or v_farm.fertilizer_count < v_fert or v_farm.coin_count < v_coin then
    raise exception 'NOT_ENOUGH_ITEMS';
  end if;

  -- debit the holder; items now live in the basket
  update public.farms
    set water_count = water_count - v_water,
        seed_count = seed_count - v_seed,
        fertilizer_count = fertilizer_count - v_fert,
        coin_count = coin_count - v_coin
    where id = v_farm.id;
  if v_fert > 0 then
    insert into public.fertilizer_events (user_id, season_id, amount, reason)
    values (v_user, c.season_id, -v_fert, 'basket_contribution');
  end if;
  if v_coin > 0 then
    insert into public.coin_events (user_id, season_id, amount, reason)
    values (v_user, c.season_id, -v_coin, 'basket_contribution');
  end if;

  v_locked := public.basket_do_pass(c.id, v_user, p_receiver, v_water, v_seed, v_fert, v_coin, c.season_id);

  select count(*)::integer into v_participants
    from public.traveling_basket_touches where chain_id = c.id;

  return jsonb_build_object('locked_in', v_locked, 'participants', v_participants);
end;
$$;

revoke execute on function public.pass_traveling_basket(uuid, integer, integer, integer, integer) from public, anon;
grant execute on function public.pass_traveling_basket(uuid, integer, integer, integer, integer) to authenticated;

-- retire the old 4-arg overload so PostgREST resolves calls unambiguously
drop function if exists public.pass_traveling_basket(uuid, integer, integer, integer);

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
    v_contents.water * v_mult, v_contents.seed * v_mult,
    v_contents.fertilizer * v_mult, v_contents.coin * v_mult,
    'basket_keep_double');

  return jsonb_build_object(
    'water', v_contents.water * v_mult,
    'seed', v_contents.seed * v_mult,
    'fertilizer', v_contents.fertilizer * v_mult,
    'coin', v_contents.coin * v_mult);
end;
$$;

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

    perform public.basket_do_pass(p_chain, v_holder, v_next, v_take, 0, 0, 0, v_season);
    -- the new hold has a fresh (future) deadline, so the loop exits next pass
  end loop;
end;
$$;

revoke execute on function public.basket_auto_advance(uuid) from public, anon, authenticated;

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
      'water', v_contents.water, 'seed', v_contents.seed,
      'fertilizer', v_contents.fertilizer, 'coin', v_contents.coin),
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
      'fertilizer_per_pass', public.game_setting_int('basket_max_fertilizer_per_pass', 2),
      'coin_per_pass', public.game_setting_int('basket_max_coin_per_pass', 25)),
    'eligible_recipients', v_recipients,
    'my_rewards', v_my_rewards);
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Ceremony: medal coins (specific amounts) + badge fertilizer coin bonus.
--    Idempotency unchanged: a season only ceremonies once
--    (ceremony_completed_at guard), so coins can't double-pay.
-- ----------------------------------------------------------------------------
create or replace function public.close_season(p_season uuid default null::uuid)
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
  v_coins integer;
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

  -- MEDALS: top 3 by Fruits. Fertilizer + a sliding coin reward land in the
  -- NEXT season. Coin amounts are medal-specific settings (the automatic
  -- fertilizer coin bonus does NOT stack on top).
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
    v_coins := case r.rn
      when 1 then greatest(public.game_setting_int('medal_coin_gold', 100), 0)
      when 2 then greatest(public.game_setting_int('medal_coin_silver', 60), 0)
      else greatest(public.game_setting_int('medal_coin_bronze', 35), 0) end;
    insert into public.user_medals (user_id, season_id, medal_type, rank)
      values (r.user_id, v_season, v_medal, r.rn::int)
      on conflict do nothing;
    perform public.grant_fertilizer(r.user_id, v_next, v_fert, 'medal_reward');
    perform public.grant_coins(r.user_id, v_next, v_coins, 'medal_reward');
    v_medals := v_medals + 1;
  end loop;

  -- BADGES: shuffle categories, take the first 3 that have a valid winner.
  -- Badge fertilizer carries the automatic fertilizer coin bonus.
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
      perform public.grant_coins(v_win.winner, v_next, public.coin_bonus_for(0, 1), 'badge_reward');
      v_badges := v_badges + 1;
      v_chosen := v_chosen + 1;
    end if;
  end loop;

  return query select v_season, v_next, v_medals, v_badges;
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. Receiving the daily Seed → seed coin bonus (5) for the receiver.
-- ----------------------------------------------------------------------------
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

  -- Giver: +water. Receiver: +plantable seed(s) (+ optional bonus water)
  -- + the seed coin bonus (a Seed reward also carries a few coins).
  update public.farms set water_count = water_count + c_giver_water
    where id = v_giver_farm;
  update public.farms
    set seed_count = seed_count + c_receiver_seeds,
        water_count = water_count + c_receiver_bonus_water
    where id = v_receiver_farm;
  perform public.grant_coins(p_receiver_user_id, v_season,
    public.coin_bonus_for(c_receiver_seeds, 0), 'seed_received');

  return query select v_receiver.username, c_giver_water;
exception
  when unique_violation then
    raise exception 'ALREADY_SENT_TODAY';
end;
$$;

-- ----------------------------------------------------------------------------
-- 8. Checklist goals: fertilizer rewards carry the fertilizer coin bonus.
-- ----------------------------------------------------------------------------
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
        -- a fertilizer reward also carries the small coin bonus
        perform public.grant_coins(p_user, p_season,
          public.coin_bonus_for(0, d.fertilizer_reward), 'checklist_reward');
      end if;
      update public.user_checklist_progress set reward_claimed_at = now()
        where user_id = p_user and season_id = p_season
          and checklist_definition_id = d.id;
    end if;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 9. Debug tools: coins are editable like the rest (never Fruits).
--    Return/argument shapes change → drop the old signatures first.
-- ----------------------------------------------------------------------------
drop function public.debug_list_inventories();
create function public.debug_list_inventories()
returns table (
  user_id uuid, username text, display_name text,
  water integer, seeds integer, fertilizer integer, coins integer,
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
      f.water_count, f.seed_count, f.fertilizer_count, f.coin_count,
      f.fruit_total,
      (select count(*) from public.trees t
        where t.farm_id = f.id and t.status = 'active')
    from public.farms f
    join public.seasons s on s.id = f.season_id and s.status = 'active'
    join public.profiles p on p.user_id = f.user_id
    order by p.username;
end;
$$;

revoke execute on function public.debug_list_inventories() from public, anon;
grant execute on function public.debug_list_inventories() to authenticated;

drop function public.debug_set_inventory(uuid, integer, integer, integer);
create function public.debug_set_inventory(
  p_user uuid, p_water integer, p_seed integer, p_fertilizer integer, p_coins integer
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
  if p_water is null or p_seed is null or p_fertilizer is null or p_coins is null
     or p_water < 0 or p_seed < 0 or p_fertilizer < 0 or p_coins < 0
     or p_water > 1000000 or p_seed > 1000000 or p_fertilizer > 1000000 or p_coins > 1000000 then
    raise exception 'QUANTITY_OUT_OF_RANGE';
  end if;

  select f.id, f.water_count, f.seed_count, f.fertilizer_count, f.coin_count into v_old
  from public.farms f
  join public.seasons s on s.id = f.season_id and s.status = 'active'
  where f.user_id = p_user
  for update of f;
  if v_old.id is null then raise exception 'USER_NOT_FOUND'; end if;
  v_farm := v_old.id;

  update public.farms
    set water_count = p_water, seed_count = p_seed,
        fertilizer_count = p_fertilizer, coin_count = p_coins
    where id = v_farm;

  if p_coins <> v_old.coin_count then
    insert into public.coin_events (user_id, season_id, amount, reason)
    select p_user, s.id, p_coins - v_old.coin_count, 'debug_adjustment'
    from public.seasons s where s.status = 'active' limit 1;
  end if;

  insert into public.admin_audit_logs (actor_user_id, action, metadata_json)
  values (auth.uid(), 'debug_inventory_set', jsonb_build_object(
    'target_user_id', p_user,
    'old', jsonb_build_object('water', v_old.water_count, 'seed', v_old.seed_count,
                              'fertilizer', v_old.fertilizer_count, 'coins', v_old.coin_count),
    'new', jsonb_build_object('water', p_water, 'seed', p_seed,
                              'fertilizer', p_fertilizer, 'coins', p_coins)));
end;
$$;

revoke execute on function public.debug_set_inventory(uuid, integer, integer, integer, integer) from public, anon;
grant execute on function public.debug_set_inventory(uuid, integer, integer, integer, integer) to authenticated;

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
        fertilizer_count = least(fertilizer_count + 2, 1000000),
        coin_count = least(coin_count + 25, 1000000)
    where id = v_farm;

  insert into public.admin_audit_logs (actor_user_id, action, metadata_json)
  values (auth.uid(), 'debug_bundle_granted', jsonb_build_object(
    'target_user_id', p_user, 'bundle', jsonb_build_object('water', 25, 'seed', 2, 'fertilizer', 2, 'coins', 25)));
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
    set water_count = 0, seed_count = 0, fertilizer_count = 0, coin_count = 0
    where id = v_farm;

  insert into public.admin_audit_logs (actor_user_id, action, metadata_json)
  values (auth.uid(), 'debug_inventory_reset', jsonb_build_object('target_user_id', p_user));
end;
$$;

-- ----------------------------------------------------------------------------
-- 10. update_game_settings v8 (v7 arrays from 20260709220000 VERBATIM
--     + the coin keys). ⚠️ Future recreations must copy THESE arrays.
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
    'garden_partial_reward_water',
    'garden_reward_coins', 'garden_partial_reward_coins',
    'basket_max_coin_per_pass',
    'medal_coin_gold', 'medal_coin_silver', 'medal_coin_bronze',
    'coin_bonus_seed', 'coin_bonus_fertilizer'];
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
