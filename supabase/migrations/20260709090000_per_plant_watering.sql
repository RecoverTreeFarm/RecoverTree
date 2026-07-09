-- ============================================================================
-- Watering v6: every plant drinks its OWN 10 water per stage.
-- 5 plants = 50 water to advance all of them. If there isn't enough water
-- for everyone, the oldest plants drink first (partial watering).
-- ============================================================================

create or replace function public.water_my_trees()
returns table (water_left integer, trees_advanced integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  c_water_per_plant constant integer := 10;
  c_fruit_wait constant interval := interval '4 hours';
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
