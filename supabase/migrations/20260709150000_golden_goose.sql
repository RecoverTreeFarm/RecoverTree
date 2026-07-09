-- ============================================================================
-- Golden Goose Keeper — a trust-based community event.
--
-- A random eligible "Keeper" is chosen; the Golden Goose visits their farm.
-- The Keeper asks a supportive question OUT in the group's Signal/WhatsApp
-- chat (the app never shows the question). Members submit answers in-app
-- during a 24h Answer Collection phase. During the next 24h Selection phase
-- the Keeper reads the ANONYMOUS answers and picks a favorite; that answer's
-- author gets a Golden Goose Egg (1 seed + 1 fertilizer + 10 water, all
-- configurable) and the Keeper gets 1 fertilizer for completing it in time.
-- If the Keeper never picks, the app auto-selects a random valid answer and
-- the Keeper takes a short (2-month) break from being selected.
--
-- ECONOMY: rewards are only water/seed/fertilizer — never Fruits. All writes
-- go through SECURITY DEFINER functions; reward tables aren't client-writable.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Profile fields: opt-in + a soft exclusion window.
-- ----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists golden_goose_opt_in boolean not null default true,
  add column if not exists golden_goose_excluded_until timestamptz;

-- Keep the exclusion window server-controlled (users may toggle opt-in, but
-- must not clear their own exclusion). Extends the existing guard trigger.
create or replace function public.protect_privileged_profile_columns()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.role := 'member';
      new.is_banned := false;
      new.banned_reason := null;
      new.golden_goose_excluded_until := null;
    elsif tg_op = 'UPDATE' then
      if new.role is distinct from old.role
         or new.is_banned is distinct from old.is_banned
         or new.banned_reason is distinct from old.banned_reason then
        raise exception 'You cannot change role or ban status.';
      end if;
      if new.golden_goose_excluded_until is distinct from old.golden_goose_excluded_until then
        raise exception 'You cannot change the Golden Goose exclusion window.';
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- Fertilizer that flows through the Golden Goose hits the fertilizer ledger.
alter table public.fertilizer_events drop constraint fertilizer_events_reason_check;
alter table public.fertilizer_events
  add constraint fertilizer_events_reason_check
  check (reason in
    ('medal_reward', 'badge_reward', 'checklist_reward', 'used_on_tree',
     'admin_adjustment', 'basket_contribution', 'basket_reward', 'golden_goose'));

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------
create table public.golden_goose_assignments (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id) on delete cascade,
  assigned_date date not null,
  keeper_user_id uuid references auth.users (id) on delete set null,
  status text not null default 'answer_collection'
    check (status in ('answer_collection', 'selection_open', 'completed',
                      'auto_completed', 'expired_no_submissions', 'passed', 'cancelled')),
  selected_submission_id uuid,
  auto_selected boolean not null default false,
  assigned_at timestamptz not null default now(),
  answer_collection_ends_at timestamptz not null,
  selection_opens_at timestamptz not null,
  selection_deadline_at timestamptz not null,
  completed_at timestamptz,
  expired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Only one event may be "in play" at a time.
create unique index golden_goose_one_active
  on public.golden_goose_assignments (season_id)
  where status in ('answer_collection', 'selection_open');
create index golden_goose_assignments_date_idx
  on public.golden_goose_assignments (assigned_date desc);

create trigger golden_goose_assignments_set_updated_at
  before update on public.golden_goose_assignments
  for each row execute function public.set_updated_at();

create table public.golden_goose_submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.golden_goose_assignments (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  answer_text text not null,
  is_deleted boolean not null default false,
  selected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint golden_goose_submissions_once unique (assignment_id, user_id)
);
create index golden_goose_submissions_assignment_idx
  on public.golden_goose_submissions (assignment_id);

create trigger golden_goose_submissions_set_updated_at
  before update on public.golden_goose_submissions
  for each row execute function public.set_updated_at();

alter table public.golden_goose_assignments
  add constraint golden_goose_selected_fk
  foreign key (selected_submission_id)
  references public.golden_goose_submissions (id) on delete set null;

