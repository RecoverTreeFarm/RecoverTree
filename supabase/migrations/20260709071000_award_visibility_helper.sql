-- ============================================================================
-- Fix: the award RLS policies checked profiles inside an EXISTS, but that
-- subquery is itself subject to profiles' RLS (which hides anonymous farmers),
-- so anonymous winners' medals stayed invisible. Use a SECURITY DEFINER helper
-- that can read visibility regardless of RLS.
-- ============================================================================

create or replace function public.award_owner_visible(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = p_user
      and p.leaderboard_visibility in ('public', 'anonymous')
      and not p.is_banned
  );
$$;

revoke execute on function public.award_owner_visible(uuid) from public;
revoke execute on function public.award_owner_visible(uuid) from anon;
grant execute on function public.award_owner_visible(uuid) to authenticated;

drop policy "user_medals: own, admin, public or anonymous owner" on public.user_medals;
create policy "user_medals: own, admin, or revealable owner"
  on public.user_medals for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or public.award_owner_visible(user_id)
  );

drop policy "user_badges: own, admin, public or anonymous owner" on public.user_badges;
create policy "user_badges: own, admin, or revealable owner"
  on public.user_badges for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or public.award_owner_visible(user_id)
  );
