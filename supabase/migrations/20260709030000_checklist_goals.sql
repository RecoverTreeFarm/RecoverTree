-- ============================================================================
-- Monthly checklist goals
--
-- Starting set (6 goals). Completing a goal awards its Fruits ONCE,
-- server-side, with a fruit_events ('checklist') record. Progress is
-- recomputed from source tables (attendance, seeds) so it can never be
-- gamed from the client.
-- ============================================================================

alter table public.checklist_definitions
  add column if not exists sort_order integer not null default 100;

-- Only the six starter goals are active; hide the rest for now.
update public.checklist_definitions set active = false;

update public.checklist_definitions set active = true, sort_order = 1,
  name = 'Attend 1 meeting' where key = 'attend_1';
update public.checklist_definitions set active = true, sort_order = 2,
  name = 'Attend 3 meetings' where key = 'attend_3';
update public.checklist_definitions set active = true, sort_order = 3,
  name = 'Meet 3 different hosts' where key = 'hosts_3';
update public.checklist_definitions set active = true, sort_order = 4,
  name = 'Give a Seed' where key = 'give_seed_1';
update public.checklist_definitions set active = true, sort_order = 5,
  name = 'Receive a Seed' where key = 'receive_seed_1';

insert into public.checklist_definitions
  (key, name, description, fruit_reward, rule_type, config, active, sort_order)
values
  ('weekly_meeting', 'Attend a meeting this week',
   'Attend at least one meeting this week.', 10, 'weekly_meeting',
   '{"target": 1}', true, 6)
on conflict (key) do update set
  name = excluded.name, description = excluded.description,
  fruit_reward = excluded.fruit_reward, rule_type = excluded.rule_type,
  config = excluded.config, active = true, sort_order = excluded.sort_order;

-- ----------------------------------------------------------------------------
-- recompute_checklists: refresh progress from source tables and award any
-- newly-completed goal exactly once. Internal (called by definer functions).
-- ----------------------------------------------------------------------------
create or replace function public.recompute_checklists(p_user uuid, p_season uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_farm uuid;
  d record;
  v_val integer;
  v_target integer;
  v_completed boolean;
  v_claimed timestamptz;
begin
  select id into v_farm from public.farms
    where user_id = p_user and season_id = p_season;
  if v_farm is null then
    return;
  end if;

  for d in select * from public.checklist_definitions where active loop
    v_target := coalesce((d.config->>'target')::int, 1);
    v_val := case d.rule_type
      when 'meeting_count' then
        (select count(*) from public.meeting_attendance
          where attendee_user_id = p_user and season_id = p_season)
      when 'distinct_hosts' then
        (select count(distinct host_user_id) from public.meeting_attendance
          where attendee_user_id = p_user and season_id = p_season)
      when 'seed_given_count' then
        (select count(*) from public.seed_events
          where giver_user_id = p_user and season_id = p_season)
      when 'seed_received_count' then
        (select count(*) from public.seed_events
          where receiver_user_id = p_user and season_id = p_season)
      when 'weekly_meeting' then
        (select count(*) from public.meeting_attendance
          where attendee_user_id = p_user and season_id = p_season
            and attended_at >= date_trunc('week', now()))
      else 0
    end;
    v_completed := v_val >= v_target;

    insert into public.user_checklist_progress
      (user_id, season_id, checklist_definition_id, progress_value, completed_at)
    values
      (p_user, p_season, d.id, v_val,
       case when v_completed then now() else null end)
    on conflict (user_id, season_id, checklist_definition_id) do update
      set progress_value = excluded.progress_value,
          completed_at = coalesce(
            public.user_checklist_progress.completed_at, excluded.completed_at);

    select reward_claimed_at into v_claimed
    from public.user_checklist_progress
    where user_id = p_user and season_id = p_season
      and checklist_definition_id = d.id;

    if v_completed and v_claimed is null and d.fruit_reward > 0 then
      update public.farms
        set fruit_total = fruit_total + d.fruit_reward where id = v_farm;
      insert into public.fruit_events
        (user_id, season_id, amount, source_type, source_id, description)
      values
        (p_user, p_season, d.fruit_reward, 'checklist', d.id,
         'Checklist: ' || d.name);
      update public.user_checklist_progress set reward_claimed_at = now()
        where user_id = p_user and season_id = p_season
          and checklist_definition_id = d.id;
    end if;
  end loop;
end;
$$;

revoke execute on function public.recompute_checklists(uuid, uuid) from public;
revoke execute on function public.recompute_checklists(uuid, uuid) from anon;
revoke execute on function public.recompute_checklists(uuid, uuid) from authenticated;

-- ----------------------------------------------------------------------------
-- get_my_checklist: read the caller's checklist (pure read; ensure_my_farm
-- does the recompute/award on dashboard load).
-- ----------------------------------------------------------------------------
create or replace function public.get_my_checklist()
returns table (
  key text,
  name text,
  description text,
  progress integer,
  target integer,
  completed boolean,
  fruit_reward integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    d.key,
    d.name,
    d.description,
    coalesce(p.progress_value, 0),
    coalesce((d.config->>'target')::int, 1),
    (p.completed_at is not null),
    d.fruit_reward
  from public.checklist_definitions d
  left join public.user_checklist_progress p
    on p.checklist_definition_id = d.id
   and p.user_id = auth.uid()
   and p.season_id = (select id from public.seasons where status = 'active' limit 1)
  where d.active
  order by d.sort_order;
$$;

revoke execute on function public.get_my_checklist() from public;
revoke execute on function public.get_my_checklist() from anon;
grant execute on function public.get_my_checklist() to authenticated;

-- ----------------------------------------------------------------------------
-- ensure_my_farm: same as before, plus a checklist recompute so goals award
-- as soon as the dashboard loads and the returned fruit_total stays fresh.
-- ----------------------------------------------------------------------------
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

  update public.trees
    set growth_stage = 5, fruits_ready_at = null
    where farm_id = v_farm and status = 'active'
      and growth_stage = 4 and fruits_ready_at <= now();

  perform public.recompute_checklists(v_user, v_season);

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