create table public.golden_goose_rewards (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.golden_goose_assignments (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  reward_type text not null check (reward_type in ('seed', 'water', 'fertilizer')),
  amount integer not null check (amount > 0),
  reason text not null check (reason in
    ('golden_goose_egg_seed', 'golden_goose_egg_water', 'golden_goose_egg_fertilizer',
     'keeper_completion_fertilizer')),
  created_at timestamptz not null default now()
);
create index golden_goose_rewards_user_idx
  on public.golden_goose_rewards (user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- RLS: assignments are readable (no secrets in them); a member only sees their
-- OWN submission/rewards directly. The Keeper reads ANONYMOUS answers through
-- get_golden_goose_state() (SECURITY DEFINER — returns no user_ids).
-- ----------------------------------------------------------------------------
alter table public.golden_goose_assignments enable row level security;
alter table public.golden_goose_submissions enable row level security;
alter table public.golden_goose_rewards enable row level security;

create policy "goose_assignments: readable by members"
  on public.golden_goose_assignments for select to authenticated using (true);
create policy "goose_submissions: own or admin"
  on public.golden_goose_submissions for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy "goose_rewards: own or admin"
  on public.golden_goose_rewards for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ----------------------------------------------------------------------------
-- Schedule: is a given date a Golden Goose day? (deterministic per week)
-- ----------------------------------------------------------------------------
create or replace function public.goose_is_goose_day(p_date date)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_enabled boolean := public.game_setting_text('goose_enabled', 'true')::boolean;
  v_mode text := public.game_setting_text('goose_schedule_mode', 'random');
  v_dpw integer := public.game_setting_int('goose_random_days_per_week', 7);
  v_enabled_days jsonb;
  v_dow integer := extract(dow from p_date)::integer;
  v_week_start date := date_trunc('week', p_date::timestamptz)::date;
  v_rank integer;
begin
  if not v_enabled then return false; end if;

  if v_mode = 'specific' then
    select value_json into v_enabled_days from public.game_settings where key = 'goose_enabled_days';
    if v_enabled_days is null or jsonb_typeof(v_enabled_days) <> 'array' then return false; end if;
    return exists (select 1 from jsonb_array_elements(v_enabled_days) d where (d #>> '{}')::integer = v_dow);
  end if;

  if v_dpw <= 0 then return false; end if;
  if v_dpw >= 7 then return true; end if;
  select rnk into v_rank from (
    select d as dow, row_number() over (order by md5(v_week_start::text || ':g:' || d::text)) as rnk
    from generate_series(0, 6) d
  ) ranked where dow = v_dow;
  return v_rank <= v_dpw;
end;
$$;

revoke execute on function public.goose_is_goose_day(date) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Eligible Keepers (public, opted-in, not banned/excluded, farm this season),
-- with their prior turn count for the fair "fewest turns" lottery.
-- ----------------------------------------------------------------------------
create or replace function public.goose_eligible_keepers(p_season uuid, p_exclude uuid[])
returns table (user_id uuid, turns integer)
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id,
    (select count(*)::integer from public.golden_goose_assignments a
       where a.keeper_user_id = p.user_id and a.status not in ('passed', 'cancelled')) as turns
  from public.profiles p
  join public.farms f on f.user_id = p.user_id and f.season_id = p_season
  where not p.is_banned
    and coalesce(p.golden_goose_opt_in, true)
    and (p.golden_goose_excluded_until is null or p.golden_goose_excluded_until < now())
    and p.leaderboard_visibility = 'public'
    and not (p.user_id = any(coalesce(p_exclude, array[]::uuid[])));
$$;

revoke execute on function public.goose_eligible_keepers(uuid, uuid[]) from public, anon, authenticated;

-- Fair pick: the eligible user(s) with the FEWEST prior turns, random tiebreak.
create or replace function public.goose_pick_keeper(p_season uuid, p_exclude uuid[])
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select user_id from public.goose_eligible_keepers(p_season, p_exclude)
  order by turns asc, random()
  limit 1;
$$;

revoke execute on function public.goose_pick_keeper(uuid, uuid[]) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Credit a farm (water/seed/fertilizer only — never Fruits) + record it.
-- ----------------------------------------------------------------------------
create or replace function public.goose_credit(
  p_assignment uuid, p_user uuid, p_season uuid, p_type text, p_amount integer, p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_amount is null or p_amount <= 0 then return; end if;
  insert into public.farms (user_id, season_id) values (p_user, p_season)
    on conflict (user_id, season_id) do nothing;

  if p_type = 'water' then
    update public.farms set water_count = water_count + p_amount
      where user_id = p_user and season_id = p_season;
  elsif p_type = 'seed' then
    update public.farms set seed_count = seed_count + p_amount
      where user_id = p_user and season_id = p_season;
  elsif p_type = 'fertilizer' then
    update public.farms set fertilizer_count = fertilizer_count + p_amount
      where user_id = p_user and season_id = p_season;
    insert into public.fertilizer_events (user_id, season_id, amount, reason)
      values (p_user, p_season, p_amount, 'golden_goose');
  else
    raise exception 'INVALID_REWARD_TYPE: %', p_type;
  end if;

  insert into public.golden_goose_rewards (assignment_id, user_id, reward_type, amount, reason)
    values (p_assignment, p_user, p_type, p_amount, p_reason);
end;
$$;

revoke execute on function public.goose_credit(uuid, uuid, uuid, text, integer, text) from public, anon, authenticated;

-- The Golden Goose Egg: seed + fertilizer + water, amounts from settings.
create or replace function public.goose_award_egg(p_assignment uuid, p_user uuid, p_season uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.goose_credit(p_assignment, p_user, p_season, 'seed',
    public.game_setting_int('goose_egg_seed_amount', 1), 'golden_goose_egg_seed');
  perform public.goose_credit(p_assignment, p_user, p_season, 'water',
    public.game_setting_int('goose_egg_water_amount', 10), 'golden_goose_egg_water');
  perform public.goose_credit(p_assignment, p_user, p_season, 'fertilizer',
    public.game_setting_int('goose_egg_fertilizer_amount', 1), 'golden_goose_egg_fertilizer');
end;
$$;

revoke execute on function public.goose_award_egg(uuid, uuid, uuid) from public, anon, authenticated;

-- Exclude a Keeper from selection for the configured number of months.
create or replace function public.goose_exclude_keeper(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_months integer := greatest(public.game_setting_int('goose_exclusion_months_on_missed_selection', 2), 0);
begin
  if p_user is null then return; end if;
  update public.profiles
    set golden_goose_excluded_until = now() + make_interval(months => v_months)
    where user_id = p_user;
end;
$$;

revoke execute on function public.goose_exclude_keeper(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- auto_close_golden_goose_assignments: close overdue events (idempotent).
-- ----------------------------------------------------------------------------
create or replace function public.auto_close_golden_goose_assignments()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_sub record;
  v_auto boolean := public.game_setting_text('goose_auto_select_enabled', 'true')::boolean;
begin
  for c in
    select * from public.golden_goose_assignments
    where status in ('answer_collection', 'selection_open')
      and now() >= selection_deadline_at
    for update
  loop
    -- a valid submission: not deleted, author still active
    select s.* into v_sub
    from public.golden_goose_submissions s
    join public.profiles p on p.user_id = s.user_id and not p.is_banned
    where s.assignment_id = c.id and not s.is_deleted
    order by random()
    limit 1;

    if v_auto and v_sub.id is not null then
      perform public.goose_award_egg(c.id, v_sub.user_id, c.season_id);
      update public.golden_goose_submissions set selected_at = now() where id = v_sub.id;
      update public.golden_goose_assignments
        set status = 'auto_completed', auto_selected = true,
            selected_submission_id = v_sub.id, completed_at = now(), expired_at = now()
        where id = c.id;
    else
      update public.golden_goose_assignments
        set status = 'expired_no_submissions', expired_at = now()
        where id = c.id;
    end if;

    -- the Keeper takes a short break from being selected again
    perform public.goose_exclude_keeper(c.keeper_user_id);
  end loop;
end;
$$;

revoke execute on function public.auto_close_golden_goose_assignments() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- create_or_get_current_golden_goose: resolve overdue events, advance phase,
-- and start a new one on a Goose day if none is in play.
-- ----------------------------------------------------------------------------
create or replace function public.create_or_get_current_golden_goose()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active uuid;
  v_today uuid;
  v_season uuid;
  v_keeper uuid;
  v_new uuid;
  v_ac integer := greatest(public.game_setting_int('goose_answer_collection_hours', 24), 1);
  v_total integer := greatest(public.game_setting_int('goose_total_cycle_hours', 48), 2);
begin
  perform public.auto_close_golden_goose_assignments();

  -- advance answer_collection → selection_open once the window passes
  update public.golden_goose_assignments
    set status = 'selection_open'
    where status = 'answer_collection'
      and now() >= selection_opens_at and now() < selection_deadline_at;

  select id into v_active from public.golden_goose_assignments
    where status in ('answer_collection', 'selection_open')
    order by created_at limit 1;
  if v_active is not null then
    return v_active;
  end if;

  -- already ran (and ended) today? don't restart the same day
  select id into v_today from public.golden_goose_assignments
    where assigned_date = current_date order by created_at desc limit 1;
  if v_today is not null then
    return v_today;
  end if;

  if not public.goose_is_goose_day(current_date) then
    return null;
  end if;

  select id into v_season from public.seasons where status = 'active' order by ends_at limit 1;
  if v_season is null then
    return null;
  end if;

  v_keeper := public.goose_pick_keeper(v_season, array[]::uuid[]);
  if v_keeper is null then
    return null; -- nobody eligible yet
  end if;

  begin
    insert into public.golden_goose_assignments
      (season_id, assigned_date, keeper_user_id, status, assigned_at,
       answer_collection_ends_at, selection_opens_at, selection_deadline_at)
    values
      (v_season, current_date, v_keeper, 'answer_collection', now(),
       now() + make_interval(hours => v_ac),
       now() + make_interval(hours => v_ac),
       now() + make_interval(hours => v_total))
    returning id into v_new;
  exception
    when unique_violation then
      select id into v_new from public.golden_goose_assignments
        where status in ('answer_collection', 'selection_open')
        order by created_at limit 1;
  end;

  return v_new;
end;
$$;

revoke execute on function public.create_or_get_current_golden_goose() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- submit_golden_goose_answer: members answer during Answer Collection (editable
-- until the phase closes). The Keeper cannot answer their own request.
-- ----------------------------------------------------------------------------
create or replace function public.submit_golden_goose_answer(p_text text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_banned boolean;
  c record;
begin
  if v_user is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select is_banned into v_banned from public.profiles where user_id = v_user;
  if v_banned is null then raise exception 'NO_PROFILE'; end if;
  if v_banned then raise exception 'BANNED'; end if;
  if p_text is null or length(trim(p_text)) < 1 then raise exception 'EMPTY_ANSWER'; end if;
  if length(p_text) > 800 then raise exception 'ANSWER_TOO_LONG'; end if;

  select * into c from public.golden_goose_assignments
    where status = 'answer_collection' order by created_at limit 1;
  if c.id is null then raise exception 'NO_OPEN_REQUEST'; end if;
  if now() >= c.answer_collection_ends_at then raise exception 'COLLECTION_CLOSED'; end if;
  if c.keeper_user_id = v_user then raise exception 'KEEPER_CANNOT_SUBMIT'; end if;

  insert into public.golden_goose_submissions (assignment_id, user_id, answer_text)
  values (c.id, v_user, trim(p_text))
  on conflict (assignment_id, user_id) do update
    set answer_text = trim(p_text), is_deleted = false, updated_at = now();
end;
$$;

revoke execute on function public.submit_golden_goose_answer(text) from public, anon;
grant execute on function public.submit_golden_goose_answer(text) to authenticated;

-- ----------------------------------------------------------------------------
-- select_golden_goose_winner: Keeper picks a favorite (idempotent).
-- ----------------------------------------------------------------------------
create or replace function public.select_golden_goose_winner(p_submission uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  c record;
  v_sub record;
  v_keeper_reward integer := greatest(public.game_setting_int('goose_keeper_completion_reward_amount', 1), 0);
begin
  if v_user is null then raise exception 'NOT_AUTHENTICATED'; end if;

  -- lock the Keeper's in-play assignment
  select * into c from public.golden_goose_assignments
    where keeper_user_id = v_user and status in ('answer_collection', 'selection_open')
    order by created_at limit 1
    for update;
  if c.id is null then
    -- maybe already completed → idempotent success
    select * into c from public.golden_goose_assignments
      where keeper_user_id = v_user and status in ('completed', 'auto_completed')
      order by created_at desc limit 1;
    if c.id is not null and c.selected_submission_id is not null then
      return jsonb_build_object('already_selected', true);
    end if;
    raise exception 'NOT_KEEPER';
  end if;

  if now() < c.selection_opens_at then raise exception 'SELECTION_NOT_OPEN'; end if;
  if now() >= c.selection_deadline_at then raise exception 'SELECTION_CLOSED'; end if;

  select * into v_sub from public.golden_goose_submissions
    where id = p_submission and assignment_id = c.id and not is_deleted;
  if v_sub.id is null then raise exception 'INVALID_SUBMISSION'; end if;
  if v_sub.user_id = v_user then raise exception 'CANNOT_SELECT_SELF'; end if;

  -- award the egg to the chosen answer's author
  perform public.goose_award_egg(c.id, v_sub.user_id, c.season_id);
  update public.golden_goose_submissions set selected_at = now() where id = v_sub.id;

  -- Keeper completion reward (fertilizer by default) for finishing in time
  if v_keeper_reward > 0 then
    perform public.goose_credit(c.id, v_user, c.season_id, 'fertilizer',
      v_keeper_reward, 'keeper_completion_fertilizer');
  end if;

  update public.golden_goose_assignments
    set status = 'completed', selected_submission_id = v_sub.id, completed_at = now()
    where id = c.id;

  return jsonb_build_object('selected', true);
end;
$$;

revoke execute on function public.select_golden_goose_winner(uuid) from public, anon;
grant execute on function public.select_golden_goose_winner(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- pass_golden_goose: Keeper declines (no penalty); reassign to someone else.
-- ----------------------------------------------------------------------------
create or replace function public.pass_golden_goose()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  c record;
  v_exclude uuid[];
  v_keeper uuid;
  v_new uuid;
  v_ac integer := greatest(public.game_setting_int('goose_answer_collection_hours', 24), 1);
  v_total integer := greatest(public.game_setting_int('goose_total_cycle_hours', 48), 2);
begin
  if v_user is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not public.game_setting_text('goose_pass_enabled', 'true')::boolean then
    raise exception 'PASS_DISABLED';
  end if;

  select * into c from public.golden_goose_assignments
    where keeper_user_id = v_user and status = 'answer_collection'
    order by created_at limit 1
    for update;
  if c.id is null then raise exception 'NOT_KEEPER'; end if;

  update public.golden_goose_assignments set status = 'passed' where id = c.id;

  -- exclude everyone who has already passed today (plus the just-passer)
  select array_agg(distinct keeper_user_id) into v_exclude
  from public.golden_goose_assignments
  where assigned_date = c.assigned_date and status = 'passed' and keeper_user_id is not null;

  v_keeper := public.goose_pick_keeper(c.season_id, coalesce(v_exclude, array[]::uuid[]));
  if v_keeper is null then
    return jsonb_build_object('reassigned', false); -- goose moves on for today
  end if;

  insert into public.golden_goose_assignments
    (season_id, assigned_date, keeper_user_id, status, assigned_at,
     answer_collection_ends_at, selection_opens_at, selection_deadline_at)
  values
    (c.season_id, c.assigned_date, v_keeper, 'answer_collection', now(),
     now() + make_interval(hours => v_ac),
     now() + make_interval(hours => v_ac),
     now() + make_interval(hours => v_total))
  returning id into v_new;

  return jsonb_build_object('reassigned', true);
end;
$$;

revoke execute on function public.pass_golden_goose() from public, anon;
grant execute on function public.pass_golden_goose() to authenticated;

-- ----------------------------------------------------------------------------
-- get_golden_goose_state: everything the dashboard panel needs.
-- ----------------------------------------------------------------------------
create or replace function public.get_golden_goose_state()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  c record;
  v_phase text;
  v_i_keeper boolean;
  v_my_sub record;
  v_count integer := 0;
  v_answers jsonb := '[]'::jsonb;
  v_my_rewards jsonb := '[]'::jsonb;
  v_opt_in boolean;
  v_excluded timestamptz;
begin
  if v_user is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select golden_goose_opt_in, golden_goose_excluded_until into v_opt_in, v_excluded
    from public.profiles where user_id = v_user;

  v_id := public.create_or_get_current_golden_goose();
  if v_id is null then
    return jsonb_build_object(
      'is_goose_day', public.goose_is_goose_day(current_date),
      'has_event', false,
      'opt_in', coalesce(v_opt_in, true),
      'excluded_until', v_excluded);
  end if;

  select * into c from public.golden_goose_assignments where id = v_id;
  v_i_keeper := c.keeper_user_id = v_user;
  v_phase := case c.status
    when 'answer_collection' then 'answer_collection'
    when 'selection_open' then 'selection'
    else 'ended' end;

  select * into v_my_sub from public.golden_goose_submissions
    where assignment_id = c.id and user_id = v_user and not is_deleted;

  if v_i_keeper then
    select count(*)::integer into v_count from public.golden_goose_submissions
      where assignment_id = c.id and not is_deleted;
    -- ANONYMOUS answers (no user_id) — only during Selection phase
    if c.status = 'selection_open' then
      select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'answer_text', s.answer_text)
                                order by s.created_at), '[]'::jsonb)
        into v_answers
      from public.golden_goose_submissions s
      where s.assignment_id = c.id and not s.is_deleted;
    end if;
  end if;

  -- my Golden Goose Egg (if I received one for this event)
  select coalesce(jsonb_agg(jsonb_build_object('reward_type', reward_type, 'amount', amount, 'reason', reason)), '[]'::jsonb)
    into v_my_rewards
  from public.golden_goose_rewards where assignment_id = c.id and user_id = v_user;

  return jsonb_build_object(
    'is_goose_day', true,
    'has_event', true,
    'assignment_id', c.id,
    'status', c.status,
    'phase', v_phase,
    'i_am_keeper', v_i_keeper,
    'i_submitted', v_my_sub.id is not null,
    'my_answer', v_my_sub.answer_text,
    'submission_count', v_count,
    'anonymous_answers', v_answers,
    'my_rewards', v_my_rewards,
    'answer_collection_ends_at', c.answer_collection_ends_at,
    'selection_deadline_at', c.selection_deadline_at,
    'pass_enabled', public.game_setting_text('goose_pass_enabled', 'true')::boolean and v_i_keeper and c.status = 'answer_collection',
    'opt_in', coalesce(v_opt_in, true),
    'excluded_until', v_excluded);
end;
$$;

revoke execute on function public.get_golden_goose_state() from public, anon;
grant execute on function public.get_golden_goose_state() to authenticated;

-- Members opt in/out of being selected as Keeper.
create or replace function public.set_golden_goose_opt_in(p_opt_in boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  update public.profiles set golden_goose_opt_in = coalesce(p_opt_in, true)
    where user_id = auth.uid();
end;
$$;

revoke execute on function public.set_golden_goose_opt_in(boolean) from public, anon;
grant execute on function public.set_golden_goose_opt_in(boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- Admin: list recent events + cancel an active one (audit-logged).
-- ----------------------------------------------------------------------------
create or replace function public.list_admin_golden_goose()
returns table (
  id uuid, assigned_date date, keeper_username text, status text,
  submission_count bigint, auto_selected boolean,
  assigned_at timestamptz, selection_deadline_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  return query
    select a.id, a.assigned_date, p.username, a.status,
      (select count(*) from public.golden_goose_submissions s where s.assignment_id = a.id and not s.is_deleted),
      a.auto_selected, a.assigned_at, a.selection_deadline_at
    from public.golden_goose_assignments a
    left join public.profiles p on p.user_id = a.keeper_user_id
    order by a.created_at desc
    limit 40;
end;
$$;

revoke execute on function public.list_admin_golden_goose() from public, anon;
grant execute on function public.list_admin_golden_goose() to authenticated;

create or replace function public.admin_cancel_golden_goose(p_assignment uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_status text;
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  select status into v_status from public.golden_goose_assignments where id = p_assignment for update;
  if v_status is null then raise exception 'NOT_FOUND'; end if;
  if v_status not in ('answer_collection', 'selection_open') then raise exception 'NOT_ACTIVE'; end if;

  update public.golden_goose_assignments set status = 'cancelled' where id = p_assignment;
  insert into public.admin_audit_logs (actor_user_id, action, metadata_json)
    values (auth.uid(), 'golden_goose_cancelled', jsonb_build_object('assignment_id', p_assignment));
end;
$$;

revoke execute on function public.admin_cancel_golden_goose(uuid) from public, anon;
grant execute on function public.admin_cancel_golden_goose(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- update_game_settings: add goose_enabled (boolean). Full drop-in replacement
-- of the current validator (keeps all existing keys + house-name text keys).
-- ----------------------------------------------------------------------------
create or replace function public.update_game_settings(p_settings jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_val jsonb;
  v_old jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_num numeric;
  v_i integer;
  v_elem jsonb;
  v_txt text;
  reward_type_keys text[] := array[
    'meeting_attendance_reward_type', 'hosting_reward_type',
    'giving_seed_reward_type', 'receiving_seed_reward_type',
    'goose_keeper_completion_reward_type'];
  schedule_mode_keys text[] := array['basket_schedule_mode', 'goose_schedule_mode'];
  days_per_week_keys text[] := array['basket_random_days_per_week', 'goose_random_days_per_week'];
  enabled_days_keys text[] := array['basket_enabled_days', 'goose_enabled_days'];
  boolean_keys text[] := array[
    'basket_enabled', 'goose_enabled',
    'goose_auto_select_enabled', 'goose_pass_enabled',
    'goose_opt_in_required_for_private_users'];
  percent_keys text[] := array['basket_large_basket_chance_percent', 'blossom_chance_percent'];
  min_two_keys text[] := array['basket_small_target_count', 'basket_large_target_count'];
  min_one_keys text[] := array['basket_keep_multiplier', 'basket_hold_hours', 'blossom_fruit_multiplier'];
  text_keys text[] := array[
    'house_name_house_1', 'house_name_house_2', 'house_name_house_3',
    'house_name_house_4', 'house_name_house_5', 'house_name_house_6'];
  number_keys text[] := array[
    'meeting_attendance_reward_amount', 'hosting_reward_amount',
    'giving_seed_reward_amount', 'receiving_seed_reward_amount',
    'receiving_seed_bonus_water',
    'basket_max_water_per_pass', 'basket_max_seed_per_pass',
    'basket_max_fertilizer_per_pass', 'basket_auto_pass_water',
    'goose_answer_collection_hours', 'goose_selection_hours',
    'goose_total_cycle_hours', 'goose_exclusion_months_on_missed_selection',
    'goose_egg_seed_amount', 'goose_egg_fertilizer_amount',
    'goose_egg_water_amount', 'goose_keeper_completion_reward_amount'];
  allowed text[];
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then raise exception 'INVALID_PAYLOAD'; end if;

  allowed := reward_type_keys || schedule_mode_keys || days_per_week_keys
             || enabled_days_keys || boolean_keys || percent_keys
             || min_two_keys || min_one_keys || text_keys || number_keys;

  for v_key, v_val in select * from jsonb_each(p_settings) loop
    if not (v_key = any(allowed)) then raise exception 'UNKNOWN_SETTING_KEY: %', v_key; end if;

    if v_key = any(reward_type_keys) then
      if jsonb_typeof(v_val) <> 'string' or (v_val #>> '{}') not in ('water', 'seed', 'fertilizer') then
        raise exception 'INVALID_REWARD_TYPE for %', v_key;
      end if;
    elsif v_key = any(schedule_mode_keys) then
      if jsonb_typeof(v_val) <> 'string' or (v_val #>> '{}') not in ('random', 'specific') then
        raise exception 'INVALID_SCHEDULE_MODE for %', v_key;
      end if;
    elsif v_key = any(text_keys) then
      if jsonb_typeof(v_val) <> 'string' then raise exception 'INVALID_TEXT for %', v_key; end if;
      v_txt := trim(v_val #>> '{}');
      if length(v_txt) < 1 or length(v_txt) > 40 then raise exception 'TEXT_LENGTH for %', v_key; end if;
      v_val := to_jsonb(v_txt);
    elsif v_key = any(days_per_week_keys) then
      if jsonb_typeof(v_val) <> 'number' then raise exception 'INVALID_NUMBER for %', v_key; end if;
      v_num := (v_val #>> '{}')::numeric;
      if v_num < 0 or v_num > 7 or v_num <> floor(v_num) then raise exception 'DAYS_PER_WEEK_OUT_OF_RANGE for %', v_key; end if;
    elsif v_key = any(enabled_days_keys) then
      if jsonb_typeof(v_val) <> 'array' then raise exception 'INVALID_DAYS_ARRAY for %', v_key; end if;
      for v_elem in select * from jsonb_array_elements(v_val) loop
        if jsonb_typeof(v_elem) <> 'number' then raise exception 'INVALID_DAY for %', v_key; end if;
        v_i := (v_elem #>> '{}')::integer;
        if v_i < 0 or v_i > 6 then raise exception 'DAY_OUT_OF_RANGE for %', v_key; end if;
      end loop;
    elsif v_key = any(boolean_keys) then
      if jsonb_typeof(v_val) <> 'boolean' then raise exception 'INVALID_BOOLEAN for %', v_key; end if;
    elsif v_key = any(percent_keys) then
      if jsonb_typeof(v_val) <> 'number' then raise exception 'INVALID_NUMBER for %', v_key; end if;
      v_num := (v_val #>> '{}')::numeric;
      if v_num < 0 or v_num > 100 then raise exception 'PERCENT_OUT_OF_RANGE for %', v_key; end if;
    elsif v_key = any(min_two_keys) then
      if jsonb_typeof(v_val) <> 'number' then raise exception 'INVALID_NUMBER for %', v_key; end if;
      v_num := (v_val #>> '{}')::numeric;
      if v_num < 2 or v_num <> floor(v_num) then raise exception 'TARGET_TOO_SMALL for %', v_key; end if;
    elsif v_key = any(min_one_keys) then
      if jsonb_typeof(v_val) <> 'number' then raise exception 'INVALID_NUMBER for %', v_key; end if;
      v_num := (v_val #>> '{}')::numeric;
      if v_num < 1 then raise exception 'VALUE_TOO_SMALL for %', v_key; end if;
    elsif v_key = any(number_keys) then
      if jsonb_typeof(v_val) <> 'number' then raise exception 'INVALID_NUMBER for %', v_key; end if;
      v_num := (v_val #>> '{}')::numeric;
      if v_num < 0 then raise exception 'NEGATIVE_NOT_ALLOWED for %', v_key; end if;
    end if;

    select value_json into v_old from public.game_settings where key = v_key;
    if v_old is distinct from v_val then
      insert into public.game_settings (key, value_json, updated_by, updated_at)
        values (v_key, v_val, auth.uid(), now())
      on conflict (key) do update
        set value_json = excluded.value_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
      v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object('old', v_old, 'new', v_val));
    end if;
  end loop;

  if v_changes <> '{}'::jsonb then
    insert into public.admin_audit_logs (actor_user_id, action, metadata_json)
    values (auth.uid(), 'game_settings_updated', jsonb_build_object('changes', v_changes));
  end if;
end;
$$;

revoke execute on function public.update_game_settings(jsonb) from public, anon;
grant execute on function public.update_game_settings(jsonb) to authenticated;
