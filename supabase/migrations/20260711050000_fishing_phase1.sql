-- ============================================================================
-- FISHING — PHASE 1 (2026-07-11). Admin-only preview of the fishing module:
-- a Fishing Lake location, a Stardew-style catch minigame (client), a fish
-- inventory completely separate from Water/Seeds/Fertilizer/Fruits, and fish
-- selling for Coins at the lake hut.
--
-- Economy rules preserved: fish sales pay COINS ONLY (never Fruits — the
-- leaderboard still ranks harvests alone). All writes go through
-- SECURITY DEFINER functions that check fishing_allowed().
--
-- Explicitly NOT in this phase: rods, bait, stamina, weather, seasons,
-- quests, multiplayer, leaderboards (settings placeholders only).
-- ============================================================================

-- ---- reference data: the species -------------------------------------------
create table public.fish_definitions (
  id text primary key,
  name text not null,
  rarity text not null check (rarity in ('common', 'uncommon', 'rare', 'legendary')),
  coin_value integer not null check (coin_value > 0),
  sort integer not null default 0
);

alter table public.fish_definitions enable row level security;
create policy fish_definitions_read on public.fish_definitions
  for select to authenticated using (true);

insert into public.fish_definitions (id, name, rarity, coin_value, sort) values
  ('bluegill',         'Bluegill',         'common',    10, 1),
  ('pond_smelt',       'Pond Smelt',       'common',     8, 2),
  ('mossy_carp',       'Mossy Carp',       'common',    12, 3),
  ('sunset_perch',     'Sunset Perch',     'uncommon',  24, 4),
  ('reed_catfish',     'Reed Catfish',     'uncommon',  30, 5),
  ('crystal_trout',    'Crystal Trout',    'rare',      60, 6),
  ('ember_koi',        'Ember Koi',        'rare',      75, 7),
  ('king_of_the_lake', 'King of the Lake', 'legendary', 220, 8);

-- ---- player fish inventory (stacks) + ledgers ------------------------------
create table public.fish_inventory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  species_id text not null references public.fish_definitions (id),
  quantity integer not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  unique (user_id, species_id)
);
alter table public.fish_inventory enable row level security;
create policy fish_inventory_own on public.fish_inventory
  for select to authenticated using (user_id = auth.uid());

create table public.fish_catches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  species_id text not null references public.fish_definitions (id),
  season_id uuid references public.seasons (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.fish_catches enable row level security;
create policy fish_catches_own on public.fish_catches
  for select to authenticated using (user_id = auth.uid());

create table public.fish_sales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  species_id text not null references public.fish_definitions (id),
  quantity integer not null check (quantity > 0),
  coins_earned integer not null check (coins_earned >= 0),
  created_at timestamptz not null default now()
);
alter table public.fish_sales enable row level security;
create policy fish_sales_own on public.fish_sales
  for select to authenticated using (user_id = auth.uid());

-- ---- coins ledger accepts the new reason -----------------------------------
alter table public.coin_events drop constraint coin_events_reason_check;
alter table public.coin_events add constraint coin_events_reason_check
  check (reason = any (array[
    'medal_reward', 'badge_reward', 'checklist_reward', 'seed_received',
    'golden_goose', 'basket_reward', 'basket_contribution', 'garden_reward',
    'debug_adjustment', 'admin_adjustment', 'store_purchase', 'reward_bonus',
    'meeting_reward', 'seed_given', 'lottery_ticket', 'lottery_prize',
    'lottery_refund', 'fish_sale'
  ]));

-- ---- first-time feature popup key ------------------------------------------
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
    'golden_goose', 'lottery', 'fishing_lake'];
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

-- ---- gate: who may fish -----------------------------------------------------
-- fishing_enabled (default true) master switch; fishing_admin_only (default
-- true) restricts the whole module to admins while it's in preview.
create or replace function public.fishing_allowed()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return false; end if;
  if not coalesce(public.game_setting_text('fishing_enabled', 'true')::boolean, true) then
    return false;
  end if;
  if coalesce(public.game_setting_text('fishing_admin_only', 'true')::boolean, true)
     and not public.is_admin() then
    return false;
  end if;
  if exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_banned) then
    return false;
  end if;
  return true;
end;
$$;

