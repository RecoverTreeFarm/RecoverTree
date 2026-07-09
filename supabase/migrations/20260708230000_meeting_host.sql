-- ============================================================================
-- Meeting Host: start/end meeting codes (server-side only)
--
-- The app does NOT create or host meetings — those happen externally
-- (Google Meet, WhatsApp, Signal, …). Hosts generate a 4-digit attendance
-- code here and read it aloud during their external meeting.
--
-- Security:
--  - Only meeting_host / admin roles (checked server-side) can start codes.
--  - Only the code's HASH is stored; the plaintext is returned exactly once
--    to the host at creation time.
--  - A host can have at most one active code (also a partial unique index).
--  - Codes expire after 90 minutes.
-- ============================================================================

create or replace function public.start_meeting()
returns table (meeting_session_id uuid, code text, expires_at timestamptz)
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

  -- Tidy up: an expired code that was never ended shouldn't block a new one.
  update public.meeting_sessions
    set status = 'ended', ended_at = now()
    where host_user_id = v_user and status = 'active' and expires_at <= now();

  if exists (
    select 1 from public.meeting_sessions m
    where m.host_user_id = v_user and m.status = 'active'
  ) then
    raise exception 'You already have an active meeting code — end it first';
  end if;

  -- 0000–9999, always 4 digits
  v_code := lpad(floor(random() * 10000)::int::text, 4, '0');

  insert into public.meeting_sessions
    (id, host_user_id, season_id, code_hash, expires_at)
  values
    (v_id, v_user, v_season, md5(v_id::text || v_code), v_expires);

  return query select v_id, v_code, v_expires;
end;
$$;

revoke execute on function public.start_meeting() from public;
revoke execute on function public.start_meeting() from anon;
grant execute on function public.start_meeting() to authenticated;

create or replace function public.end_my_meeting()
returns table (attendance_count bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  update public.meeting_sessions
    set status = 'ended', ended_at = now()
    where host_user_id = v_user and status = 'active'
    returning id into v_id;

  if v_id is null then
    raise exception 'No active meeting code to end';
  end if;

  return query
    select count(*) from public.meeting_attendance
    where meeting_session_id = v_id;
end;
$$;

revoke execute on function public.end_my_meeting() from public;
revoke execute on function public.end_my_meeting() from anon;
grant execute on function public.end_my_meeting() to authenticated;
