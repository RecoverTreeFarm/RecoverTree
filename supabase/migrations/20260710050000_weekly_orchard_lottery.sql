-- ============================================================================
-- Weekly Orchard Lottery 🎟️
--
-- A cozy weekly community drawing. Players buy up to 3 tickets with COINS;
-- every ticket's price goes into a community pot; on Sunday one valid ticket
-- is drawn and the winner receives the player-funded pot PLUS an Orchard
-- bonus (default 25%, floor-rounded: bonus = floor(pot * pct / 100)).
--
-- ECONOMY (unchanged):
--   * Tickets cost Coins. Prizes and refunds are Coins. NEVER Water, Seeds,
--     Fertilizer, or Fruits. Fruits remain harvest-only. No real money.
--   * Coin movements follow the store convention: farms.coin_count update +
--     a signed public.coin_events ledger row.
--
-- KEY RULES:
--   * Max 3 tickets per user per round (snapshot on the round; hard cap 10).
--   * Only ONE distinct participant → full refund of what they paid, NO
--     Orchard bonus, status refunded_single_participant.
--   * No participants → status no_entries. Nothing moves.
--   * 2+ participants → equal-probability draw over valid tickets.
--   * Banned users are excluded at resolution: their tickets are marked
--     invalidated, are NOT refunded, and their coins are NOT counted in the
--     paid-out pot (documented behavior — consistent with "your account
--     can't take part" across the app).
--   * Every resolver/refund path is idempotent: terminal-status rounds are
--     returned as-is; running resolution again never double-pays.
--
-- SCHEDULE: rounds run Monday 00:00 → Sunday 18:00 (default) in the
-- configured timezone (default America/Los_Angeles — the app has no other
-- timezone convention). Sales close `lottery_sales_cutoff_minutes` (default
-- 15) before the draw. The existing pg_cron 10-minute tick
-- (run_scheduled_game_jobs) creates the week's round and resolves due ones,
-- so resolution lands within ~10 minutes of the draw time.
--
-- SEASON BOUNDARY: a round stores the season active at creation (for goal /
-- badge attribution). Prizes and refunds are ALWAYS credited to the user's
-- farm in the season active AT RESOLUTION TIME (same convention as ceremony
-- medals paying onto the next season's farm), so nothing is lost if a season
-- closes mid-round.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Coin ledger reasons for the lottery.
-- ----------------------------------------------------------------------------
alter table public.coin_events drop constraint coin_events_reason_check;
alter table public.coin_events
  add constraint coin_events_reason_check
  check (reason in
    ('medal_reward', 'badge_reward', 'checklist_reward', 'seed_received',
     'golden_goose', 'basket_reward', 'basket_contribution',
     'garden_reward', 'debug_adjustment', 'admin_adjustment',
     'store_purchase', 'reward_bonus', 'meeting_reward', 'seed_given',
     'lottery_ticket', 'lottery_prize', 'lottery_refund'));

-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------
create table public.weekly_lottery_rounds (
  id uuid primary key default gen_random_uuid(),
  -- the season active when the round was created (attribution only)
  season_id uuid references public.seasons (id) on delete set null,
  week_key text not null unique,          -- e.g. 2026-W28 (ISO week, local tz)
  opens_at timestamptz not null,
  sales_close_at timestamptz not null,
  draw_at timestamptz not null,
  timezone text not null,
  -- snapshots: an admin change never retroactively alters this round
  ticket_price_coins integer not null check (ticket_price_coins >= 1),
  max_tickets_per_user integer not null check (max_tickets_per_user between 1 and 10),
  orchard_bonus_percent integer not null check (orchard_bonus_percent between 0 and 100),
  player_funded_pot_coins integer not null default 0,
  orchard_bonus_coins integer not null default 0,
  final_prize_coins integer not null default 0,
  total_tickets integer not null default 0,
  distinct_participant_count integer not null default 0,
  status text not null default 'open' check (status in
    ('scheduled', 'open', 'sales_closed', 'drawn', 'no_entries',
     'refunded_single_participant', 'cancelled')),
  winning_ticket_id uuid,
  winner_user_id uuid references auth.users (id) on delete set null,
  drawn_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger weekly_lottery_rounds_set_updated_at
  before update on public.weekly_lottery_rounds
  for each row execute function public.set_updated_at();

create table public.weekly_lottery_tickets (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.weekly_lottery_rounds (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  ticket_number integer not null,
  coins_paid integer not null check (coins_paid > 0),
  status text not null default 'valid' check (status in ('valid', 'refunded', 'invalidated')),
  purchased_at timestamptz not null default now(),
  refunded_at timestamptz,
  idempotency_key text,
  constraint weekly_lottery_tickets_number_unique unique (round_id, ticket_number)
);
create index weekly_lottery_tickets_round_idx on public.weekly_lottery_tickets (round_id);
create index weekly_lottery_tickets_user_idx on public.weekly_lottery_tickets (user_id, purchased_at desc);
-- idempotent purchase retries: one key can only ever land once per user+round
create unique index weekly_lottery_tickets_idem_key
  on public.weekly_lottery_tickets (round_id, user_id, idempotency_key)
  where idempotency_key is not null;

-- RLS: tickets — own rows readable; rounds — admin only (everyone else reads
-- the privacy-safe get_weekly_lottery_state RPC, which never exposes another
-- user's id). No client writes anywhere.
alter table public.weekly_lottery_rounds enable row level security;
create policy "lottery rounds: admin read"
  on public.weekly_lottery_rounds for select to authenticated
  using (public.is_admin());

alter table public.weekly_lottery_tickets enable row level security;
create policy "lottery tickets: own or admin"
  on public.weekly_lottery_tickets for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ----------------------------------------------------------------------------
-- 2. create_or_get_current_lottery_round(): lazily creates this week's round,
--    snapshotting settings. Idempotent (week_key unique + on conflict).
--    Weekday convention matches the client (0=Sunday … 6=Saturday).
-- ----------------------------------------------------------------------------
create or replace function public.create_or_get_current_lottery_round()
returns public.weekly_lottery_rounds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz text := coalesce(nullif(trim(public.game_setting_text('lottery_timezone', 'America/Los_Angeles')), ''), 'America/Los_Angeles');
  v_local timestamp;
  v_monday timestamp;
  v_week_key text;
  v_weekday integer := least(greatest(public.game_setting_int('lottery_draw_weekday', 0), 0), 6);
  v_time text := public.game_setting_text('lottery_draw_time', '18:00');
  v_hh integer;
  v_mm integer;
  v_cutoff integer := greatest(public.game_setting_int('lottery_sales_cutoff_minutes', 15), 0);
  v_price integer := greatest(public.game_setting_int('lottery_ticket_price_coins', 20), 1);
  v_max integer := least(greatest(public.game_setting_int('lottery_max_tickets_per_user', 3), 1), 10);
  v_pct integer := least(greatest(public.game_setting_int('lottery_orchard_bonus_percent', 25), 0), 100);
  v_season uuid;
  v_draw_local timestamp;
  v_row public.weekly_lottery_rounds;
begin
  -- an unknown timezone must never break the game tick — fall back quietly
  begin
    v_local := now() at time zone v_tz;
  exception when others then
    v_tz := 'America/Los_Angeles';
    v_local := now() at time zone v_tz;
  end;

  v_monday := date_trunc('week', v_local);        -- Monday 00:00, local wall time
  v_week_key := to_char(v_monday, 'IYYY-"W"IW');

  select id into v_season from public.seasons where status = 'active' limit 1;

  -- parse 'HH:MM' (fall back to 18:00 on anything unparseable)
  begin
    v_hh := split_part(v_time, ':', 1)::integer;
    v_mm := split_part(v_time, ':', 2)::integer;
    if v_hh not between 0 and 23 or v_mm not between 0 and 59 then
      raise exception 'bad time';
    end if;
  exception when others then
    v_hh := 18; v_mm := 0;
  end;

  -- 0=Sunday lands on the LAST day of the Monday-based week
  v_draw_local := v_monday
    + (((v_weekday + 6) % 7) * interval '1 day')
    + (v_hh * interval '1 hour') + (v_mm * interval '1 minute');

  insert into public.weekly_lottery_rounds
    (season_id, week_key, opens_at, sales_close_at, draw_at, timezone,
     ticket_price_coins, max_tickets_per_user, orchard_bonus_percent, status)
  values
    (v_season, v_week_key,
     v_monday at time zone v_tz,
     (v_draw_local - (v_cutoff * interval '1 minute')) at time zone v_tz,
     v_draw_local at time zone v_tz,
     v_tz, v_price, v_max, v_pct, 'open')
  on conflict (week_key) do nothing;

  select * into v_row from public.weekly_lottery_rounds where week_key = v_week_key;
  return v_row;
end;
$$;

revoke execute on function public.create_or_get_current_lottery_round() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Coin credit helper: prizes/refunds land on the ACTIVE season's farm
--    (created if missing), with a ledger row. Internal only.
-- ----------------------------------------------------------------------------
create or replace function public.lottery_credit_coins(p_user uuid, p_amount integer, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season uuid;
begin
  if p_amount is null or p_amount <= 0 then return; end if;
  select id into v_season from public.seasons where status = 'active' limit 1;
  insert into public.farms (user_id, season_id) values (p_user, v_season)
    on conflict (user_id, season_id) do nothing;
  update public.farms set coin_count = coin_count + p_amount
    where user_id = p_user and season_id = v_season;
  insert into public.coin_events (user_id, season_id, amount, reason)
    values (p_user, v_season, p_amount, p_reason);
end;
$$;

revoke execute on function public.lottery_credit_coins(uuid, integer, text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. buy_lottery_tickets(p_quantity, p_idempotency_key):
--    all-or-nothing, atomic, server-priced. Errors are coded for the client.
-- ----------------------------------------------------------------------------
create or replace function public.buy_lottery_tickets(
  p_quantity integer,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_round public.weekly_lottery_rounds;
  v_banned boolean;
  v_mine integer;
  v_cost integer;
  v_farm uuid;
  v_coins integer;
  v_season uuid;
  n integer;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  select is_banned into v_banned from public.profiles where user_id = v_user;
  if v_banned is null then raise exception 'NO_PROFILE'; end if;
  if v_banned then raise exception 'BANNED'; end if;
  if not coalesce((public.game_setting_text('lottery_enabled', 'true')) <> 'false', true) then
    raise exception 'LOTTERY_DISABLED';
  end if;
  if p_quantity is null or p_quantity < 1 then raise exception 'INVALID_QUANTITY'; end if;

  v_round := public.create_or_get_current_lottery_round();
  -- lock the round so counters/ticket numbers are race-free
  select * into v_round from public.weekly_lottery_rounds
    where id = v_round.id for update;

  if v_round.status <> 'open' or now() >= v_round.sales_close_at then
    raise exception 'SALES_CLOSED';
  end if;

  -- retried request with the same key: return current state, buy nothing
  if p_idempotency_key is not null and exists (
    select 1 from public.weekly_lottery_tickets
    where round_id = v_round.id and user_id = v_user
      and idempotency_key = p_idempotency_key
  ) then
    return jsonb_build_object('ok', true, 'already_processed', true);
  end if;

  select count(*) into v_mine from public.weekly_lottery_tickets
    where round_id = v_round.id and user_id = v_user and status <> 'invalidated';
  if v_mine + p_quantity > v_round.max_tickets_per_user then
    raise exception 'MAX_TICKETS';
  end if;

  v_cost := v_round.ticket_price_coins * p_quantity;

  select f.id, f.coin_count, f.season_id into v_farm, v_coins, v_season
  from public.farms f
  join public.seasons s on s.id = f.season_id and s.status = 'active'
  where f.user_id = v_user
  for update of f;
  if v_farm is null then raise exception 'NO_FARM'; end if;
  if v_coins < v_cost then raise exception 'NOT_ENOUGH_COINS'; end if;

  -- deduct once for the whole purchase (all-or-nothing), ledger row included
  update public.farms set coin_count = coin_count - v_cost where id = v_farm;
  insert into public.coin_events (user_id, season_id, amount, reason)
    values (v_user, v_season, -v_cost, 'lottery_ticket');

  for n in 1..p_quantity loop
    insert into public.weekly_lottery_tickets
      (round_id, user_id, ticket_number, coins_paid, idempotency_key)
    values
      (v_round.id, v_user, v_round.total_tickets + n, v_round.ticket_price_coins,
       case when n = 1 then p_idempotency_key else null end);
  end loop;

  update public.weekly_lottery_rounds
    set total_tickets = total_tickets + p_quantity,
        player_funded_pot_coins = player_funded_pot_coins + v_cost,
        distinct_participant_count = (
          select count(distinct user_id) from public.weekly_lottery_tickets
          where round_id = v_round.id and status <> 'invalidated')
    where id = v_round.id;

  -- lottery goals may have just completed (never blocks the purchase)
  begin
    perform public.recompute_checklists(v_user, v_season);
  exception when others then null;
  end;

  return jsonb_build_object(
    'ok', true,
    'tickets_bought', p_quantity,
    'coins_spent', v_cost,
    'my_tickets', v_mine + p_quantity,
    'coins_left', v_coins - v_cost);
end;
$$;

revoke execute on function public.buy_lottery_tickets(integer, text) from public, anon;
grant execute on function public.buy_lottery_tickets(integer, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. get_weekly_lottery_state(): everything the panel needs, privacy-safe.
--    Never exposes another user's id; the winner is shown by display name
--    only when their leaderboard visibility is public AND the admin
--    "show winner publicly" switch is on.
-- ----------------------------------------------------------------------------
create or replace function public.get_weekly_lottery_state()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_enabled boolean := coalesce((public.game_setting_text('lottery_enabled', 'true')) <> 'false', true);
  v_round public.weekly_lottery_rounds;
  v_mine integer := 0;
  v_last public.weekly_lottery_rounds;
  v_last_json jsonb := null;
  v_winner_name text;
  v_show_winner boolean := coalesce((public.game_setting_text('lottery_show_winner_publicly', 'true')) <> 'false', true);
  v_my_spend integer;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  if v_enabled then
    v_round := public.create_or_get_current_lottery_round();
  else
    select * into v_round from public.weekly_lottery_rounds
      order by draw_at desc limit 1;
  end if;

  if v_round.id is not null then
    select count(*) into v_mine from public.weekly_lottery_tickets
      where round_id = v_round.id and user_id = v_user and status <> 'invalidated';
  end if;

  -- most recent RESOLVED round (may be the current one after Sunday)
  select * into v_last from public.weekly_lottery_rounds
    where status in ('drawn', 'no_entries', 'refunded_single_participant', 'cancelled')
    order by draw_at desc limit 1;

  if v_last.id is not null then
    v_winner_name := null;
    if v_last.status = 'drawn' and v_last.winner_user_id is not null and v_show_winner then
      select case when p.leaderboard_visibility = 'public'
                  then coalesce(p.display_name, '@' || p.username)
                  else 'A farmer' end
        into v_winner_name
      from public.profiles p where p.user_id = v_last.winner_user_id;
    end if;
    select coalesce(sum(coins_paid), 0) into v_my_spend
      from public.weekly_lottery_tickets
      where round_id = v_last.id and user_id = v_user and status in ('valid', 'refunded');
    v_last_json := jsonb_build_object(
      'round_id', v_last.id,
      'week_key', v_last.week_key,
      'status', v_last.status,
      'final_prize_coins', v_last.final_prize_coins,
      'player_funded_pot_coins', v_last.player_funded_pot_coins,
      'orchard_bonus_coins', v_last.orchard_bonus_coins,
      'winner_name', v_winner_name,
      'i_won', v_last.winner_user_id is not null and v_last.winner_user_id = v_user,
      'i_entered', v_my_spend > 0,
      'i_was_refunded', v_last.status in ('refunded_single_participant', 'cancelled') and v_my_spend > 0,
      'my_coins_back', case when v_last.status in ('refunded_single_participant', 'cancelled') then v_my_spend else 0 end);
  end if;

  return jsonb_build_object(
    'enabled', v_enabled,
    'show_ticket_count', coalesce((public.game_setting_text('lottery_show_ticket_count', 'true')) <> 'false', true),
    'show_participant_count', coalesce((public.game_setting_text('lottery_show_participant_count', 'true')) <> 'false', true),
    'show_pot', coalesce((public.game_setting_text('lottery_show_pot', 'true')) <> 'false', true),
    'round', case when v_round.id is null then null else jsonb_build_object(
      'round_id', v_round.id,
      'week_key', v_round.week_key,
      'status', v_round.status,
      'sales_open', v_round.status = 'open' and now() < v_round.sales_close_at,
      'opens_at', v_round.opens_at,
      'sales_close_at', v_round.sales_close_at,
      'draw_at', v_round.draw_at,
      'timezone', v_round.timezone,
      'ticket_price_coins', v_round.ticket_price_coins,
      'max_tickets_per_user', v_round.max_tickets_per_user,
      'my_tickets', v_mine,
      'total_tickets', v_round.total_tickets,
      'distinct_participant_count', v_round.distinct_participant_count,
      'player_funded_pot_coins', v_round.player_funded_pot_coins,
      -- preview only — the real bonus is computed at resolution
      'orchard_bonus_preview', floor(v_round.player_funded_pot_coins * v_round.orchard_bonus_percent / 100.0)::integer,
      'final_prize_preview', v_round.player_funded_pot_coins
        + floor(v_round.player_funded_pot_coins * v_round.orchard_bonus_percent / 100.0)::integer,
      'orchard_bonus_percent', v_round.orchard_bonus_percent
    ) end,
    'last_result', v_last_json);
end;
$$;

revoke execute on function public.get_weekly_lottery_state() from public, anon;
grant execute on function public.get_weekly_lottery_state() to authenticated;

-- ----------------------------------------------------------------------------
-- 6. resolve_weekly_lottery_round(): the one resolution path (auto, force,
--    and retry all land here). Fully idempotent — a terminal round returns
--    its stored result and moves NO coins.
-- ----------------------------------------------------------------------------
create or replace function public.resolve_weekly_lottery_round(
  p_round uuid,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round public.weekly_lottery_rounds;
  v_pot integer;
  v_participants integer;
  v_bonus integer;
  v_prize integer;
  v_ticket public.weekly_lottery_tickets;
  r record;
begin
  select * into v_round from public.weekly_lottery_rounds
    where id = p_round for update;
  if v_round.id is null then raise exception 'ROUND_NOT_FOUND'; end if;

  -- already resolved → idempotent no-op
  if v_round.status in ('drawn', 'no_entries', 'refunded_single_participant', 'cancelled') then
    return jsonb_build_object('ok', true, 'status', v_round.status, 'already_resolved', true);
  end if;

  if not p_force and now() < v_round.draw_at then
    raise exception 'NOT_DUE';
  end if;

  -- banned users are excluded: tickets invalidated, not refunded, and their
  -- coins are excluded from the paid-out pot (documented in the header)
  update public.weekly_lottery_tickets t
    set status = 'invalidated'
    from public.profiles p
    where t.round_id = v_round.id and t.status = 'valid'
      and p.user_id = t.user_id and p.is_banned;

  select coalesce(sum(coins_paid), 0), count(distinct user_id)
    into v_pot, v_participants
  from public.weekly_lottery_tickets
  where round_id = v_round.id and status = 'valid';

  if v_participants = 0 then
    update public.weekly_lottery_rounds
      set status = 'no_entries', resolved_at = now(),
          player_funded_pot_coins = 0, orchard_bonus_coins = 0, final_prize_coins = 0,
          distinct_participant_count = 0
      where id = v_round.id;
    insert into public.admin_audit_logs (actor_user_id, action, metadata_json)
      values (auth.uid(), 'lottery_round_resolved',
              jsonb_build_object('round_id', v_round.id, 'result', 'no_entries'));
    return jsonb_build_object('ok', true, 'status', 'no_entries');
  end if;

  if v_participants = 1 then
    -- ONE distinct participant: exact refund, no Orchard bonus, no winner.
    for r in
      select user_id, sum(coins_paid)::integer as paid
      from public.weekly_lottery_tickets
      where round_id = v_round.id and status = 'valid'
      group by user_id
    loop
      perform public.lottery_credit_coins(r.user_id, r.paid, 'lottery_refund');
    end loop;
    update public.weekly_lottery_tickets
      set status = 'refunded', refunded_at = now()
      where round_id = v_round.id and status = 'valid';
    update public.weekly_lottery_rounds
      set status = 'refunded_single_participant', resolved_at = now(),
          player_funded_pot_coins = v_pot, orchard_bonus_coins = 0,
          final_prize_coins = 0, distinct_participant_count = 1
      where id = v_round.id;
    insert into public.admin_audit_logs (actor_user_id, action, metadata_json)
      values (auth.uid(), 'lottery_round_resolved',
              jsonb_build_object('round_id', v_round.id,
                'result', 'refunded_single_participant', 'refunded_coins', v_pot));
    return jsonb_build_object('ok', true, 'status', 'refunded_single_participant');
  end if;

  -- 2+ participants: equal-probability draw over VALID tickets, in Postgres.
  select * into v_ticket from public.weekly_lottery_tickets
    where round_id = v_round.id and status = 'valid'
    order by random() limit 1;

  v_bonus := floor(v_pot * v_round.orchard_bonus_percent / 100.0)::integer;
  v_prize := v_pot + v_bonus;

  perform public.lottery_credit_coins(v_ticket.user_id, v_prize, 'lottery_prize');

  update public.weekly_lottery_rounds
    set status = 'drawn', drawn_at = now(), resolved_at = now(),
        winning_ticket_id = v_ticket.id, winner_user_id = v_ticket.user_id,
        player_funded_pot_coins = v_pot, orchard_bonus_coins = v_bonus,
        final_prize_coins = v_prize,
        distinct_participant_count = v_participants
    where id = v_round.id;

  insert into public.admin_audit_logs (actor_user_id, action, metadata_json)
    values (auth.uid(), 'lottery_round_resolved',
            jsonb_build_object('round_id', v_round.id, 'result', 'drawn',
              'pot', v_pot, 'bonus', v_bonus, 'prize', v_prize));

  return jsonb_build_object('ok', true, 'status', 'drawn', 'prize', v_prize);
end;
$$;

revoke execute on function public.resolve_weekly_lottery_round(uuid, boolean) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7. resolve_due_lottery_rounds(): for the scheduled tick. Retry-safe.
-- ----------------------------------------------------------------------------
create or replace function public.resolve_due_lottery_rounds()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  -- close sales the moment the cutoff passes (label-only; buy checks time too)
  update public.weekly_lottery_rounds
    set status = 'sales_closed'
    where status = 'open' and now() >= sales_close_at;

  if (public.game_setting_text('lottery_auto_draw_enabled', 'true')) = 'false' then
    return;
  end if;

  for r in
    select id from public.weekly_lottery_rounds
    where status in ('open', 'sales_closed') and now() >= draw_at
    order by draw_at
  loop
    begin
      perform public.resolve_weekly_lottery_round(r.id);
    exception when others then
      raise warning 'lottery resolution failed for %: %', r.id, sqlerrm;
    end;
  end loop;
end;
$$;

revoke execute on function public.resolve_due_lottery_rounds() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 8. Admin functions (audit-logged, idempotent).
-- ----------------------------------------------------------------------------
create or replace function public.admin_cancel_lottery_round(p_round uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round public.weekly_lottery_rounds;
  v_refunded integer := 0;
  r record;
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  select * into v_round from public.weekly_lottery_rounds where id = p_round for update;
  if v_round.id is null then raise exception 'ROUND_NOT_FOUND'; end if;
  if v_round.status in ('drawn', 'no_entries', 'refunded_single_participant', 'cancelled') then
    return jsonb_build_object('ok', true, 'status', v_round.status, 'already_resolved', true);
  end if;

  for r in
    select user_id, sum(coins_paid)::integer as paid
    from public.weekly_lottery_tickets
    where round_id = p_round and status = 'valid'
    group by user_id
  loop
    perform public.lottery_credit_coins(r.user_id, r.paid, 'lottery_refund');
    v_refunded := v_refunded + r.paid;
  end loop;
  update public.weekly_lottery_tickets
    set status = 'refunded', refunded_at = now()
    where round_id = p_round and status = 'valid';

  update public.weekly_lottery_rounds
    set status = 'cancelled', resolved_at = now(),
        orchard_bonus_coins = 0, final_prize_coins = 0
    where id = p_round;

  insert into public.admin_audit_logs (actor_user_id, action, metadata_json)
    values (auth.uid(), 'lottery_round_cancelled',
            jsonb_build_object('round_id', p_round, 'reason', p_reason,
              'refunded_coins', v_refunded));
  return jsonb_build_object('ok', true, 'status', 'cancelled', 'refunded_coins', v_refunded);
end;
$$;

revoke execute on function public.admin_cancel_lottery_round(uuid, text) from public, anon;
grant execute on function public.admin_cancel_lottery_round(uuid, text) to authenticated;

create or replace function public.admin_force_resolve_lottery_round(p_round uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  v_result := public.resolve_weekly_lottery_round(p_round, true);
  insert into public.admin_audit_logs (actor_user_id, action, metadata_json)
    values (auth.uid(), 'lottery_round_force_resolved',
            jsonb_build_object('round_id', p_round, 'result', v_result));
  return v_result;
end;
$$;

revoke execute on function public.admin_force_resolve_lottery_round(uuid) from public, anon;
grant execute on function public.admin_force_resolve_lottery_round(uuid) to authenticated;

-- Rounds list for the admin console (winner shown to admins by name).
create or replace function public.get_admin_lottery_rounds()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'round_id', r.id,
      'week_key', r.week_key,
      'status', r.status,
      'opens_at', r.opens_at,
      'sales_close_at', r.sales_close_at,
      'draw_at', r.draw_at,
      'ticket_price_coins', r.ticket_price_coins,
      'max_tickets_per_user', r.max_tickets_per_user,
      'orchard_bonus_percent', r.orchard_bonus_percent,
      'total_tickets', r.total_tickets,
      'distinct_participant_count', r.distinct_participant_count,
      'player_funded_pot_coins', r.player_funded_pot_coins,
      'orchard_bonus_coins', r.orchard_bonus_coins,
      'final_prize_coins', r.final_prize_coins,
      'winner_username', p.username,
      'resolved_at', r.resolved_at
    ) order by r.draw_at desc)
    from public.weekly_lottery_rounds r
    left join public.profiles p on p.user_id = r.winner_user_id
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.get_admin_lottery_rounds() from public, anon;
grant execute on function public.get_admin_lottery_rounds() to authenticated;

-- ----------------------------------------------------------------------------
-- 9. run_scheduled_game_jobs v3 = v2 (20260709220000) + lottery round
--    creation + due-round resolution. The pg_cron job that calls this every
--    10 minutes already exists ('recovertree-game-tick').
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

  begin
    perform public.create_or_get_current_community_garden();
  exception when others then
    raise warning 'scheduled community garden tick failed: %', sqlerrm;
  end;

  begin
    if (public.game_setting_text('lottery_enabled', 'true')) <> 'false' then
      perform public.create_or_get_current_lottery_round();
    end if;
    perform public.resolve_due_lottery_rounds();
  exception when others then
    raise warning 'scheduled lottery tick failed: %', sqlerrm;
  end;
end;
$$;

revoke execute on function public.run_scheduled_game_jobs() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 10. Feature-intro key for the lottery popup.
-- ----------------------------------------------------------------------------
create or replace function public.mark_feature_intro_seen(p_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  c_allowed constant text[] := array[
    'meeting_code', 'store', 'community_garden', 'traveling_basket',
    'golden_goose', 'lottery'];
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;
  if not (p_key = any(c_allowed)) then
    raise exception 'UNKNOWN_FEATURE_KEY: %', p_key;
  end if;
  update public.profiles
    set feature_intro_seen =
      coalesce(feature_intro_seen, '{}'::jsonb) || jsonb_build_object(p_key, true)
    where user_id = v_user;
end;
$$;

revoke execute on function public.mark_feature_intro_seen(text) from public, anon;
grant execute on function public.mark_feature_intro_seen(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 11. Checklist goals. Lottery goals are OPTIONAL pool entries and none
--     requires WINNING (winning stays a badge, never a checklist goal).
--     harvest_5 fills the one clearly-missing core-loop goal.
-- ----------------------------------------------------------------------------
insert into public.checklist_definitions
  (key, name, description, rule_type, config, water_reward, fertilizer_reward, coin_reward, active, sort_order)
values
  ('lottery_first_ticket', 'First Ticket',
   'Buy a Weekly Orchard Lottery ticket this season.',
   'lottery_ticket_count', '{"target": 1}'::jsonb, 10, 0, 10, true, 27),
  ('lottery_sunday_regular', 'Sunday Regular',
   'Enter 2 separate weekly drawings this season.',
   'lottery_rounds_entered', '{"target": 2}'::jsonb, 15, 1, 10, true, 28),
  ('lottery_full_book', 'Full Ticket Book',
   'Hold every ticket you can in one weekly drawing.',
   'lottery_full_book', '{"target": 1}'::jsonb, 15, 0, 10, true, 29),
  ('lottery_pot_milestone', 'Community Pot',
   'Be part of a weekly drawing that reaches 10 tickets.',
   'lottery_pot_milestone', '{"target": 1}'::jsonb, 15, 0, 10, true, 30),
  ('harvest_5', 'Bring in the harvest',
   'Harvest 5 trees this season.',
   'harvest_count', '{"target": 5}'::jsonb, 20, 1, 10, true, 31)
on conflict (key) do nothing;

-- recompute_checklists v5 = v4 (20260710020000) + lottery + harvest rules.
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
      -- ---- lottery + harvest rule types -----------------------------------
      when 'lottery_ticket_count' then
        (select count(*) from public.weekly_lottery_tickets t
          join public.weekly_lottery_rounds r on r.id = t.round_id
          where t.user_id = p_user and r.season_id = p_season
            and t.status <> 'invalidated')
      when 'lottery_rounds_entered' then
        (select count(distinct t.round_id) from public.weekly_lottery_tickets t
          join public.weekly_lottery_rounds r on r.id = t.round_id
          where t.user_id = p_user and r.season_id = p_season
            and t.status <> 'invalidated')
      when 'lottery_full_book' then
        (select count(*) from (
          select t.round_id
          from public.weekly_lottery_tickets t
          join public.weekly_lottery_rounds r on r.id = t.round_id
          where t.user_id = p_user and r.season_id = p_season
            and t.status <> 'invalidated'
          group by t.round_id, r.max_tickets_per_user
          having count(*) >= r.max_tickets_per_user) full_rounds)
      when 'lottery_pot_milestone' then
        (select count(distinct t.round_id) from public.weekly_lottery_tickets t
          join public.weekly_lottery_rounds r on r.id = t.round_id
          where t.user_id = p_user and r.season_id = p_season
            and t.status <> 'invalidated' and r.total_tickets >= 10)
      when 'harvest_count' then
        (select count(*) from public.fruit_events
          where user_id = p_user and season_id = p_season
            and source_type = 'harvest')
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

revoke execute on function public.recompute_checklists(uuid, uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 12. New badge categories: 5 lottery + 5 measurable MVP badges. All join
--     the random 3-per-season ceremony pool. No "most Coins spent" and no
--     refund-shaming badge, by design.
-- ----------------------------------------------------------------------------
insert into public.badge_definitions (key, name, description, icon, active) values
  ('lucky_farmer',        'Lucky Farmer',        'Won a Weekly Orchard Lottery.',              '🍀', true),
  ('ticket_tiller',       'Ticket Tiller',       'Entered the most weekly drawings.',          '🎟️', true),
  ('three_ticket_clover', 'Three-Ticket Clover', 'Held a full ticket book in one drawing.',    '☘️', true),
  ('big_orchard_win',     'Big Orchard Win',     'Won a grand Sunday prize.',                  '🏵️', true),
  ('community_pot_pal',   'Community Pot Pal',   'Part of the season''s biggest community pot.','🤝', true),
  ('green_thumb',         'Green Thumb',         'Harvested the most trees.',                  '🧤', true),
  ('cherry_blossom_fan',  'Cherry Blossom',      'Harvested the most blossom trees.',          '🌸', true),
  ('goose_whisperer',     'Goose Whisperer',     'Answered the Golden Goose most often.',      '🪿', true),
  ('basket_builder',      'Basket Builder',      'Added to the Traveling Basket most often.',  '🧺', true),
  ('garden_helper',       'Garden Helper',       'Tended the Community Garden the most.',      '🌷', true)
on conflict (key) do nothing;

-- pick_badge_winner: extend the LIVE function (verified anchor after the
-- night_sprout branch) with the new categories, same injection pattern as
-- settings v10 — the live definition is rebuilt with extra elsif branches.
do $$
declare
  v_def text;
  v_anchor text := '        and (extract(hour from attended_at) >= 22 or extract(hour from attended_at) < 5)
      group by attendee_user_id;
  end if;';
  v_new text;
begin
  select pg_get_functiondef(oid) into v_def
  from pg_proc where proname = 'pick_badge_winner';
  if v_def is null then raise exception 'pick_badge_winner is missing'; end if;
  if position('lucky_farmer' in v_def) > 0 then
    raise notice 'lottery badges already injected — nothing to do';
    return;
  end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'pick_badge_winner anchor not found — restate manually';
  end if;

  v_new := '        and (extract(hour from attended_at) >= 22 or extract(hour from attended_at) < 5)
      group by attendee_user_id;
  elsif p_key = ''lucky_farmer'' then
    insert into _bscores select winner_user_id, count(*)
      from public.weekly_lottery_rounds
      where season_id = p_season and status = ''drawn'' and winner_user_id is not null
      group by winner_user_id;
  elsif p_key = ''ticket_tiller'' then
    insert into _bscores select t.user_id, count(distinct t.round_id)
      from public.weekly_lottery_tickets t
      join public.weekly_lottery_rounds r on r.id = t.round_id
      where r.season_id = p_season and t.status <> ''invalidated''
      group by t.user_id;
  elsif p_key = ''three_ticket_clover'' then
    insert into _bscores select user_id, count(*) from (
      select t.user_id, t.round_id
      from public.weekly_lottery_tickets t
      join public.weekly_lottery_rounds r on r.id = t.round_id
      where r.season_id = p_season and t.status <> ''invalidated''
      group by t.user_id, t.round_id, r.max_tickets_per_user
      having count(*) >= r.max_tickets_per_user) fb
      group by user_id;
  elsif p_key = ''big_orchard_win'' then
    insert into _bscores select winner_user_id, count(*)
      from public.weekly_lottery_rounds
      where season_id = p_season and status = ''drawn'' and winner_user_id is not null
        and final_prize_coins >= greatest(public.game_setting_int(''lottery_big_win_threshold'', 200), 1)
      group by winner_user_id;
  elsif p_key = ''community_pot_pal'' then
    -- random among participants of the biggest-pot round (a val of random()
    -- makes ties impossible, so the >2-way-tie guard never blocks it)
    insert into _bscores select distinct t.user_id, random()
      from public.weekly_lottery_tickets t
      where t.status <> ''invalidated'' and t.round_id = (
        select id from public.weekly_lottery_rounds
        where season_id = p_season and player_funded_pot_coins > 0
        order by player_funded_pot_coins desc, draw_at desc limit 1);
  elsif p_key = ''green_thumb'' then
    insert into _bscores select user_id, count(*)
      from public.fruit_events
      where season_id = p_season and source_type = ''harvest''
      group by user_id;
  elsif p_key = ''cherry_blossom_fan'' then
    insert into _bscores select user_id, count(*)
      from public.fruit_events
      where season_id = p_season and source_type = ''harvest''
        and description like ''Harvested a blossom%''
      group by user_id;
  elsif p_key = ''goose_whisperer'' then
    insert into _bscores select s.user_id, count(*)
      from public.golden_goose_submissions s
      where not s.is_deleted
        and s.created_at >= (select starts_at from public.seasons where id = p_season)
        and s.created_at < (select ends_at from public.seasons where id = p_season)
      group by s.user_id;
  elsif p_key = ''basket_builder'' then
    insert into _bscores select c.contributor_user_id, count(*)
      from public.traveling_basket_contributions c
      where c.contributed_at >= (select starts_at from public.seasons where id = p_season)
        and c.contributed_at < (select ends_at from public.seasons where id = p_season)
      group by c.contributor_user_id;
  elsif p_key = ''garden_helper'' then
    insert into _bscores select c.user_id, count(*)
      from public.community_garden_contributions c
      where c.created_at >= (select starts_at from public.seasons where id = p_season)
        and c.created_at < (select ends_at from public.seasons where id = p_season)
      group by c.user_id;
  end if;';

  v_def := replace(v_def, v_anchor, v_new);
  execute v_def;
end
$$;

-- ----------------------------------------------------------------------------
-- 13. update_game_settings v11 = live v10 + the lottery keys, injected into
--     the validated arrays (same pg_get_functiondef pattern as v10). The
--     draw weekday reuses the 0–7 days validation and is clamped to 0–6 at
--     round creation; time/timezone are text and re-validated (with quiet
--     fallbacks) when each round is created.
-- ----------------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(oid) into v_def
  from pg_proc where proname = 'update_game_settings';
  if v_def is null then raise exception 'update_game_settings is missing'; end if;
  if position('lottery_enabled' in v_def) > 0 then
    raise notice 'lottery settings already allowed — nothing to do';
    return;
  end if;

  v_def := replace(v_def,
    '''store_enabled'', ''store_sale_enabled''];',
    '''store_enabled'', ''store_sale_enabled'',
    ''lottery_enabled'', ''lottery_auto_draw_enabled'',
    ''lottery_show_ticket_count'', ''lottery_show_participant_count'',
    ''lottery_show_pot'', ''lottery_show_winner_publicly''];');
  v_def := replace(v_def,
    '''store_sale_min_percent'', ''store_sale_max_percent''];',
    '''store_sale_min_percent'', ''store_sale_max_percent'',
    ''lottery_orchard_bonus_percent''];');
  v_def := replace(v_def,
    '''store_seed_price'', ''store_goose_entry_price''];',
    '''store_seed_price'', ''store_goose_entry_price'',
    ''lottery_ticket_price_coins'', ''lottery_max_tickets_per_user''];');
  v_def := replace(v_def,
    'array[''basket_random_days_per_week'', ''goose_random_days_per_week''];',
    'array[''basket_random_days_per_week'', ''goose_random_days_per_week'',
    ''lottery_draw_weekday''];');
  v_def := replace(v_def,
    '''season_name_4'', ''season_name_5''];',
    '''season_name_4'', ''season_name_5'',
    ''lottery_draw_time'', ''lottery_timezone''];');
  v_def := replace(v_def,
    '''reward_coin_bonus''];',
    '''reward_coin_bonus'',
    ''lottery_sales_cutoff_minutes'', ''lottery_big_win_threshold''];');

  execute v_def;
end
$$;

revoke execute on function public.update_game_settings(jsonb) from public, anon;
grant execute on function public.update_game_settings(jsonb) to authenticated;
