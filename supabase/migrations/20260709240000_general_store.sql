-- ============================================================================
-- General Store 🏪 + Xtra Goose Entry + ceremony invitations + garden
-- greetings + the global "Water in multiples of 5" rule.
--
-- STORE: a new map location. Purchases spend Coins and grant Water /
-- Fertilizer / Seeds / an Xtra Goose Entry — never Fruits. All pricing is
-- server-side (settings-driven); purchases are atomic (coins deducted and
-- item granted in one transaction) and logged in store_purchases + the
-- coin_events ledger (reason 'store_purchase').
--
-- SALE: one item per UTC calendar day (no community timezone exists — noted
-- in HANDOFF), picked deterministically from md5(date), with a weighted
-- discount: 10/15 common, 20/25 uncommon, 30 rare, 35/40 very rare. Floor
-- price 1 Coin. The Lottery Ticket teaser is never on sale.
--
-- XTRA GOOSE ENTRY: purchasable ONLY while a Golden Goose event is collecting
-- answers (the safest shape: no dangling inventory, the entry is bound to the
-- current event, one per user per event, the Keeper can't buy one). It allows
-- a SECOND anonymous answer (max 2 per user). Reward rules unchanged.
--
-- CEREMONY INVITES: per-user per-season view state so the "Attend Ceremony"
-- popup shows once and never spams. Replays are visual only — close_season
-- remains the ONLY reward-granting path and stays idempotent.
--
-- WATER RULE: water is now always a multiple of 5 (0 = "none" stays allowed
-- for optional bonuses). Enforced in: garden contributions, basket passes,
-- debug inventory edits, checklist reward edits, store amounts, and the
-- settings validator (v9). Existing live values were scanned — none violate
-- the rule, so no data cleanup is needed.
--
-- ⚠️ update_game_settings is recreated below as v9 = the v8 arrays from
-- 20260709230000 COPIED VERBATIM + store keys + the water-step validation.
-- Future recreations must copy THESE arrays.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Ledger reasons for store purchases
-- ----------------------------------------------------------------------------
alter table public.coin_events drop constraint coin_events_reason_check;
alter table public.coin_events
  add constraint coin_events_reason_check
  check (reason in
    ('medal_reward', 'badge_reward', 'checklist_reward', 'seed_received',
     'golden_goose', 'basket_reward', 'basket_contribution',
     'garden_reward', 'debug_adjustment', 'admin_adjustment',
     'store_purchase'));

alter table public.fertilizer_events drop constraint fertilizer_events_reason_check;
alter table public.fertilizer_events
  add constraint fertilizer_events_reason_check
  check (reason in
    ('medal_reward', 'badge_reward', 'checklist_reward', 'used_on_tree',
     'admin_adjustment', 'basket_contribution', 'basket_reward', 'golden_goose',
     'garden_contribution', 'garden_reward', 'store_purchase'));

-- ----------------------------------------------------------------------------
-- 2. Tables
-- ----------------------------------------------------------------------------
create table public.store_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  item_key text not null check (item_key in ('water', 'fertilizer', 'seed', 'goose_entry')),
  quantity integer not null check (quantity > 0),
  coin_cost integer not null check (coin_cost >= 0),
  discount_percent integer not null default 0 check (discount_percent between 0 and 100),
  purchased_at timestamptz not null default now(),
  metadata_json jsonb
);
create index store_purchases_user_idx on public.store_purchases (user_id, purchased_at desc);

create table public.goose_extra_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  assignment_id uuid not null references public.golden_goose_assignments (id) on delete cascade,
  purchased_at timestamptz not null default now(),
  used_at timestamptz,
  status text not null default 'available' check (status in ('available', 'used', 'expired')),
  constraint goose_extra_entries_once unique (user_id, assignment_id)
);

create table public.ceremony_view_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  season_id uuid not null references public.seasons (id) on delete cascade,
  invited_at timestamptz,
  dismissed_at timestamptz,
  attended_at timestamptz,
  replayed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ceremony_view_states_once unique (user_id, season_id)
);

create trigger ceremony_view_states_set_updated_at
  before update on public.ceremony_view_states
  for each row execute function public.set_updated_at();

