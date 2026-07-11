-- ============================================================================
-- Daily resets roll at MIDNIGHT PACIFIC, not UTC (owner request, 2026-07-11).
--
-- The database runs in UTC, so every "once per day" mechanic (KudoSeed,
-- greeting neighbors, patting the store dog, the garden daily contribution
-- limit, the store's daily sale, and the basket/goose "which day" checks) was
-- rolling over at UTC midnight = ~4pm Pacific. Players want the day to turn
-- over overnight instead.
--
-- Two surgical changes — NO function bodies are rewritten:
--   1. The four *_on_date column DEFAULTS now compute the America/Los_Angeles
--      date, so every inserted "daily" row is stamped with the Pacific day.
--   2. The functions that COMPARE against current_date get a per-function
--      `SET timezone` so current_date (and now()::date) evaluate in Pacific
--      during their execution. Postgres applies this GUC for the whole call,
--      including nested inserts/reads.
--
-- America/Los_Angeles handles PST/PDT automatically (DST-safe). Reversible:
-- ALTER ... RESET timezone / restore the CURRENT_DATE defaults.
-- ============================================================================

-- ---- (1) daily-limit column defaults → Pacific date ------------------------
alter table public.seed_events
  alter column given_on_date set default ((now() at time zone 'America/Los_Angeles')::date);
alter table public.neighbor_greetings
  alter column greeted_on_date set default ((now() at time zone 'America/Los_Angeles')::date);
alter table public.store_pet_greetings
  alter column greeted_on_date set default ((now() at time zone 'America/Los_Angeles')::date);
alter table public.community_garden_contributions
  alter column contributed_on_date set default ((now() at time zone 'America/Los_Angeles')::date);

-- ---- (2) functions that read current_date → evaluate it in Pacific ---------
alter function public.give_seed(uuid, text) set timezone to 'America/Los_Angeles';
alter function public.contribute_to_community_garden(integer, integer, integer) set timezone to 'America/Los_Angeles';
alter function public.purchase_store_item(text, boolean) set timezone to 'America/Los_Angeles';
alter function public.get_general_store_state() set timezone to 'America/Los_Angeles';
alter function public.get_community_garden_state() set timezone to 'America/Los_Angeles';
alter function public.get_traveling_basket_state() set timezone to 'America/Los_Angeles';
alter function public.get_golden_goose_state() set timezone to 'America/Los_Angeles';
alter function public.get_my_kudoseeds() set timezone to 'America/Los_Angeles';
alter function public.create_or_get_today_basket() set timezone to 'America/Los_Angeles';
alter function public.create_or_get_current_golden_goose() set timezone to 'America/Los_Angeles';
