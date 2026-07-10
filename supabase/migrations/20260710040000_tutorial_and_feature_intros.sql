-- ============================================================================
-- First-time tutorial + feature-guide intros.
--
-- WHAT
--   * profiles gains four columns tracking tutorial progress and which
--     feature-guide popups a user has already seen.
--   * grant_tutorial_supplies() — idempotent one-time top-up of the supplies a
--     user needs to complete the tutorial (Water, one Seed, one Fertilizer).
--   * complete_tutorial() — marks the required tutorial finished.
--   * mark_feature_intro_seen(key) — records that a feature-guide popup was
--     shown, so it never nags again.
--
-- ECONOMY (unchanged): the tutorial teaches the farm loop by having the user
-- run the REAL water/fertilize/harvest functions. Fruits are still created
-- ONLY by harvesting a tree. grant_tutorial_supplies grants Water/Seeds/
-- Fertilizer only — NEVER Fruits, never Coins — and only once per user, so a
-- replay can't farm supplies.
--
-- Existing users default to tutorial_completed = false, so they are required
-- to complete the tutorial the next time they open the dashboard.
-- ============================================================================

alter table public.profiles
  add column if not exists tutorial_completed boolean not null default false,
  add column if not exists tutorial_completed_at timestamptz,
  add column if not exists tutorial_supplies_granted boolean not null default false,
  add column if not exists feature_intro_seen jsonb not null default '{}'::jsonb;

-- ----------------------------------------------------------------------------
-- grant_tutorial_supplies(): idempotent. Tops the caller's active-season farm
-- up to enough Water for the tutorial's three waterings (30, a multiple of 5),
-- at least one Seed, and at least one Fertilizer. Runs at most once per user
-- (guarded by profiles.tutorial_supplies_granted), so restarting/replaying the
-- tutorial never grants more.
-- ----------------------------------------------------------------------------
-- OUT columns are deliberately NOT named water_count/seed_count/fertilizer_count
-- so they can't collide with the farms columns inside the UPDATE (a plpgsql
-- variable-vs-column ambiguity would silently read the null OUT variable).
create or replace function public.grant_tutorial_supplies()
returns table (out_water integer, out_seed integer, out_fertilizer integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  c_water_needed constant integer := 30;  -- 3 waterings × 10, multiple of 5
  v_user uuid := auth.uid();
  v_farm uuid;
  v_already boolean;
  v_water integer;
  v_seed integer;
  v_fert integer;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select tutorial_supplies_granted into v_already
    from public.profiles where user_id = v_user;
  if v_already is null then
    raise exception 'NO_PROFILE';
  end if;

  select f.id, f.water_count, f.seed_count, f.fertilizer_count
    into v_farm, v_water, v_seed, v_fert
  from public.farms f
  join public.seasons s on s.id = f.season_id and s.status = 'active'
  where f.user_id = v_user
  for update of f;

  if v_farm is null then
    raise exception 'No farm this Season';
  end if;

  -- Already granted once — return current counts, grant nothing more.
  if v_already then
    return query select v_water, v_seed, v_fert;
    return;
  end if;

  update public.farms f
    set water_count = greatest(f.water_count, c_water_needed),
        seed_count = greatest(f.seed_count, 1),
        fertilizer_count = greatest(f.fertilizer_count, 1)
    where f.id = v_farm
    returning f.water_count, f.seed_count, f.fertilizer_count
    into v_water, v_seed, v_fert;

  update public.profiles
    set tutorial_supplies_granted = true
    where user_id = v_user;

  return query select v_water, v_seed, v_fert;
end;
$$;

revoke execute on function public.grant_tutorial_supplies() from public, anon;
grant execute on function public.grant_tutorial_supplies() to authenticated;

-- ----------------------------------------------------------------------------
-- complete_tutorial(): marks the required tutorial finished (idempotent).
-- ----------------------------------------------------------------------------
create or replace function public.complete_tutorial()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;
  update public.profiles
    set tutorial_completed = true,
        tutorial_completed_at = coalesce(tutorial_completed_at, now())
    where user_id = v_user and tutorial_completed = false;
end;
$$;

revoke execute on function public.complete_tutorial() from public, anon;
grant execute on function public.complete_tutorial() to authenticated;

-- ----------------------------------------------------------------------------
-- mark_feature_intro_seen(key): records that a first-time feature guide popup
-- was shown, so it never appears again for this user.
-- ----------------------------------------------------------------------------
create or replace function public.mark_feature_intro_seen(p_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  c_allowed constant text[] := array[
    'meeting_code', 'store', 'community_garden', 'traveling_basket', 'golden_goose'];
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;
  if not (p_key = any(c_allowed)) then
    raise exception 'UNKNOWN_FEATURE_KEY: %', p_key;
  end if;
  update public.profiles
    set feature_intro_seen =
      coalesce(feature_intro_seen, '{}'::jsonb) || jsonb_build_object(p_key, true)
    where user_id = v_user;
end;
$$;

revoke execute on function public.mark_feature_intro_seen(text) from public, anon;
grant execute on function public.mark_feature_intro_seen(text) to authenticated;