create table public.garden_greetings (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.community_garden_events (id) on delete cascade,
  greeter_user_id uuid not null references auth.users (id) on delete cascade,
  target_user_id uuid not null references auth.users (id) on delete cascade,
  greeted_on_date date not null default current_date,
  created_at timestamptz not null default now(),
  constraint garden_greetings_daily unique (event_id, greeter_user_id, target_user_id, greeted_on_date)
);

alter table public.store_purchases enable row level security;
alter table public.goose_extra_entries enable row level security;
alter table public.ceremony_view_states enable row level security;
alter table public.garden_greetings enable row level security;

create policy "store_purchases: own or admin"
  on public.store_purchases for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy "goose_extra_entries: own or admin"
  on public.goose_extra_entries for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy "ceremony_view_states: own or admin"
  on public.ceremony_view_states for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy "garden_greetings: own or admin"
  on public.garden_greetings for select to authenticated
  using (greeter_user_id = auth.uid() or target_user_id = auth.uid() or public.is_admin());

-- ----------------------------------------------------------------------------
-- 3. Sale of the day (deterministic per UTC date; server is the truth)
-- ----------------------------------------------------------------------------
create or replace function public.store_water_amount()
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v integer := public.game_setting_int('store_water_amount', 25);
begin
  -- defensive: water is ALWAYS a multiple of 5, at least 5
  v := greatest(v, 5);
  return v - (v % 5);
end;
$$;

revoke execute on function public.store_water_amount() from public, anon, authenticated;

