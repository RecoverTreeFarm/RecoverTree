-- ============================================================================
-- Watering v4: flat cost, one stage for every tree
--
-- One "Water plants" action grows EVERY waterable tree by exactly one stage
-- and costs a flat amount (WATER_PER_WATERING), no matter how many trees you
-- have. 1 water action = 1 stage for all → e.g. 30 trees still cost the same
-- as 1 tree. (Previously it could apply multiple stages and spend more.)
-- ============================================================================

create or replace function public.water_my_trees()
returns table (water_left integer, trees_advanced integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  c_water_per_watering constant integer := 10;
  v_user uuid := auth.uid();
  v_farm uuid;
  v_water integer;
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

  -- Enough water AND at least one tree that can still grow?
  if v_water >= c_water_per_watering then
    update public.trees
      set growth_stage = growth_stage + 1
      where farm_id = v_farm and status = 'active' and growth_stage < 5;
    get diagnostics v_advanced = row_count;

    -- Only charge the flat cost if watering actually did something.
    if v_advanced > 0 then
      v_water := v_water - c_water_per_watering;
      update public.farms set water_count = v_water where id = v_farm;
    end if;
  end if;

  return query select v_water, v_advanced;
end;
$$;
