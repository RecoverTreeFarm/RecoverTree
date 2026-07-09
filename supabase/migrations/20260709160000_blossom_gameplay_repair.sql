-- ============================================================================
-- Blossom-tree gameplay repair (idempotent).
--
-- WHY THIS EXISTS
-- Migrations 130000, 140000 and 150000 each recreate `update_game_settings`,
-- with each version adding more allowed keys. On the live database, 150000
-- (Golden Goose) had been applied while 130000 (blossom trees) and 140000
-- (house names + fertilizer priority) had been skipped. Re-running those two
-- files as-is would have DOWNGRADED `update_game_settings` and silently
-- dropped the `goose_enabled` key.
--
-- So this migration re-applies ONLY the blossom *gameplay* pieces and never
-- touches `update_game_settings`:
--   * trees.is_blossom column
--   * water_my_trees   — rolls the blossom chance when a tree finishes growing
--   * harvest_my_trees — blossom trees pay 2x, then revert to green
--   * use_fertilizer   — ripens a waiting blossom tree first
--
-- Safe to run on a fresh database applied in order (it re-defines the same
-- functions 130000/140000 already created, and the column add is guarded).
--
-- ECONOMY unchanged: the 2x is a HARVEST multiplier. Fruits still come only
-- from harvesting trees; direct rewards remain Seed / Water / Fertilizer.
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
-- 2. use_fertilizer: pink blossom waiting trees ripen FIRST (they pay 2x on
--    harvest), then the oldest waiting tree. Everything else unchanged.
-- ----------------------------------------------------------------------------
create or replace function public.use_fertilizer()
returns table (fertilizer_left integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_farm uuid;
  v_season uuid;
  v_fert integer;
  v_tree uuid;
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select f.id, f.season_id, f.fertilizer_count into v_farm, v_season, v_fert
  from public.farms f
  join public.seasons s on s.id = f.season_id and s.status = 'active'
  where f.user_id = v_user
  for update of f;

  if v_farm is null then
    raise exception 'No farm this Season';
  end if;

  -- settle finished timers first (those trees are bearing, not waiting)
  update public.trees
    set growth_stage = 5, fruits_ready_at = null
    where farm_id = v_farm and status = 'active'
      and growth_stage = 4 and fruits_ready_at <= now();

  if v_fert < 1 then
    raise exception 'NO_FERTILIZER';
  end if;

  -- blossom trees first (2x harvest), then oldest waiting
  select t.id into v_tree
  from public.trees t
  where t.farm_id = v_farm and t.status = 'active'
    and t.growth_stage = 4 and t.fruits_ready_at > now()
  order by t.is_blossom desc, t.created_at
  limit 1;

  if v_tree is null then
    raise exception 'NO_WAITING_TREE';
  end if;

  -- ripen: the tree bears fruit NOW; harvesting stays the player's moment
  update public.trees
    set growth_stage = 5, fruits_ready_at = null
    where id = v_tree;

  update public.farms
    set fertilizer_count = fertilizer_count - 1
    where id = v_farm;

  insert into public.fertilizer_events (user_id, season_id, amount, reason)
  values (v_user, v_season, -1, 'used_on_tree');

  return query select v_fert - 1;
end;
$$;

revoke execute on function public.use_fertilizer() from public, anon;
grant execute on function public.use_fertilizer() to authenticated;