-- ---- cast: server-side weighted species roll --------------------------------
create or replace function public.cast_fishing_line()
returns table (species_id text, name text, rarity text, coin_value integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_leg numeric := greatest(least(coalesce(public.game_setting_int('fishing_legendary_chance_percent', 2), 2), 100), 0);
  v_roll numeric := random() * 100;
  v_rarity text;
begin
  if not public.fishing_allowed() then raise exception 'FISHING_LOCKED'; end if;

  -- legendary first (admin-tunable), then fixed cozy weights
  if v_roll < v_leg then
    v_rarity := 'legendary';
  elsif v_roll < v_leg + 13 then
    v_rarity := 'rare';
  elsif v_roll < v_leg + 13 + 30 then
    v_rarity := 'uncommon';
  else
    v_rarity := 'common';
  end if;

  return query
    select f.id, f.name, f.rarity, f.coin_value
    from public.fish_definitions f
    where f.rarity = v_rarity
    order by random()
    limit 1;
end;
$$;

-- ---- record a successful catch ----------------------------------------------
create or replace function public.record_fish_catch(p_species text)
returns integer  -- the new stack quantity
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_season uuid;
  v_qty integer;
begin
  if not public.fishing_allowed() then raise exception 'FISHING_LOCKED'; end if;
  if not exists (select 1 from public.fish_definitions where id = p_species) then
    raise exception 'UNKNOWN_FISH: %', p_species;
  end if;

  select id into v_season from public.seasons where status = 'active' order by ends_at limit 1;

  insert into public.fish_inventory (user_id, species_id, quantity)
  values (v_user, p_species, 1)
  on conflict (user_id, species_id)
  do update set quantity = fish_inventory.quantity + 1, updated_at = now()
  returning quantity into v_qty;

  insert into public.fish_catches (user_id, species_id, season_id)
  values (v_user, p_species, v_season);

  return v_qty;
end;
$$;

-- ---- sell fish for Coins ------------------------------------------------------
create or replace function public.sell_fish(p_species text, p_qty integer)
returns integer  -- coins earned
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_have integer;
  v_value integer;
  v_pct integer := greatest(coalesce(public.game_setting_int('fish_sell_percent', 100), 100), 0);
  v_coins integer;
  v_season uuid;
begin
  if not public.fishing_allowed() then raise exception 'FISHING_LOCKED'; end if;
  if p_qty is null or p_qty < 1 then raise exception 'INVALID_QUANTITY'; end if;

  select coin_value into v_value from public.fish_definitions where id = p_species;
  if v_value is null then raise exception 'UNKNOWN_FISH: %', p_species; end if;

  select quantity into v_have from public.fish_inventory
  where user_id = v_user and species_id = p_species
  for update;
  if v_have is null or v_have < p_qty then raise exception 'NOT_ENOUGH_FISH'; end if;

  update public.fish_inventory
    set quantity = quantity - p_qty, updated_at = now()
    where user_id = v_user and species_id = p_species;
  delete from public.fish_inventory
    where user_id = v_user and species_id = p_species and quantity = 0;

  v_coins := floor(v_value * p_qty * v_pct / 100.0)::integer;

  select id into v_season from public.seasons where status = 'active' order by ends_at limit 1;
  if v_season is not null and v_coins > 0 then
    perform public.grant_coins(v_user, v_season, v_coins, 'fish_sale');
  end if;

  insert into public.fish_sales (user_id, species_id, quantity, coins_earned)
  values (v_user, p_species, p_qty, v_coins);

  return v_coins;
end;
$$;

-- ---- read the fish inventory --------------------------------------------------
create or replace function public.get_fish_inventory()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'species_id', d.id,
    'name', d.name,
    'rarity', d.rarity,
    'coin_value', d.coin_value,
    'quantity', i.quantity) order by d.sort), '[]'::jsonb)
  from public.fish_inventory i
  join public.fish_definitions d on d.id = i.species_id
  where i.user_id = auth.uid() and i.quantity > 0;
$$;

-- ---- settings validator v12: accept the fishing keys ------------------------
-- Same live-def injection pattern as v10/v11 (see the ordering caveat in
-- HANDOFF.md): rebuild update_game_settings from its CURRENT definition so
-- every previously allowed key is inherited.
do $do$
declare
  v_def text;
begin
  select pg_get_functiondef(oid) into v_def
  from pg_proc where proname = 'update_game_settings';
  if v_def is null then raise exception 'update_game_settings missing'; end if;
  if position('fishing_enabled' in v_def) > 0 then
    raise notice 'fishing keys already injected — nothing to do';
    return;
  end if;

  -- booleans (incl. future placeholders — settings only, no mechanics)
  v_def := replace(v_def,
    $$'lottery_show_pot', 'lottery_show_winner_publicly']$$,
    $$'lottery_show_pot', 'lottery_show_winner_publicly',
    'fishing_enabled', 'fishing_admin_only',
    'fishing_seasonal_fish_enabled', 'fishing_weather_enabled',
    'fishing_rod_durability_enabled']$$);

  -- percent-bounded
  v_def := replace(v_def,
    $$'lottery_orchard_bonus_percent']$$,
    $$'lottery_orchard_bonus_percent', 'fishing_legendary_chance_percent']$$);

  -- plain numbers (>= 0)
  v_def := replace(v_def,
    $$'lottery_sales_cutoff_minutes', 'lottery_big_win_threshold']$$,
    $$'lottery_sales_cutoff_minutes', 'lottery_big_win_threshold',
    'fish_sell_percent', 'fish_difficulty_percent']$$);

  if position('fishing_enabled' in v_def) = 0 then
    raise exception 'fishing key injection failed — anchors not found';
  end if;
  execute v_def;
end;
$do$;
