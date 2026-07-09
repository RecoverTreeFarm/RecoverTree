-- ============================================================================
-- 1. Fertilizer v2: using fertilizer RIPENS the waiting tree (stage 5,
--    bearing fruit) but does NOT harvest it — the player clicks Harvest
--    themselves. No Fruits are awarded here, so no fruit_events row.
-- 2. get_season_leaderboard(p_season): top 10 for any season (used by the
--    ceremony), Private-Mode-safe like get_leaderboard.
-- ============================================================================

drop function public.use_fertilizer();

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

  select t.id into v_tree
  from public.trees t
  where t.farm_id = v_farm and t.status = 'active'
    and t.growth_stage = 4 and t.fruits_ready_at > now()
  order by t.created_at
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

revoke execute on function public.use_fertilizer() from public;
revoke execute on function public.use_fertilizer() from anon;
grant execute on function public.use_fertilizer() to authenticated;

-- Season leaderboard (top 10) for the ceremony.
create or replace function public.get_season_leaderboard(p_season uuid)
returns table (
  rank bigint,
  username text,
  display_name text,
  avatar_config jsonb,
  fruit_total integer,
  visibility text,
  is_self boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with ranked as (
    select
      f.user_id,
      f.fruit_total,
      p.username,
      p.display_name,
      p.avatar_config,
      p.leaderboard_visibility,
      rank() over (order by f.fruit_total desc) as rnk
    from public.farms f
    join public.profiles p on p.user_id = f.user_id
    where f.season_id = p_season
      and not p.is_banned
      and (p.leaderboard_visibility in ('public', 'anonymous')
           or f.user_id = auth.uid())
  )
  select
    rnk,
    case when leaderboard_visibility = 'public' or user_id = auth.uid()
         then username else null end,
    case when leaderboard_visibility = 'public' or user_id = auth.uid()
         then display_name else null end,
    case when leaderboard_visibility = 'public' or user_id = auth.uid()
         then avatar_config else '{}'::jsonb end,
    fruit_total,
    leaderboard_visibility,
    user_id = auth.uid()
  from ranked
  order by rnk, username nulls last
  limit 10;
$$;

revoke execute on function public.get_season_leaderboard(uuid) from public;
revoke execute on function public.get_season_leaderboard(uuid) from anon;
grant execute on function public.get_season_leaderboard(uuid) to authenticated;
