-- ============================================================================
-- get_season_lottery_summary(p_season): community-level Weekly Orchard
-- Lottery aggregates for the season ceremony. Numbers only — no user ids, no
-- winner identity — so it is privacy-safe for every viewer. Returns null-ish
-- zeros when the season had no lottery activity (the ceremony hides the card).
-- ============================================================================
create or replace function public.get_season_lottery_summary(p_season uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select jsonb_build_object(
    'rounds_drawn', count(*) filter (where status = 'drawn'),
    'total_tickets', coalesce(sum(total_tickets), 0),
    'total_orchard_bonus', coalesce(sum(orchard_bonus_coins) filter (where status = 'drawn'), 0),
    'largest_prize', coalesce(max(final_prize_coins) filter (where status = 'drawn'), 0),
    'largest_pot', coalesce(max(player_funded_pot_coins), 0))
  into v
  from public.weekly_lottery_rounds
  where season_id = p_season;
  return coalesce(v, jsonb_build_object(
    'rounds_drawn', 0, 'total_tickets', 0, 'total_orchard_bonus', 0,
    'largest_prize', 0, 'largest_pot', 0));
end;
$$;

revoke execute on function public.get_season_lottery_summary(uuid) from public, anon;
grant execute on function public.get_season_lottery_summary(uuid) to authenticated;
