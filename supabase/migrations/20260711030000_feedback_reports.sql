-- ============================================================================
-- Leave Feedback (2026-07-11): the Guidebook's placeholder bug-report form
-- becomes a real feature. Every submission is SAVED here (source of truth);
-- the app additionally emails it to support@recovertree.com via Resend when
-- RESEND_API_KEY is configured (best-effort, never blocks the save).
--
-- Convention: clients never write directly — submit_feedback() validates and
-- rate-limits; list_admin_feedback() is the admin read.
-- ============================================================================

create table public.feedback_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  -- snapshot so feedback stays attributable even if the account goes away
  username text,
  feedback_type text not null check (feedback_type in ('bug', 'feature', 'general')),
  message text not null,
  contact text,
  created_at timestamptz not null default now()
);

create index feedback_reports_created_idx on public.feedback_reports (created_at desc);

alter table public.feedback_reports enable row level security;
-- No client policies at all: writes go through submit_feedback(), reads
-- through list_admin_feedback(). (RLS with zero policies = deny.)

create or replace function public.submit_feedback(
  p_type text, p_message text, p_contact text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_username text;
  v_banned boolean;
  v_id uuid;
begin
  if v_user is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select username, is_banned into v_username, v_banned
  from public.profiles where user_id = v_user;
  if v_username is null then raise exception 'NO_PROFILE'; end if;
  if v_banned then raise exception 'BANNED'; end if;

  if p_type not in ('bug', 'feature', 'general') then
    raise exception 'INVALID_TYPE';
  end if;
  if p_message is null or length(trim(p_message)) < 3 then
    raise exception 'MESSAGE_TOO_SHORT';
  end if;
  if length(p_message) > 2000 then
    raise exception 'MESSAGE_TOO_LONG';
  end if;
  if p_contact is not null and length(p_contact) > 200 then
    raise exception 'CONTACT_TOO_LONG';
  end if;

  -- gentle rate limit: 5 submissions per farmer per day
  if (
    select count(*) from public.feedback_reports
    where user_id = v_user and created_at > now() - interval '24 hours'
  ) >= 5 then
    raise exception 'RATE_LIMITED';
  end if;

  insert into public.feedback_reports (user_id, username, feedback_type, message, contact)
  values (v_user, v_username, p_type, trim(p_message), nullif(trim(coalesce(p_contact, '')), ''))
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.list_admin_feedback()
returns setof public.feedback_reports
language sql
stable
security definer
set search_path = public
as $$
  select * from public.feedback_reports
  where public.is_admin()
  order by created_at desc
  limit 200;
$$;
