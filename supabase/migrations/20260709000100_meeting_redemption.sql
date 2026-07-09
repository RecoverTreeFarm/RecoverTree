-- ============================================================================
-- Meeting code redemption + host code lifecycle rework
--
-- Host changes (per feedback):
--  - A code stays active for its full 90 minutes; hosts cannot end it early.
--  - The host can leave and return: the SAME code is re-displayed while
--    active. The plaintext code is stored on the session row — RLS only
--    lets the host (and admins) read it; members can never select codes.
--  - start_meeting() is idempotent: if a live code exists it returns it.
--
-- Redemption (redeem_meeting_code):
--  - validates: logged in, has profile, not banned, code exists + active +
--    unexpired, not already redeemed for this session
--  - records attendance (linked to the host), awards 10 Fruits
--    (fruit_events ledger + farms.fruit_total) and 10 water for the farm,
--    and updates meeting-count / different-hosts checklist progress
-- ============================================================================

alter table public.meeting_sessions add column code text;

-- Hosts can no longer end codes early.
drop function public.end_my_meeting();

-- Return type changes (adds code + already_active), so drop first.
drop function public.start_meeting();

create or replace function public.start_meeting()
returns table (meeting_session_id uuid, code text, expires_at timestamptz, already_active boolean)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  c_code_lifetime constant interval := interval '90 minutes';
  v_user uuid := auth.uid();
  v_role text;
  v_season uuid;
  v_id uuid := gen_random_uuid();
  v_code text;
  v_expires timestamptz := now() + c_code_lifetime;
  v_existing record;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select p.role into v_role
  from public.profiles p
  where p.user_id = v_user and not p.is_banned;

  if v_role is null or v_role not in ('meeting_host', 'admin') then
    raise exception 'Only Meeting Hosts can start meeting codes';
  end if;

  update public.seasons
    set status = 'closed'
    where status = 'active' and ends_at <= now();
  v_season := public.ensure_active_season();

  -- Codes that ran their full 90 minutes get closed out here.
  update public.meeting_sessions
    set status = 'ended', ended_at = now()
    where host_user_id = v_user and status = 'active' and expires_at <= now();

  -- Already running a code? Hand the same one back.
  select m.id, m.code, m.expires_at into v_existing
  from public.meeting_sessions m
  where m.host_user_id = v_user and m.status = 'active'
  limit 1;

  if v_existing.id is not null then
    return query select v_existing.id, v_existing.code, v_existing.expires_at, true;
    return;
  end if;

  -- 0000–9999, always 4 digits
  v_code := lpad(floor(random() * 10000)::int::text, 4, '0');

  insert into public.meeting_sessions
    (id, host_user_id, season_id, code, code_hash, expires_at)
  values
    (v_id, v_user, v_season, v_code, md5(v_id::text || v_code), v_expires);

  return query select v_id, v_code, v_expires, false;
end;
$$;

revoke execute on function public.start_meeting() from public;
revoke execute on function public.start_meeting() from anon;
grant execute on function public.start_meeting() to authenticated;

