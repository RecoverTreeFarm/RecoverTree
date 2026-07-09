-- ============================================================================
-- Water & harvest game loop
--
-- New scoring pipeline (per the game design):
--   1. Actions (meetings, seeds, …) award WATER (farms.water_count).
--   2. "Water plants": the farmer waters each plant, advancing its growth
--      stage if there is enough water (WATER_PER_STAGE per advance).
--   3. Growth stages (trees.growth_stage) map to the blueberry sheet:
--        stage 1 → sheet column 2 (sapling)
--        stage 2 → sheet column 3
--        stage 3 → sheet column 4
--        stage 4 → sheet column 5 (full empty bush)
--        stage 5 → sheet column 5 + fruit dots (BEARING)
--   4. "Harvest": bearing trees pay out FRUITS (the score, fruit_events
--      ledger + farms.fruit_total), then reset to stage 1.
-- ============================================================================

-- farms: track water (spendable points earned from participation)
alter table public.farms
  add column water_count integer not null default 0
  constraint farms_water_nonneg check (water_count >= 0);

-- trees: growth stages are 1..5 now (no stage 0 — sheet column 1 is the
-- loose-berries sprite, used as the Fruit icon, not a plant)
update public.trees set growth_stage = 1 where growth_stage < 1;
alter table public.trees alter column growth_stage set default 1;
alter table public.trees drop constraint trees_growth_stage_range;
alter table public.trees
  add constraint trees_growth_stage_range check (growth_stage between 1 and 5);

-- fruit_events: harvests are a fruit source
alter table public.fruit_events drop constraint fruit_events_source_type_check;
alter table public.fruit_events
  add constraint fruit_events_source_type_check
  check (source_type in
    ('meeting_attendance', 'seed_given', 'seed_received', 'streak_bonus',
     'different_hosts_bonus', 'checklist', 'badge', 'medal', 'fertilizer',
     'harvest', 'admin_adjustment'));

-- ensure_my_farm gains water_count in its summary (signature change → drop)
drop function public.ensure_my_farm();

create or replace function public.ensure_my_farm()
returns table (
  season_id uuid,
  season_name text,
  farm_id uuid,
  fruit_total integer,
  fertilizer_count integer,
  water_count integer,
  tree_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_user uuid := auth.uid();
  v_season uuid;
  v_farm uuid;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  update public.seasons
    set status = 'closed'
    where status = 'active' and ends_at <= now();

  v_season := public.ensure_active_season();

  insert into public.farms (user_id, season_id)
  values (v_user, v_season)
  on conflict (user_id, season_id) do nothing;

  select f.id into v_farm
  from public.farms f
  where f.user_id = v_user and f.season_id = v_season;

  if not exists (
    select 1 from public.trees t
    where t.farm_id = v_farm and t.created_reason = 'starter'
  ) then
    insert into public.trees (farm_id, user_id, season_id, created_reason)
    values (v_farm, v_user, v_season, 'starter');
  end if;

  return query
    select
      s.id,
      s.name,
      f.id,
      f.fruit_total,
      f.fertilizer_count,
      f.water_count,
      (select count(*) from public.trees t
        where t.farm_id = f.id and t.status <> 'vanished')
    from public.seasons s
    join public.farms f on f.season_id = s.id and f.user_id = v_user
    where s.id = v_season;
end;
$$;

revoke execute on function public.ensure_my_farm() from public;
revoke execute on function public.ensure_my_farm() from anon;
grant execute on function public.ensure_my_farm() to authenticated;

-- ----------------------------------------------------------------------------
-- water_my_trees(): each click waters every waterable plant once (one stage
-- per plant) while water lasts. Server-side; tune WATER_PER_STAGE here.
-- ----------------------------------------------------------------------------
create or replace function public.water_my_trees()
returns table (water_left integer, trees_advanced integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  c_water_per_stage constant integer := 10;
  v_user uuid := auth.uid();
  v_farm uuid;
  v_water integer;
  v_advanced integer := 0;
  r record;
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

  for r in
    select t.id from public.trees t
    where t.farm_id = v_farm and t.status = 'active' and t.growth_stage < 5
    order by t.created_at
  loop
    exit when v_water < c_water_per_stage;
    update public.trees
      set growth_stage = growth_stage + 1
      where id = r.id;
    v_water := v_water - c_water_per_stage;
    v_advanced := v_advanced + 1;
  end loop;

  update public.farms set water_count = v_water where id = v_farm;

  return query select v_water, v_advanced;
end;
$$;

revoke execute on function public.water_my_trees() from public;
revoke execute on function public.water_my_trees() from anon;
grant execute on function public.water_my_trees() to authenticated;

-- ----------------------------------------------------------------------------
-- harvest_my_trees(): bearing trees pay out Fruits (score) and reset to
-- sapling. Every payout is recorded in the fruit_events ledger.
-- ----------------------------------------------------------------------------
create or replace function public.harvest_my_trees()
returns table (trees_harvested integer, fruits_earned integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  c_fruits_per_tree constant integer := 10;
  v_user uuid := auth.uid();
  v_farm uuid;
  v_season uuid;
  v_count integer := 0;
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

  for r in
    select t.id from public.trees t
    where t.farm_id = v_farm and t.status = 'active' and t.growth_stage = 5
    order by t.created_at
  loop
    update public.trees
      set growth_stage = 1,
          fruits_generated = fruits_generated + c_fruits_per_tree
      where id = r.id;

    insert into public.fruit_events
      (user_id, season_id, amount, source_type, source_id, description)
    values
      (v_user, v_season, c_fruits_per_tree, 'harvest', r.id, 'Harvested a tree');

    v_count := v_count + 1;
  end loop;

  if v_count > 0 then
    update public.farms
      set fruit_total = fruit_total + (v_count * c_fruits_per_tree)
      where id = v_farm;
  end if;

  return query select v_count, v_count * c_fruits_per_tree;
end;
$$;

revoke execute on function public.harvest_my_trees() from public;
revoke execute on function public.harvest_my_trees() from anon;
grant execute on function public.harvest_my_trees() to authenticated;