create or replace function public.store_item_base_price(p_item text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(case p_item
    when 'water' then public.game_setting_int('store_water_price', 10)
    when 'fertilizer' then public.game_setting_int('store_fertilizer_price', 30)
    when 'seed' then public.game_setting_int('store_seed_price', 50)
    when 'goose_entry' then public.game_setting_int('store_goose_entry_price', 40)
    else 0 end, 1);
$$;

revoke execute on function public.store_item_base_price(text) from public, anon, authenticated;

-- One sale item + discount per UTC day. Weighted rarity:
-- 10/15 common, 20/25 uncommon, 30 rare, 35/40 very rare.
create or replace function public.store_sale_of_the_day(p_date date)
returns table (item_key text, discount_percent integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  items text[] := array['water', 'fertilizer', 'seed', 'goose_entry'];
  weights integer[] := array[10, 10, 10, 15, 15, 15, 20, 20, 25, 25, 30, 35, 40];
  v_min integer := greatest(public.game_setting_int('store_sale_min_percent', 10), 0);
  v_max integer := least(greatest(public.game_setting_int('store_sale_max_percent', 40), v_min), 100);
  v_item text;
  v_disc integer;
begin
  -- 24-bit slices stay positive in int4, so the modulo is always in range
  v_item := items[1 + (('x' || substr(md5(p_date::text || ':store-item'), 1, 6))::bit(24)::integer % 4)];
  v_disc := weights[1 + (('x' || substr(md5(p_date::text || ':store-disc'), 1, 6))::bit(24)::integer % 13)];
  v_disc := least(greatest(v_disc, v_min), v_max);
  return query select v_item, v_disc;
end;
$$;

revoke execute on function public.store_sale_of_the_day(date) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. get_general_store_state: everything the store scene needs.
-- ----------------------------------------------------------------------------
create or replace function public.get_general_store_state()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_enabled boolean := public.game_setting_text('store_enabled', 'true')::boolean;
  v_sale_on boolean := public.game_setting_text('store_sale_enabled', 'true')::boolean;
  v_sale record;
  v_sale_base integer;
  v_sale_price integer;
  v_coins integer := 0;
  v_goose record;
  v_entry record;
  v_goose_status text := 'no_event';
begin
  if v_user is null then raise exception 'NOT_AUTHENTICATED'; end if;
  v_sale := null;  -- may never be selected; null-record so field access is safe

  select f.coin_count into v_coins
  from public.farms f
  join public.seasons s on s.id = f.season_id and s.status = 'active'
  where f.user_id = v_user;

  -- goose entry availability
  select * into v_goose from public.golden_goose_assignments
    where status = 'answer_collection' and now() < answer_collection_ends_at
    order by created_at limit 1;
  if v_goose.id is not null then
    if v_goose.keeper_user_id = v_user then
      v_goose_status := 'keeper';
    else
      select * into v_entry from public.goose_extra_entries
        where user_id = v_user and assignment_id = v_goose.id;
      v_goose_status := case
        when v_entry.id is null then 'available_to_buy'
        when v_entry.status = 'used' then 'used'
        else 'owned' end;
    end if;
  end if;

  if v_sale_on then
    select * into v_sale from public.store_sale_of_the_day(current_date);
    -- the sale item must actually be purchasable to be advertised
    if v_sale.item_key = 'goose_entry' and v_goose_status <> 'available_to_buy' then
      v_sale := null;
    end if;
  end if;
  if v_sale.item_key is not null then
    v_sale_base := public.store_item_base_price(v_sale.item_key);
    v_sale_price := greatest(ceil(v_sale_base * (100 - v_sale.discount_percent) / 100.0)::integer, 1);
  end if;

  return jsonb_build_object(
    'enabled', v_enabled,
    'coins', coalesce(v_coins, 0),
    'water_amount', public.store_water_amount(),
    'prices', jsonb_build_object(
      'water', public.store_item_base_price('water'),
      'fertilizer', public.store_item_base_price('fertilizer'),
      'seed', public.store_item_base_price('seed'),
      'goose_entry', public.store_item_base_price('goose_entry')),
    'goose_entry_status', v_goose_status,
    'sale', case when v_sale.item_key is null then null else jsonb_build_object(
      'item_key', v_sale.item_key,
      'discount_percent', v_sale.discount_percent,
      'base_price', v_sale_base,
      'sale_price', v_sale_price) end);
end;
$$;

revoke execute on function public.get_general_store_state() from public, anon;
grant execute on function public.get_general_store_state() to authenticated;

-- ----------------------------------------------------------------------------
-- 5. purchase_store_item: atomic, server-priced, audited. Never Fruits.
-- ----------------------------------------------------------------------------
create or replace function public.purchase_store_item(p_item text, p_sale boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_banned boolean;
  v_enabled boolean := public.game_setting_text('store_enabled', 'true')::boolean;
  v_sale_on boolean := public.game_setting_text('store_sale_enabled', 'true')::boolean;
  v_sale record;
  v_price integer;
  v_discount integer := 0;
  v_quantity integer := 1;
  v_season uuid;
  v_farm record;
  v_goose record;
begin
  if v_user is null then raise exception 'NOT_AUTHENTICATED'; end if;
  v_goose := null;  -- referenced in the audit insert even for non-goose items
  if not v_enabled then raise exception 'STORE_CLOSED'; end if;
  select is_banned into v_banned from public.profiles where user_id = v_user;
  if v_banned is null then raise exception 'NO_PROFILE'; end if;
  if v_banned then raise exception 'BANNED'; end if;
  if p_item not in ('water', 'fertilizer', 'seed', 'goose_entry') then
    raise exception 'ITEM_UNAVAILABLE';
  end if;

  v_price := public.store_item_base_price(p_item);
  if coalesce(p_sale, false) then
    if not v_sale_on then raise exception 'SALE_UNAVAILABLE'; end if;
    select * into v_sale from public.store_sale_of_the_day(current_date);
    if v_sale.item_key is distinct from p_item then raise exception 'SALE_UNAVAILABLE'; end if;
    v_discount := v_sale.discount_percent;
    v_price := greatest(ceil(v_price * (100 - v_discount) / 100.0)::integer, 1);
  end if;

  select id into v_season from public.seasons where status = 'active' order by ends_at limit 1;
  if v_season is null then raise exception 'NO_FARM'; end if;
  select * into v_farm from public.farms
    where user_id = v_user and season_id = v_season
    for update;
  if v_farm.id is null then raise exception 'NO_FARM'; end if;
  if v_farm.coin_count < v_price then raise exception 'NOT_ENOUGH_COINS'; end if;

  -- the goose entry has extra availability rules — validate BEFORE paying
  if p_item = 'goose_entry' then
    select * into v_goose from public.golden_goose_assignments
      where status = 'answer_collection' and now() < answer_collection_ends_at
      order by created_at limit 1
      for update;
    if v_goose.id is null then raise exception 'NO_ACTIVE_GOOSE'; end if;
    if v_goose.keeper_user_id = v_user then raise exception 'KEEPER_CANNOT_BUY'; end if;
    if exists (select 1 from public.goose_extra_entries
               where user_id = v_user and assignment_id = v_goose.id) then
      raise exception 'ALREADY_HAVE_ENTRY';
    end if;
  end if;

  -- pay
  update public.farms set coin_count = coin_count - v_price where id = v_farm.id;
  insert into public.coin_events (user_id, season_id, amount, reason)
    values (v_user, v_season, -v_price, 'store_purchase');

  -- grant
  if p_item = 'water' then
    v_quantity := public.store_water_amount();  -- always ≥5 and a multiple of 5
    update public.farms set water_count = water_count + v_quantity where id = v_farm.id;
  elsif p_item = 'fertilizer' then
    update public.farms set fertilizer_count = fertilizer_count + 1 where id = v_farm.id;
    insert into public.fertilizer_events (user_id, season_id, amount, reason)
      values (v_user, v_season, 1, 'store_purchase');
  elsif p_item = 'seed' then
    update public.farms set seed_count = seed_count + 1 where id = v_farm.id;
  elsif p_item = 'goose_entry' then
    insert into public.goose_extra_entries (user_id, assignment_id)
      values (v_user, v_goose.id);
  end if;

  insert into public.store_purchases (user_id, item_key, quantity, coin_cost, discount_percent, metadata_json)
    values (v_user, p_item, v_quantity, v_price, v_discount,
            case when p_item = 'goose_entry'
                 then jsonb_build_object('assignment_id', v_goose.id) end);

  return jsonb_build_object(
    'item_key', p_item,
    'quantity', v_quantity,
    'coins_spent', v_price,
    'coins_left', v_farm.coin_count - v_price);
end;
$$;

revoke execute on function public.purchase_store_item(text, boolean) from public, anon;
grant execute on function public.purchase_store_item(text, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Golden Goose: second answer via the Xtra Goose Entry (max 2, anonymous).
-- ----------------------------------------------------------------------------
alter table public.golden_goose_submissions
  add column entry_number integer not null default 1 check (entry_number in (1, 2));
alter table public.golden_goose_submissions
  drop constraint golden_goose_submissions_once;
alter table public.golden_goose_submissions
  add constraint golden_goose_submissions_once unique (assignment_id, user_id, entry_number);

drop function public.submit_golden_goose_answer(text);
create function public.submit_golden_goose_answer(p_text text, p_entry integer default 1)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_banned boolean;
  c record;
  v_entry record;
begin
  if v_user is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select is_banned into v_banned from public.profiles where user_id = v_user;
  if v_banned is null then raise exception 'NO_PROFILE'; end if;
  if v_banned then raise exception 'BANNED'; end if;
  if p_text is null or length(trim(p_text)) < 1 then raise exception 'EMPTY_ANSWER'; end if;
  if length(p_text) > 800 then raise exception 'ANSWER_TOO_LONG'; end if;
  if p_entry not in (1, 2) then raise exception 'INVALID_ENTRY'; end if;

  select * into c from public.golden_goose_assignments
    where status = 'answer_collection' order by created_at limit 1;
  if c.id is null then raise exception 'NO_OPEN_REQUEST'; end if;
  if now() >= c.answer_collection_ends_at then raise exception 'COLLECTION_CLOSED'; end if;
  if c.keeper_user_id = v_user then raise exception 'KEEPER_CANNOT_SUBMIT'; end if;

  -- the SECOND answer needs an Xtra Goose Entry bound to this event
  if p_entry = 2 then
    select * into v_entry from public.goose_extra_entries
      where user_id = v_user and assignment_id = c.id
      for update;
    if v_entry.id is null then raise exception 'NO_EXTRA_ENTRY'; end if;
    if v_entry.status = 'available' then
      update public.goose_extra_entries
        set status = 'used', used_at = now() where id = v_entry.id;
    end if;
  end if;

  insert into public.golden_goose_submissions (assignment_id, user_id, answer_text, entry_number)
  values (c.id, v_user, trim(p_text), p_entry)
  on conflict (assignment_id, user_id, entry_number) do update
    set answer_text = trim(p_text), is_deleted = false, updated_at = now();
end;
$$;

revoke execute on function public.submit_golden_goose_answer(text, integer) from public, anon;
grant execute on function public.submit_golden_goose_answer(text, integer) to authenticated;

-- get_golden_goose_state v3: + my_answer_2 + extra_entry_status
create or replace function public.get_golden_goose_state()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  c record;
  v_phase text;
  v_i_keeper boolean;
  v_my_sub record;
  v_my_sub2 record;
  v_entry record;
  v_entry_status text := 'none';
  v_count integer := 0;
  v_answers jsonb := '[]'::jsonb;
  v_my_rewards jsonb := '[]'::jsonb;
  v_opt_in boolean;
  v_excluded timestamptz;
begin
  if v_user is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select golden_goose_opt_in, golden_goose_excluded_until into v_opt_in, v_excluded
    from public.profiles where user_id = v_user;

  v_id := public.create_or_get_current_golden_goose();
  if v_id is null then
    return jsonb_build_object(
      'is_goose_day', public.goose_is_goose_day(current_date),
      'has_event', false,
      'opt_in', coalesce(v_opt_in, true),
      'excluded_until', v_excluded);
  end if;

  select * into c from public.golden_goose_assignments where id = v_id;
  v_i_keeper := c.keeper_user_id = v_user;
  v_phase := case c.status
    when 'answer_collection' then 'answer_collection'
    when 'selection_open' then 'selection'
    else 'ended' end;

  select * into v_my_sub from public.golden_goose_submissions
    where assignment_id = c.id and user_id = v_user and entry_number = 1 and not is_deleted;
  select * into v_my_sub2 from public.golden_goose_submissions
    where assignment_id = c.id and user_id = v_user and entry_number = 2 and not is_deleted;

  select * into v_entry from public.goose_extra_entries
    where user_id = v_user and assignment_id = c.id;
  if v_entry.id is not null then
    v_entry_status := case when v_entry.status = 'available' then 'available' else 'used' end;
  end if;

  if v_i_keeper then
    select count(*)::integer into v_count from public.golden_goose_submissions
      where assignment_id = c.id and not is_deleted;
    -- ANONYMOUS answers (no user_ids, entries indistinguishable) — Selection only
    if c.status = 'selection_open' then
      select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'answer_text', s.answer_text)
                                order by s.created_at), '[]'::jsonb)
        into v_answers
      from public.golden_goose_submissions s
      where s.assignment_id = c.id and not s.is_deleted;
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('reward_type', reward_type, 'amount', amount, 'reason', reason)), '[]'::jsonb)
    into v_my_rewards
  from public.golden_goose_rewards where assignment_id = c.id and user_id = v_user;

  return jsonb_build_object(
    'is_goose_day', true,
    'has_event', true,
    'assignment_id', c.id,
    'status', c.status,
    'phase', v_phase,
    'i_am_keeper', v_i_keeper,
    'i_submitted', v_my_sub.id is not null,
    'my_answer', v_my_sub.answer_text,
    'my_answer_2', v_my_sub2.answer_text,
    'extra_entry_status', v_entry_status,
    'submission_count', v_count,
    'anonymous_answers', v_answers,
    'my_rewards', v_my_rewards,
    'my_pick_submission_id',
      case when v_i_keeper and c.status = 'selection_open'
           then c.selected_submission_id end,
    'answer_collection_ends_at', c.answer_collection_ends_at,
    'selection_deadline_at', c.selection_deadline_at,
    'pass_enabled', public.game_setting_text('goose_pass_enabled', 'true')::boolean and v_i_keeper and c.status = 'answer_collection',
    'opt_in', coalesce(v_opt_in, true),
    'excluded_until', v_excluded);
