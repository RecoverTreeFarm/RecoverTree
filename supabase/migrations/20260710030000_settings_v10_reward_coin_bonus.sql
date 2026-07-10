-- ============================================================================
-- update_game_settings v10 = v9 (from 20260709240000) + `reward_coin_bonus`,
-- the flat coin amount that rides along with every reward.
--
-- ⚠️ Migration ordering rule: this is now the NEWEST version of the function.
-- Any future migration that recreates it must copy THESE key arrays first.
-- Rather than restating the whole 200-line validator, this migration rebuilds
-- it from the live definition by inserting the one key into number_keys —
-- see the repo copy of 20260709240000 for the full commented body.
-- ============================================================================

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(oid) into v_def
  from pg_proc where proname = 'update_game_settings';

  if v_def is null then
    raise exception 'update_game_settings is missing';
  end if;
  if position('reward_coin_bonus' in v_def) > 0 then
    raise notice 'reward_coin_bonus already allowed — nothing to do';
    return;
  end if;

  -- add the key to the plain non-negative number list
  v_def := replace(
    v_def,
    '''coin_bonus_seed'', ''coin_bonus_fertilizer''];',
    '''coin_bonus_seed'', ''coin_bonus_fertilizer'',
    ''reward_coin_bonus''];');

  execute v_def;
end
$$;

revoke execute on function public.update_game_settings(jsonb) from public, anon;
grant execute on function public.update_game_settings(jsonb) to authenticated;
