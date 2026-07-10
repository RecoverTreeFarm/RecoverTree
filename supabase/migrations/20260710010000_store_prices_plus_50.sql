-- ============================================================================
-- Store prices +50% (user request). The code defaults in src/lib/gameSettings.ts
-- and these SQL fallbacks are the two halves of one number — keep them equal.
--
--   water bundle   10 → 15
--   fertilizer     30 → 45
--   seed           50 → 75
--   goose entry    40 → 60
--
-- No game_settings override rows exist for these keys, so the fallbacks below
-- are what players actually pay. If an admin has since customized a price, the
-- override wins (as always) and is untouched here.
-- ============================================================================

create or replace function public.store_item_base_price(p_item text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(case p_item
    when 'water' then public.game_setting_int('store_water_price', 15)
    when 'fertilizer' then public.game_setting_int('store_fertilizer_price', 45)
    when 'seed' then public.game_setting_int('store_seed_price', 75)
    when 'goose_entry' then public.game_setting_int('store_goose_entry_price', 60)
    else 0 end, 1);
$$;

revoke execute on function public.store_item_base_price(text) from public, anon, authenticated;