end;
$$;

revoke execute on function public.get_golden_goose_state() from public, anon;
grant execute on function public.get_golden_goose_state() to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Ceremony invitations (view state per user per season).
-- ----------------------------------------------------------------------------
create or replace function public.get_ceremony_invite()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_season record;
  v_state record;
begin
  if v_user is null then raise exception 'NOT_AUTHENTICATED'; end if;

  -- the most recently ceremonied season the user actually farmed in
  select s.* into v_season
  from public.seasons s
  join public.farms f on f.season_id = s.id and f.user_id = v_user
  where s.ceremony_completed_at is not null
  order by s.ceremony_completed_at desc
  limit 1;
  if v_season.id is null then return null; end if;

  select * into v_state from public.ceremony_view_states
    where user_id = v_user and season_id = v_season.id;
  if v_state.dismissed_at is not null or v_state.attended_at is not null then
    return null;
  end if;

  -- mark invited (first time only)
  insert into public.ceremony_view_states (user_id, season_id, invited_at)
    values (v_user, v_season.id, now())
  on conflict (user_id, season_id) do nothing;

  return jsonb_build_object('season_id', v_season.id, 'season_name', v_season.name);
end;
$$;

revoke execute on function public.get_ceremony_invite() from public, anon;
grant execute on function public.get_ceremony_invite() to authenticated;

