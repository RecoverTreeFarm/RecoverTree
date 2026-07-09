-- ============================================================================
-- Ceremony reveal + Private Mode: anonymous winners should still appear (as
-- "Anonymous Farmer"), so their medal/badge rows must be readable. Hidden
-- winners stay hidden. The ceremony UI anonymizes the display for anonymous.
-- ============================================================================

drop policy "user_medals: own, admin, or public-profile owner" on public.user_medals;
create policy "user_medals: own, admin, public or anonymous owner"
  on public.user_medals for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.profiles p
      where p.user_id = user_medals.user_id
        and p.leaderboard_visibility in ('public', 'anonymous')
        and not p.is_banned
    )
  );

drop policy "user_badges: own, admin, or public-profile owner" on public.user_badges;
create policy "user_badges: own, admin, public or anonymous owner"
  on public.user_badges for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.profiles p
      where p.user_id = user_badges.user_id
        and p.leaderboard_visibility in ('public', 'anonymous')
        and not p.is_banned
    )
  );
