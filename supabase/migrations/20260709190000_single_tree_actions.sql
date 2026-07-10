-- ============================================================================
-- Single-tree actions: water / fertilize / harvest ONE chosen tree.
--
-- WHY
-- Tapping a plant used to run the whole-plot RPCs (water_my_trees /
-- harvest_my_trees), so one tap watered every affordable tree. These three
-- functions act on exactly one tree, chosen by the player. The bulk RPCs are
-- untouched — they remain the "apply to everything" path used by the top
-- inventory bar and the backpack.
--
-- SAFETY
-- Each function is SECURITY DEFINER and verifies the target tree belongs to
-- the CALLER's farm in the CURRENTLY ACTIVE season before doing anything, so
-- a hand-crafted request can't touch someone else's orchard. Rules mirror the
-- bulk versions exactly:
--   * water costs 10 per stage; reaching stage 4 starts the 4h fruit timer
--     and rolls the rare cherry-blossom (blossom_chance_percent)
--   * fertilizer only works on a WAITING tree (stage 4, timer not finished)
--   * harvest only works on a BEARING tree (stage 5)
--
-- ECONOMY unchanged: Fruits are created ONLY by harvest_one_tree (harvesting
-- a tree), exactly like harvest_my_trees, including the blossom 2x multiplier.
-- Nothing here grants Fruits as a reward.
-- ============================================================================


-- Resolve + lock the caller's active-season farm and validate tree ownership.
-- Returns the farm id; raises if the tree isn't the caller's.
create or replace function public.assert_own_tree(p_tree uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_farm uuid;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  select f.id into v_farm
  from public.farms f
  join public.seasons s on s.id = f.season_id and s.status = 'active'
  where f.user_id = v_user
  for update of f;

  if v_farm is null then raise exception 'No farm this Season'; end if;

  if not exists (
    select 1 from public.trees t
    where t.id = p_tree and t.farm_id = v_farm and t.status = 'active'
  ) then
    raise exception 'TREE_NOT_FOUND';
  end if;

  return v_farm;
end;
$$;

revoke execute on function public.assert_own_tree(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Water ONE tree by a single growth stage (10 water).
-- ----------------------------------------------------------------------------
create or replace function public.water_one_tree(p_tree uuid)
returns table (water_left integer, new_stage integer, became_blossom boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  c_water_per_plant constant integer := 10;
  c_fruit_wait constant interval := interval '4 hours';
  v_chance integer := least(greatest(public.game_setting_int('blossom_chance_percent', 15), 0), 100);
  v_farm uuid := public.assert_own_tree(p_tree);
  v_water integer;
  v_stage integer;
  v_blossom boolean := false;
begin
  select water_count into v_water from public.farms where id = v_farm;

  -- settle a finished timer on this tree first
  update public.trees
    set growth_stage = 5, fruits_ready_at = null
    where id = p_tree and growth_stage = 4 and fruits_ready_at <= now();

  select growth_stage into v_stage from public.trees where id = p_tree;
  if v_stage >= 4 then raise exception 'TREE_NOT_THIRSTY'; end if;
  if v_water < c_water_per_plant then raise exception 'NOT_ENOUGH_WATER'; end if;

  v_stage := v_stage + 1;
  if v_stage = 4 then
    v_blossom := (random() * 100 < v_chance);
  end if;

  update public.trees
    set growth_stage = v_stage,
        fruits_ready_at = case when v_stage = 4 then now() + c_fruit_wait else fruits_ready_at end,
        is_blossom = case when v_stage = 4 then v_blossom else is_blossom end
    where id = p_tree;

  v_water := v_water - c_water_per_plant;
  update public.farms set water_count = v_water where id = v_farm;

  return query select v_water, v_stage, v_blossom;
end;
$$;

revoke execute on function public.water_one_tree(uuid) from public, anon;
grant execute on function public.water_one_tree(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Fertilize ONE waiting tree (ripens it now). No Fruits — the player still
-- has to harvest it.
-- ----------------------------------------------------------------------------
create or replace function public.fertilize_one_tree(p_tree uuid)
returns table (fertilizer_left integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_farm uuid := public.assert_own_tree(p_tree);
  v_season uuid;
  v_fert integer;
  v_user uuid := auth.uid();
begin
  select season_id, fertilizer_count into v_season, v_fert
    from public.farms where id = v_farm;

  -- settle a finished timer first (that tree is bearing, not waiting)
  update public.trees
    set growth_stage = 5, fruits_ready_at = null
    where id = p_tree and growth_stage = 4 and fruits_ready_at <= now();

  if v_fert < 1 then raise exception 'NO_FERTILIZER'; end if;

  if not exists (
    select 1 from public.trees
    where id = p_tree and growth_stage = 4 and fruits_ready_at > now()
  ) then
    raise exception 'NO_WAITING_TREE';
  end if;

  update public.trees
    set growth_stage = 5, fruits_ready_at = null
    where id = p_tree;

  update public.farms set fertilizer_count = fertilizer_count - 1 where id = v_farm;

  insert into public.fertilizer_events (user_id, season_id, amount, reason)
  values (v_user, v_season, -1, 'used_on_tree');

  return query select v_fert - 1;
end;
$$;

revoke execute on function public.fertilize_one_tree(uuid) from public, anon;
grant execute on function public.fertilize_one_tree(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Harvest ONE bearing tree. THE ONLY source of Fruits here (2x for a
-- cherry-blossom tree), mirroring harvest_my_trees.
-- ----------------------------------------------------------------------------
create or replace function public.harvest_one_tree(p_tree uuid)
returns table (trees_harvested integer, fruits_earned integer, was_blossom boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  c_fruits_per_tree constant integer := 10;
  v_mult integer := greatest(public.game_setting_int('blossom_fruit_multiplier', 2), 1);
  v_farm uuid := public.assert_own_tree(p_tree);
  v_season uuid;
  v_user uuid := auth.uid();
  v_blossom boolean;
  v_amt integer;
begin
  select season_id into v_season from public.farms where id = v_farm;

  -- settle a finished timer so a just-ripened tree can be harvested
  update public.trees
    set growth_stage = 5, fruits_ready_at = null
    where id = p_tree and growth_stage = 4 and fruits_ready_at <= now();

  select is_blossom into v_blossom
    from public.trees where id = p_tree and growth_stage = 5;
  if v_blossom is null then raise exception 'TREE_NOT_READY'; end if;

  v_amt := c_fruits_per_tree * (case when v_blossom then v_mult else 1 end);

  update public.trees
    set growth_stage = 1,
        fruits_ready_at = null,
        is_blossom = false,
        fruits_generated = fruits_generated + v_amt
    where id = p_tree;

  insert into public.fruit_events
    (user_id, season_id, amount, source_type, source_id, description)
  values
    (v_user, v_season, v_amt, 'harvest', p_tree,
     case when v_blossom then 'Harvested a blossom tree (2x)' else 'Harvested a tree' end);

  update public.farms set fruit_total = fruit_total + v_amt where id = v_farm;

  return query select 1, v_amt, v_blossom;
end;
$$;

revoke execute on function public.harvest_one_tree(uuid) from public, anon;
grant execute on function public.harvest_one_tree(uuid) to authenticated;