create or replace function public.set_ceremony_view_state(p_season uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_action not in ('dismissed', 'attended', 'replayed') then
    raise exception 'INVALID_ACTION';
  end if;
  if not exists (select 1 from public.seasons where id = p_season) then
    raise exception 'NOT_FOUND';
  end if;

  insert into public.ceremony_view_states (user_id, season_id, invited_at)
    values (v_user, p_season, now())
  on conflict (user_id, season_id) do nothing;

  update public.ceremony_view_states
    set dismissed_at = case when p_action = 'dismissed' then coalesce(dismissed_at, now()) else dismissed_at end,
        attended_at = case when p_action = 'attended' then coalesce(attended_at, now()) else attended_at end,
        replayed_at = case when p_action = 'replayed' then now() else replayed_at end
    where user_id = v_user and season_id = p_season;
end;
$$;

revoke execute on function public.set_ceremony_view_state(uuid, text) from public, anon;
grant execute on function public.set_ceremony_view_state(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 8. Garden greetings: say hi to a neighbor, earn 10 water (once per
--    neighbor per day; presence never affects garden rewards).
-- ----------------------------------------------------------------------------
create or replace function public.greet_garden_neighbor(p_presence uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_banned boolean;
  pr record;
  v_season uuid;
begin
  if v_user is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select is_banned into v_banned from public.profiles where user_id = v_user;
  if v_banned is null then raise exception 'NO_PROFILE'; end if;
  if v_banned then raise exception 'BANNED'; end if;

  select pr2.*, e.status as event_status into pr
  from public.community_garden_presence pr2
  join public.community_garden_events e on e.id = pr2.event_id
  where pr2.id = p_presence;
  if pr.id is null then raise exception 'NEIGHBOR_NOT_FOUND'; end if;
  if pr.event_status <> 'active' then raise exception 'NO_ACTIVE_GARDEN'; end if;
  if pr.user_id = v_user then raise exception 'CANNOT_GREET_SELF'; end if;
  if pr.last_seen_at < now() - interval '5 minutes' then raise exception 'NEIGHBOR_LEFT'; end if;

  begin
    insert into public.garden_greetings (event_id, greeter_user_id, target_user_id)
      values (pr.event_id, v_user, pr.user_id);
  exception
    when unique_violation then
      raise exception 'ALREADY_GREETED_TODAY';
  end;

  -- +10 water for reaching out (a multiple of 5, per the water rule)
  select id into v_season from public.seasons where status = 'active' order by ends_at limit 1;
  if v_season is not null then
    update public.farms set water_count = water_count + 10
      where user_id = v_user and season_id = v_season;
  end if;

  return jsonb_build_object('water_earned', 10);
end;
$$;

revoke execute on function public.greet_garden_neighbor(uuid) from public, anon;
grant execute on function public.greet_garden_neighbor(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 9. The water rule in existing flows (0 stays allowed = "none").
-- ----------------------------------------------------------------------------
-- garden contributions: water must arrive in multiples of 5
create or replace function public.contribute_to_community_garden(
  p_water integer, p_seed integer, p_fertilizer integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_water integer := coalesce(p_water, 0);
  v_seed integer := coalesce(p_seed, 0);
  v_fert integer := coalesce(p_fertilizer, 0);
  v_banned boolean;
  v_visibility text;
  v_private_ok boolean := public.game_setting_text('garden_private_users_can_contribute', 'true')::boolean;
  e record;
  v_season uuid;
  f record;
  v_today_water integer;
  v_today_seed integer;
  v_today_fert integer;
  v_lim_water integer := greatest(public.game_setting_int('garden_daily_water_limit', 50), 0);
  v_lim_seed integer := greatest(public.game_setting_int('garden_daily_seed_limit', 3), 0);
  v_lim_fert integer := greatest(public.game_setting_int('garden_daily_fertilizer_limit', 3), 0);
  v_completed boolean := false;
begin
  if v_user is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select is_banned, leaderboard_visibility into v_banned, v_visibility
    from public.profiles where user_id = v_user;
  if v_banned is null then raise exception 'NO_PROFILE'; end if;
  if v_banned then raise exception 'BANNED'; end if;
  if not v_private_ok and v_visibility <> 'public' then
    raise exception 'PRIVATE_CONTRIBUTIONS_DISABLED';
  end if;

  if v_water < 0 or v_seed < 0 or v_fert < 0 then raise exception 'NEGATIVE_NOT_ALLOWED'; end if;
  if v_water % 5 <> 0 then raise exception 'WATER_MULTIPLE_OF_5'; end if;
  if v_water + v_seed + v_fert = 0 then raise exception 'MUST_ADD_ITEM'; end if;

  select * into e from public.community_garden_events
    where status = 'active' limit 1
    for update;
  if e.id is null then raise exception 'NO_ACTIVE_GARDEN'; end if;
  if now() >= e.ends_at then raise exception 'GARDEN_ENDED'; end if;
  if e.current_water >= e.required_water
     and e.current_seeds >= e.required_seeds
     and e.current_fertilizer >= e.required_fertilizer then
    raise exception 'GARDEN_COMPLETE';
  end if;

  select coalesce(sum(water_amount), 0), coalesce(sum(seed_amount), 0),
         coalesce(sum(fertilizer_amount), 0)
    into v_today_water, v_today_seed, v_today_fert
  from public.community_garden_contributions
  where event_id = e.id and user_id = v_user and contributed_on_date = current_date;

  if v_today_water + v_water > v_lim_water
     or v_today_seed + v_seed > v_lim_seed
     or v_today_fert + v_fert > v_lim_fert then
    raise exception 'DAILY_LIMIT_EXCEEDED';
  end if;

  select id into v_season from public.seasons where status = 'active' order by ends_at limit 1;
  if v_season is null then raise exception 'NO_FARM'; end if;
  select * into f from public.farms
    where user_id = v_user and season_id = v_season
    for update;
  if f.id is null then raise exception 'NO_FARM'; end if;
  if f.water_count < v_water or f.seed_count < v_seed or f.fertilizer_count < v_fert then
    raise exception 'NOT_ENOUGH_ITEMS';
  end if;

  update public.farms
    set water_count = water_count - v_water,
        seed_count = seed_count - v_seed,
        fertilizer_count = fertilizer_count - v_fert
    where id = f.id;
  if v_fert > 0 then
    insert into public.fertilizer_events (user_id, season_id, amount, reason)
      values (v_user, v_season, -v_fert, 'garden_contribution');
  end if;

  insert into public.community_garden_contributions
    (event_id, user_id, water_amount, seed_amount, fertilizer_amount)
    values (e.id, v_user, v_water, v_seed, v_fert);

  update public.community_garden_events
    set current_water = current_water + v_water,
        current_seeds = current_seeds + v_seed,
        current_fertilizer = current_fertilizer + v_fert
    where id = e.id
    returning * into e;

  if e.current_water >= e.required_water
     and e.current_seeds >= e.required_seeds
     and e.current_fertilizer >= e.required_fertilizer then
    update public.community_garden_events
      set status = 'completed', completed_at = now()
      where id = e.id;
    perform public.garden_distribute_rewards(e.id, 'completion');
    v_completed := true;
  end if;

  return jsonb_build_object(
    'contributed', true,
    'completed', v_completed,
    'current_water', e.current_water,
    'current_seeds', e.current_seeds,
    'current_fertilizer', e.current_fertilizer,
    'progress_percent', public.garden_progress_percent(e.id));
end;
$$;

-- basket passes: water in multiples of 5
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
  if v_water % 5 <> 0 then
    raise exception 'WATER_MULTIPLE_OF_5';
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

-- debug edits: water in multiples of 5
create or replace function public.debug_set_inventory(
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
  if p_water % 5 <> 0 then raise exception 'WATER_MULTIPLE_OF_5'; end if;

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

-- checklist reward edits: water in multiples of 5
create or replace function public.update_checklist_reward(p_definition_id uuid, p_water integer, p_fertilizer integer)
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
  if p_water % 5 <> 0 then
    raise exception 'WATER_MULTIPLE_OF_5';
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

-- ----------------------------------------------------------------------------
-- 10. update_game_settings v9 (v8 arrays from 20260709230000 VERBATIM
--     + store keys + water-step validation). ⚠️ Copy THESE arrays next time.
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
    'garden_show_names', 'garden_private_users_can_contribute',
    'store_enabled', 'store_sale_enabled'];
  percent_keys text[] := array[
    'basket_large_basket_chance_percent', 'blossom_chance_percent',
    'garden_partial_threshold_percent',
    'store_sale_min_percent', 'store_sale_max_percent'];
  min_two_keys text[] := array['basket_small_target_count', 'basket_large_target_count'];
  min_one_keys text[] := array[
    'basket_keep_multiplier', 'basket_hold_hours', 'blossom_fruit_multiplier',
    'garden_event_duration_days', 'garden_required_water',
    'garden_required_seeds', 'garden_required_fertilizer',
    'store_water_price', 'store_fertilizer_price',
    'store_seed_price', 'store_goose_entry_price'];
  text_keys text[] := array[
    'house_name_house_1', 'house_name_house_2', 'house_name_house_3',
    'house_name_house_4', 'house_name_house_5', 'house_name_house_6',
    'season_name_1', 'season_name_2', 'season_name_3',
    'season_name_4', 'season_name_5'];
  season_length_keys text[] := array[
    'season_length_days_1', 'season_length_days_2', 'season_length_days_3',
    'season_length_days_4', 'season_length_days_5'];
  garden_frequency_keys text[] := array['garden_frequency'];
  -- water is always a multiple of 5 (0 = "none" allowed for optional bonuses)
  water_step_keys text[] := array[
    'receiving_seed_bonus_water', 'basket_auto_pass_water',
    'basket_max_water_per_pass', 'garden_daily_water_limit',
    'garden_reward_water', 'garden_partial_reward_water',
    'goose_egg_water_amount'];
  -- the store bundle must be at least 5 water
  water_bundle_keys text[] := array['store_water_amount'];
  number_keys text[] := array[
    'meeting_attendance_reward_amount', 'hosting_reward_amount',
    'giving_seed_reward_amount', 'receiving_seed_reward_amount',
    'basket_max_seed_per_pass',
    'basket_max_fertilizer_per_pass',
    'goose_answer_collection_hours', 'goose_selection_hours',
    'goose_total_cycle_hours', 'goose_exclusion_months_on_missed_selection',
    'goose_egg_seed_amount', 'goose_egg_fertilizer_amount',
    'goose_keeper_completion_reward_amount',
    'garden_daily_seed_limit',
    'garden_daily_fertilizer_limit',
    'garden_reward_seeds', 'garden_reward_fertilizer',
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
             || season_length_keys || garden_frequency_keys
             || water_step_keys || water_bundle_keys || number_keys;

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
    elsif v_key = any(water_step_keys) then
      if jsonb_typeof(v_val) <> 'number' then raise exception 'INVALID_NUMBER for %', v_key; end if;
      v_num := (v_val #>> '{}')::numeric;
      if v_num < 0 or v_num <> floor(v_num) or (v_num::integer % 5) <> 0 then
        raise exception 'WATER_MULTIPLE_OF_5 for %', v_key;
      end if;
    elsif v_key = any(water_bundle_keys) then
      if jsonb_typeof(v_val) <> 'number' then raise exception 'INVALID_NUMBER for %', v_key; end if;
      v_num := (v_val #>> '{}')::numeric;
      if v_num < 5 or v_num <> floor(v_num) or (v_num::integer % 5) <> 0 then
        raise exception 'WATER_MULTIPLE_OF_5 for %', v_key;
      end if;
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
