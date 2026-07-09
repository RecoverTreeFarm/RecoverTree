-- ============================================================================
-- Seeds system + watering rework
--
-- Seeds (daily encouragement):
--  - 1 Seed per giver per day (unique constraint + friendly check)
--  - cannot Seed yourself; banned users cannot give
--  - giving  → giver earns 10 water
--  - receiving → receiver gains a PLANTABLE seed (farms.seed_count);
--    planting it adds a tree, doubling their harvest
--
-- Watering rework (per the design):
--  - one watering action costs 10 water TOTAL and waters ALL waterable
--    trees one stage ("if there's 5 trees and we have 10 water, each tree
--    gets 10 water") — extra trees don't need extra water.
-- ============================================================================

alter table public.farms
  add column seed_count integer not null default 0
  constraint farms_seed_count_nonneg check (seed_count >= 0);

-- ----------------------------------------------------------------------------
-- water_my_trees v2: 10 water per click waters the whole plot one stage.
-- ----------------------------------------------------------------------------
create or replace function public.water_my_trees()
returns table (water_left integer, trees_advanced integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  c_water_per_use constant integer := 10;
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

  if v_water >= c_water_per_use then
    update public.trees
      set growth_stage = growth_stage + 1
      where farm_id = v_farm and status = 'active' and growth_stage < 5;
    get diagnostics v_advanced = row_count;

    if v_advanced > 0 then
      v_water := v_water - c_water_per_use;
      update public.farms set water_count = v_water where id = v_farm;
    end if;
  end if;

  return query select v_water, v_advanced;
end;
$$;

-- ----------------------------------------------------------------------------
-- give_seed: today's Seed of encouragement.
-- ----------------------------------------------------------------------------
create or replace function public.give_seed(p_receiver_user_id uuid)
returns table (receiver_username text, water_earned integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  c_giver_water constant integer := 10;
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

  -- Giver: +10 water. Receiver: +1 plantable seed.
  update public.farms set water_count = water_count + c_giver_water
    where id = v_giver_farm;
  update public.farms set seed_count = seed_count + 1
    where id = v_receiver_farm;

  return query select v_receiver.username, c_giver_water;
exception
  when unique_violation then
    raise exception 'ALREADY_SENT_TODAY';
end;
$$;

revoke execute on function public.give_seed(uuid) from public;
revoke execute on function public.give_seed(uuid) from anon;
grant execute on function public.give_seed(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- plant_seed: turn a received seed into a new tree (doubles the harvest).
-- ----------------------------------------------------------------------------
create or replace function public.plant_seed()
returns table (tree_count bigint, seeds_left integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_farm uuid;
  v_season uuid;
  v_seeds integer;
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select f.id, f.season_id, f.seed_count into v_farm, v_season, v_seeds
  from public.farms f
  join public.seasons s on s.id = f.season_id and s.status = 'active'
  where f.user_id = v_user
  for update of f;

  if v_farm is null then
    raise exception 'No farm this Season';
  end if;
  if v_seeds < 1 then
    raise exception 'NO_SEEDS';
  end if;

  update public.farms set seed_count = seed_count - 1 where id = v_farm;

  insert into public.trees (farm_id, user_id, season_id, created_reason)
  values (v_farm, v_user, v_season, 'seed_received');

  return query
    select
      (select count(*) from public.trees t
        where t.farm_id = v_farm and t.status <> 'vanished'),
      v_seeds - 1;
end;
$$;

revoke execute on function public.plant_seed() from public;
revoke execute on function public.plant_seed() from anon;
grant execute on function public.plant_seed() to authenticated;

-- ensure_my_farm summary gains seed_count (signature change → drop first)
drop function public.ensure_my_farm();

create or replace function public.ensure_my_farm()
returns table (
  season_id uuid,
  season_name text,
  farm_id uuid,
  fruit_total integer,
  fertilizer_count integer,
  water_count integer,
  seed_count integer,
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
      f.seed_count,
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
