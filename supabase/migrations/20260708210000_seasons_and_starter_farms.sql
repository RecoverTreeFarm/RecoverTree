-- ============================================================================
-- Seasons and starter farms
--
-- 1. trees.growth_stage: how far a tree has grown.
--      0..4 = sprite sheet growth frames (0 sapling → 4 full empty bush)
--      5    = bearing fruit (frame 4 with fruit dots layered on top)
--    Watering (earning Fruits) advances the stage server-side in a later
--    phase; after the fruit is collected the tree resets to a sapling.
--
-- 2. ensure_my_farm(): idempotent per-user bootstrap called by the dashboard.
--      - closes any active Season that has ended (month rolled over)
--      - creates the current month's Season if none is active
--      - creates the caller's farm for that Season if missing
--      - plants their one starter tree for that Season if missing
--    All server-side; clients cannot write any of these tables directly.
-- ============================================================================

alter table public.trees
  add column growth_stage integer not null default 0
  constraint trees_growth_stage_range check (growth_stage between 0 and 5);

create or replace function public.ensure_my_farm()
returns table (
  season_id uuid,
  season_name text,
  farm_id uuid,
  fruit_total integer,
  fertilizer_count integer,
  tree_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
-- Our OUT columns (season_id, …) share names with real table columns;
-- resolve any ambiguity in favor of the table column.
#variable_conflict use_column
declare
  v_user uuid := auth.uid();
  v_season uuid;
  v_farm uuid;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  -- Month rolled over? Close the finished Season.
  -- (Medal/badge/ceremony calculations for closed Seasons come in a later phase.)
  update public.seasons
    set status = 'closed'
    where status = 'active' and ends_at <= now();

  -- Make sure the current month's Season exists.
  v_season := public.ensure_active_season();

  -- Make sure the caller has a farm this Season.
  insert into public.farms (user_id, season_id)
  values (v_user, v_season)
  on conflict (user_id, season_id) do nothing;

  select f.id into v_farm
  from public.farms f
  where f.user_id = v_user and f.season_id = v_season;

  -- Every user gets exactly one starter tree per Season.
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
