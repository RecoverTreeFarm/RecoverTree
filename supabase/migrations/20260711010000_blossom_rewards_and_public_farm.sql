-- ============================================================================
-- Owner-requested (2026-07-11):
--   1. Cherry-blossom harvest now pays 30 Fruits (multiplier 3) + 1 Seed +
--      1 Fertilizer. Fruits still ONLY flow through harvest functions; the
--      seed/fert ride along as a blossom bonus (reason 'blossom_harvest').
--   2. get_public_farm(p_user): lets a visitor's profile page show a PUBLIC
--      farmer's real farm snapshot (tree stages/blossoms + fruit total).
--      Anonymous/hidden/banned farmers return null — same privacy rules as
--      the rest of the app.
-- ============================================================================

-- ---- blossom multiplier 2 -> 3 (10 base * 3 = 30 fruits) ------------------
insert into public.game_settings (key, value_json) values
  ('blossom_fruit_multiplier', to_jsonb(3))
on conflict (key) do update set value_json = excluded.value_json, updated_at = now();

-- ---- allow the blossom-bonus fertilizer reason -----------------------------
alter table public.fertilizer_events drop constraint fertilizer_events_reason_check;
alter table public.fertilizer_events
  add constraint fertilizer_events_reason_check
  check (reason = any (array[
    'medal_reward', 'badge_reward', 'checklist_reward', 'used_on_tree',
    'admin_adjustment', 'basket_contribution', 'basket_reward', 'golden_goose',
    'garden_contribution', 'garden_reward', 'store_purchase', 'store_pet',
    'blossom_harvest'
  ]));

-- ---- harvest_my_trees: blossom bonus seed + fertilizer ---------------------
create or replace function public.harvest_my_trees()
returns table (trees_harvested integer, fruits_earned integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  c_fruits_per_tree constant integer := 10;
  v_mult integer := greatest(public.game_setting_int('blossom_fruit_multiplier', 3), 1);
  v_user uuid := auth.uid();
  v_farm uuid;
  v_season uuid;
  v_count integer := 0;
  v_total integer := 0;
  v_blossoms integer := 0;
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
       case when r.is_blossom then 'Harvested a cherry blossom tree' else 'Harvested a tree' end);

    if r.is_blossom then
      v_blossoms := v_blossoms + 1;
    end if;

    v_count := v_count + 1;
    v_total := v_total + v_amt;
  end loop;

  if v_count > 0 then
    update public.farms
      set fruit_total = fruit_total + v_total,
          seed_count = seed_count + v_blossoms
      where id = v_farm;
  end if;

  -- each blossom also gifts 1 fertilizer (ledgered)
  if v_blossoms > 0 then
    perform public.grant_fertilizer(v_user, v_season, v_blossoms, 'blossom_harvest');
  end if;

  return query select v_count, v_total;
end;
$$;

-- ---- harvest_one_tree: same blossom bonus ----------------------------------
create or replace function public.harvest_one_tree(p_tree uuid)
returns table (trees_harvested integer, fruits_earned integer, was_blossom boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  c_fruits_per_tree constant integer := 10;
  v_mult integer := greatest(public.game_setting_int('blossom_fruit_multiplier', 3), 1);
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
     case when v_blossom then 'Harvested a cherry blossom tree' else 'Harvested a tree' end);

  update public.farms
    set fruit_total = fruit_total + v_amt,
        seed_count = seed_count + (case when v_blossom then 1 else 0 end)
    where id = v_farm;

  if v_blossom then
    perform public.grant_fertilizer(v_user, v_season, 1, 'blossom_harvest');
  end if;

  return query select 1, v_amt, v_blossom;
end;
$$;

-- ---- public farm snapshot for profile pages --------------------------------
-- Only PUBLIC, non-banned farmers are visible (mirrors profile RLS). Returns
-- null rather than raising, so the page can quietly fall back.
create or replace function public.get_public_farm(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not exists (
      select 1 from public.profiles p
      where p.user_id = p_user
        and p.leaderboard_visibility = 'public'
        and not p.is_banned
    ) then null
    else (
      select jsonb_build_object(
        'fruit_total', f.fruit_total,
        'trees', coalesce((
          select jsonb_agg(jsonb_build_object(
            'stage', t.growth_stage,
            'is_blossom', t.is_blossom
          ) order by t.created_at)
          from public.trees t
          where t.farm_id = f.id and t.status = 'active'
        ), '[]'::jsonb)
      )
      from public.farms f
      join public.seasons s on s.id = f.season_id and s.status = 'active'
      where f.user_id = p_user
      limit 1
    )
  end;
$$;
