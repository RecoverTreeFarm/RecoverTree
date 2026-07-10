-- ============================================================================
-- Golden Goose: the Keeper's pick is PROVISIONAL until the selection deadline.
--
-- Before: select_golden_goose_winner paid the egg and marked the event
-- 'completed' on the FIRST pick; a second call was refused, so the Keeper
-- could never change their mind.
--
-- Now (user-approved reward-rule change, 2026-07-09):
--   * select_golden_goose_winner only RECORDS the favorite
--     (selected_submission_id) and leaves the event 'selection_open'. Calling
--     it again with a different submission simply replaces the pick — the
--     Keeper can change their favorite any number of times before the
--     deadline. NOTHING is paid at pick time.
--   * auto_close_golden_goose_assignments does ALL the paying, at the
--     deadline: whatever pick is saved then is the one that wins the egg,
--     and the Keeper earns the completion fertilizer for having picked in
--     time (status 'completed', no exclusion break). With no pick saved the
--     old behavior stands: random valid answer → egg ('auto_completed') or
--     'expired_no_submissions', and the Keeper takes the short exclusion
--     break either way.
--   * get_golden_goose_state exposes my_pick_submission_id to the Keeper so
--     the UI can show/let them change the current favorite.
--
-- ECONOMY unchanged: the egg is still only seed/water/fertilizer, paid once,
-- via the existing goose_award_egg/goose_credit helpers. Fruits still come
-- only from harvesting trees. update_game_settings is NOT touched here (the
-- newest version stays in 20260709180000).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. select_golden_goose_winner v2: save/replace the favorite, pay nothing.
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
begin
  if v_user is null then raise exception 'NOT_AUTHENTICATED'; end if;

  -- lock the Keeper's in-play assignment
  select * into c from public.golden_goose_assignments
    where keeper_user_id = v_user and status in ('answer_collection', 'selection_open')
    order by created_at limit 1
    for update;
  if c.id is null then raise exception 'NOT_KEEPER'; end if;

  if now() < c.selection_opens_at then raise exception 'SELECTION_NOT_OPEN'; end if;
  if now() >= c.selection_deadline_at then raise exception 'SELECTION_CLOSED'; end if;

  select * into v_sub from public.golden_goose_submissions
    where id = p_submission and assignment_id = c.id and not is_deleted;
  if v_sub.id is null then raise exception 'INVALID_SUBMISSION'; end if;
  if v_sub.user_id = v_user then raise exception 'CANNOT_SELECT_SELF'; end if;

  -- provisional: the egg is delivered when the goose leaves (at the deadline)
  update public.golden_goose_assignments
    set selected_submission_id = v_sub.id
    where id = c.id;

  return jsonb_build_object('selected', true, 'provisional', true);
end;
$$;

revoke execute on function public.select_golden_goose_winner(uuid) from public, anon;
grant execute on function public.select_golden_goose_winner(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. auto_close_golden_goose_assignments v2: pay the saved pick at deadline.
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
  v_keeper_reward integer := greatest(public.game_setting_int('goose_keeper_completion_reward_amount', 1), 0);
begin
  for c in
    select * from public.golden_goose_assignments
    where status in ('answer_collection', 'selection_open')
      and now() >= selection_deadline_at
    for update
  loop
    v_sub := null;

    -- the Keeper's saved favorite, if it is still valid (answer not deleted,
    -- author still active)
    if c.selected_submission_id is not null then
      select s.* into v_sub
      from public.golden_goose_submissions s
      join public.profiles p on p.user_id = s.user_id and not p.is_banned
      where s.id = c.selected_submission_id
        and s.assignment_id = c.id and not s.is_deleted;
    end if;

    if v_sub.id is not null then
      -- Keeper picked in time → their favorite wins; Keeper earns the
      -- completion reward and takes no exclusion break.
      perform public.goose_award_egg(c.id, v_sub.user_id, c.season_id);
      update public.golden_goose_submissions set selected_at = now() where id = v_sub.id;
      if v_keeper_reward > 0 and c.keeper_user_id is not null then
        perform public.goose_credit(c.id, c.keeper_user_id, c.season_id, 'fertilizer',
          v_keeper_reward, 'keeper_completion_fertilizer');
      end if;
      update public.golden_goose_assignments
        set status = 'completed', auto_selected = false, completed_at = now(), expired_at = now()
        where id = c.id;
      continue;
    end if;

    -- no (valid) pick saved: fall back to a random valid submission
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

    -- the Keeper never picked → short break from being selected again
    perform public.goose_exclude_keeper(c.keeper_user_id);
  end loop;
end;
$$;

revoke execute on function public.auto_close_golden_goose_assignments() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. get_golden_goose_state v2: + my_pick_submission_id (Keeper only).
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
    -- the Keeper's saved (provisional) favorite — only they see it
    'my_pick_submission_id',
      case when v_i_keeper and c.status = 'selection_open'
           then c.selected_submission_id end,
    'answer_collection_ends_at', c.answer_collection_ends_at,
    'selection_deadline_at', c.selection_deadline_at,
    'pass_enabled', public.game_setting_text('goose_pass_enabled', 'true')::boolean and v_i_keeper and c.status = 'answer_collection',
    'opt_in', coalesce(v_opt_in, true),
    'excluded_until', v_excluded);
end;
$$;

revoke execute on function public.get_golden_goose_state() from public, anon;
grant execute on function public.get_golden_goose_state() to authenticated;
