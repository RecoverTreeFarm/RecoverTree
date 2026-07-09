-- ============================================================================
-- Economy change: Fruits come ONLY from harvesting trees (and fertilizer,
-- which instantly fruits a waiting tree). Everything else grants water and/or
-- fertilizer, never Fruits.
--
--   - Attending a meeting: +10 water (was also +10 Fruits — removed).
--   - Completing a checklist goal: water + fertilizer (handled in the next
--     migration). New fertilizer_events reason 'checklist_reward'.
-- ============================================================================

alter table public.fertilizer_events drop constraint fertilizer_events_reason_check;
alter table public.fertilizer_events
  add constraint fertilizer_events_reason_check
  check (reason in
    ('medal_reward', 'badge_reward', 'checklist_reward', 'used_on_tree',
     'admin_adjustment'));

-- Meeting redemption now awards water only (no Fruits, no fruit_events).
drop function public.redeem_meeting_code(text);

create or replace function public.redeem_meeting_code(p_code text)
returns table (water_awarded integer, host_username text)
language plpgsql
security definer
set search_path = public
as $$
declare
  c_water constant integer := 10; -- attending a meeting earns water
  v_user uuid := auth.uid();
  v_banned boolean;
  v_session record;
  v_farm uuid;
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select p.is_banned into v_banned
  from public.profiles p where p.user_id = v_user;
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

  insert into public.meeting_attendance
    (meeting_session_id, host_user_id, attendee_user_id, season_id)
  values
    (v_session.id, v_session.host_user_id, v_user, v_session.season_id);

  -- water only — Fruits are earned by harvesting
  update public.farms
    set water_count = water_count + c_water
    where id = v_farm;

  return query
    select c_water,
      (select p.username from public.profiles p
        where p.user_id = v_session.host_user_id);
end;
$$;

revoke execute on function public.redeem_meeting_code(text) from public;
revoke execute on function public.redeem_meeting_code(text) from anon;
grant execute on function public.redeem_meeting_code(text) to authenticated;