-- ----------------------------------------------------------------------------
-- Checklist progress for meetings: total attended + distinct hosts.
-- Internal helper — not callable by clients.
-- ----------------------------------------------------------------------------
create or replace function public.update_meeting_checklist_progress(
  p_user uuid,
  p_season uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meetings integer;
  v_hosts integer;
  r record;
  v_value integer;
begin
  select count(*), count(distinct host_user_id)
    into v_meetings, v_hosts
  from public.meeting_attendance
  where attendee_user_id = p_user and season_id = p_season;

  for r in
    select id, rule_type, coalesce((config->>'target')::int, 1) as target
    from public.checklist_definitions
    where active and rule_type in ('meeting_count', 'distinct_hosts')
  loop
    v_value := case when r.rule_type = 'meeting_count' then v_meetings else v_hosts end;

    insert into public.user_checklist_progress
      (user_id, season_id, checklist_definition_id, progress_value, completed_at)
    values
      (p_user, p_season, r.id, v_value,
       case when v_value >= r.target then now() else null end)
    on conflict (user_id, season_id, checklist_definition_id) do update
      set progress_value = excluded.progress_value,
          completed_at = coalesce(
            public.user_checklist_progress.completed_at,
            excluded.completed_at
          );
  end loop;
end;
$$;

revoke execute on function public.update_meeting_checklist_progress(uuid, uuid) from public;
revoke execute on function public.update_meeting_checklist_progress(uuid, uuid) from anon;
revoke execute on function public.update_meeting_checklist_progress(uuid, uuid) from authenticated;

-- ----------------------------------------------------------------------------
-- redeem_meeting_code: the member-side check-in.
-- Raises coded exceptions the app turns into gentle messages.
-- ----------------------------------------------------------------------------
create or replace function public.redeem_meeting_code(p_code text)
returns table (fruits_awarded integer, water_awarded integer, host_username text)
language plpgsql
security definer
set search_path = public
as $$
declare
  c_fruits constant integer := 10;  -- Attend meeting = 10 Fruits
  c_water constant integer := 10;   -- plus water to grow the farm
  v_user uuid := auth.uid();
  v_banned boolean;
  v_session record;
  v_farm uuid;
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select p.is_banned into v_banned
  from public.profiles p
  where p.user_id = v_user;

  if v_banned is null then
    raise exception 'NO_PROFILE';
  end if;
  if v_banned then
    raise exception 'BANNED';
  end if;

  if p_code !~ '^[0-9]{4}$' then
    raise exception 'INVALID_CODE';
  end if;

  select m.id, m.host_user_id, m.season_id, m.expires_at into v_session
  from public.meeting_sessions m
  where m.code = p_code and m.status = 'active'
  order by m.starts_at desc
  limit 1;

  if v_session.id is null then
    raise exception 'INVALID_CODE';
  end if;
  if v_session.expires_at <= now() then
    raise exception 'CODE_EXPIRED';
  end if;
  if exists (
    select 1 from public.meeting_attendance a
    where a.meeting_session_id = v_session.id and a.attendee_user_id = v_user
  ) then
    raise exception 'ALREADY_REDEEMED';
  end if;

  -- Make sure the attendee has a farm (+ starter tree) this Season.
  insert into public.farms (user_id, season_id)
  values (v_user, v_session.season_id)
  on conflict (user_id, season_id) do nothing;

  select f.id into v_farm
  from public.farms f
  where f.user_id = v_user and f.season_id = v_session.season_id;

  if not exists (
    select 1 from public.trees t
    where t.farm_id = v_farm and t.created_reason = 'starter'
  ) then
    insert into public.trees (farm_id, user_id, season_id, created_reason)
    values (v_farm, v_user, v_session.season_id, 'starter');
  end if;

  -- Attendance, linked to the host.
  insert into public.meeting_attendance
    (meeting_session_id, host_user_id, attendee_user_id, season_id)
  values
    (v_session.id, v_session.host_user_id, v_user, v_session.season_id);

  -- Score: ledger entry + farm totals (Fruits and water).
  insert into public.fruit_events
    (user_id, season_id, amount, source_type, source_id, description)
  values
    (v_user, v_session.season_id, c_fruits, 'meeting_attendance', v_session.id,
     'Attended a meeting');

  update public.farms
    set fruit_total = fruit_total + c_fruits,
        water_count = water_count + c_water
    where id = v_farm;

  -- Different-host / meeting-count checklist progress.
  perform public.update_meeting_checklist_progress(v_user, v_session.season_id);

  return query
    select c_fruits, c_water,
      (select p.username from public.profiles p
        where p.user_id = v_session.host_user_id);
end;
$$;

revoke execute on function public.redeem_meeting_code(text) from public;
revoke execute on function public.redeem_meeting_code(text) from anon;
grant execute on function public.redeem_meeting_code(text) to authenticated;
