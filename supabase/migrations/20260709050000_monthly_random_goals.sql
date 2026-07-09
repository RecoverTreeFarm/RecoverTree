-- ============================================================================
-- Monthly checklist goals: a shared, randomly-chosen set per Season.
--
--   - There's a POOL of goals (checklist_definitions where active = true).
--   - Each Season gets 6 goals picked at random into season_checklist_goals.
--     Everyone in that Season shares the same 6; next Season reshuffles.
--   - Completing a goal grants WATER + FERTILIZER (never Fruits), once.
-- ============================================================================

alter table public.checklist_definitions
  add column if not exists water_reward integer not null default 0,
  add column if not exists fertilizer_reward integer not null default 0;

-- The pool of goals we know how to measure (rule_types recompute supports).
update public.checklist_definitions set active = false;
update public.checklist_definitions set active = true,
  water_reward = 10, fertilizer_reward = 1, name = 'Attend 1 meeting' where key = 'attend_1';
update public.checklist_definitions set active = true,
  water_reward = 20, fertilizer_reward = 1, name = 'Attend 3 meetings' where key = 'attend_3';
update public.checklist_definitions set active = true,
  water_reward = 30, fertilizer_reward = 1, name = 'Attend 5 meetings' where key = 'attend_5';
update public.checklist_definitions set active = true,
  water_reward = 50, fertilizer_reward = 2, name = 'Attend 10 meetings' where key = 'attend_10';
update public.checklist_definitions set active = true,
  water_reward = 25, fertilizer_reward = 1, name = 'Meet 3 different hosts' where key = 'hosts_3';
update public.checklist_definitions set active = true,
  water_reward = 40, fertilizer_reward = 2, name = 'Meet 5 different hosts' where key = 'hosts_5';
update public.checklist_definitions set active = true,
  water_reward = 10, fertilizer_reward = 1, name = 'Give a Seed' where key = 'give_seed_1';
update public.checklist_definitions set active = true,
  water_reward = 10, fertilizer_reward = 1, name = 'Receive a Seed' where key = 'receive_seed_1';
update public.checklist_definitions set active = true,
  water_reward = 20, fertilizer_reward = 1, name = 'Attend a meeting this week' where key = 'weekly_meeting';

-- The Season's chosen goals (shared by everyone that Season).
create table public.season_checklist_goals (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id) on delete cascade,
  checklist_definition_id uuid not null references public.checklist_definitions (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint season_checklist_goals_unique unique (season_id, checklist_definition_id)
);

alter table public.season_checklist_goals enable row level security;
create policy "season_checklist_goals: readable by members"
  on public.season_checklist_goals for select to authenticated using (true);

-- Pick 6 random goals for a Season (idempotent).
create or replace function public.pick_season_checklist(p_season uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.season_checklist_goals where season_id = p_season) then
    return;
  end if;
  insert into public.season_checklist_goals (season_id, checklist_definition_id)
  select p_season, d.id
  from public.checklist_definitions d
  where d.active
  order by random()
  limit 6;
end;
$$;

revoke execute on function public.pick_season_checklist(uuid) from public;
revoke execute on function public.pick_season_checklist(uuid) from anon;
revoke execute on function public.pick_season_checklist(uuid) from authenticated;

-- ensure_active_season now also seeds the Season's checklist goals.
create or replace function public.ensure_active_season()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.seasons where status = 'active' limit 1;
  if v_id is null then
    insert into public.seasons (name, starts_at, ends_at, status)
    values (
      trim(to_char(now(), 'FMMonth YYYY')),
      date_trunc('month', now()),
      date_trunc('month', now()) + interval '1 month',
      'active'
    )
    returning id into v_id;
  end if;
  perform public.pick_season_checklist(v_id);
  return v_id;
end;
$$;

revoke execute on function public.ensure_active_season() from public;
revoke execute on function public.ensure_active_season() from anon;
revoke execute on function public.ensure_active_season() from authenticated;

-- recompute over the Season's chosen goals; award water + fertilizer once.
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

  for d in
    select cd.*
    from public.season_checklist_goals sg
    join public.checklist_definitions cd on cd.id = sg.checklist_definition_id
    where sg.season_id = p_season
  loop
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

    if v_completed and v_claimed is null then
      if d.water_reward > 0 then
        update public.farms set water_count = water_count + d.water_reward
          where id = v_farm;
      end if;
      if d.fertilizer_reward > 0 then
        update public.farms set fertilizer_count = fertilizer_count + d.fertilizer_reward
          where id = v_farm;
        insert into public.fertilizer_events (user_id, season_id, amount, reason)
        values (p_user, p_season, d.fertilizer_reward, 'checklist_reward');
      end if;
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

-- get_my_checklist: this Season's shared goals with the caller's progress.
drop function public.get_my_checklist();

create or replace function public.get_my_checklist()
returns table (
  key text,
  name text,
  description text,
  progress integer,
  target integer,
  completed boolean,
  water_reward integer,
  fertilizer_reward integer
)
language sql
stable
security definer
set search_path = public
as $$
  with s as (select id from public.seasons where status = 'active' limit 1)
  select
    d.key,
    d.name,
    d.description,
    coalesce(p.progress_value, 0),
    coalesce((d.config->>'target')::int, 1),
    (p.completed_at is not null),
    d.water_reward,
    d.fertilizer_reward
  from public.season_checklist_goals sg
  join public.checklist_definitions d on d.id = sg.checklist_definition_id
  left join public.user_checklist_progress p
    on p.checklist_definition_id = d.id
   and p.user_id = auth.uid()
   and p.season_id = sg.season_id
  where sg.season_id = (select id from s)
  order by d.sort_order;
$$;

revoke execute on function public.get_my_checklist() from public;
revoke execute on function public.get_my_checklist() from anon;
grant execute on function public.get_my_checklist() to authenticated;

-- Seed the current active Season's goals now.
select public.pick_season_checklist(id) from public.seasons where status = 'active';
