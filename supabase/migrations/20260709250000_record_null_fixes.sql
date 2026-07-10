-- ============================================================================
-- Fix: `record := null` does NOT make field access safe in plpgsql — the
-- tuple structure of a never-SELECTed record stays indeterminate, so
-- `v_rec.field` raises 55000. Three functions relied on that pattern:
--
--   * purchase_store_item — broke EVERY non-goose purchase (the audit insert
--     references v_goose.id inside a CASE, and plpgsql binds it regardless).
--   * auto_close_golden_goose_assignments — latent: would break the next
--     goose closure when no provisional pick was saved.
--   * get_general_store_state — latent: would break when the sale is off.
--
-- All three are rewritten with plain scalar variables. No behavior changes.
-- ============================================================================

create or replace function public.purchase_store_item(p_item text, p_sale boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_banned boolean;
  v_enabled boolean := public.game_setting_text('store_enabled', 'true')::boolean;
  v_sale_on boolean := public.game_setting_text('store_sale_enabled', 'true')::boolean;
  v_sale_item text;
  v_sale_pct integer;
  v_price integer;
  v_discount integer := 0;
  v_quantity integer := 1;
  v_season uuid;
  v_farm record;
  v_goose_id uuid;
  v_goose_keeper uuid;
begin
  if v_user is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not v_enabled then raise exception 'STORE_CLOSED'; end if;
  select is_banned into v_banned from public.profiles where user_id = v_user;
  if v_banned is null then raise exception 'NO_PROFILE'; end if;
  if v_banned then raise exception 'BANNED'; end if;
  if p_item not in ('water', 'fertilizer', 'seed', 'goose_entry') then
    raise exception 'ITEM_UNAVAILABLE';
  end if;

  v_price := public.store_item_base_price(p_item);
  if coalesce(p_sale, false) then
    if not v_sale_on then raise exception 'SALE_UNAVAILABLE'; end if;
    select item_key, discount_percent into v_sale_item, v_sale_pct
      from public.store_sale_of_the_day(current_date);
    if v_sale_item is distinct from p_item then raise exception 'SALE_UNAVAILABLE'; end if;
    v_discount := v_sale_pct;
    v_price := greatest(ceil(v_price * (100 - v_discount) / 100.0)::integer, 1);
  end if;

  select id into v_season from public.seasons where status = 'active' order by ends_at limit 1;
  if v_season is null then raise exception 'NO_FARM'; end if;
  select * into v_farm from public.farms
    where user_id = v_user and season_id = v_season
    for update;
  if v_farm.id is null then raise exception 'NO_FARM'; end if;
  if v_farm.coin_count < v_price then raise exception 'NOT_ENOUGH_COINS'; end if;

  -- the goose entry has extra availability rules — validate BEFORE paying
  if p_item = 'goose_entry' then
    select id, keeper_user_id into v_goose_id, v_goose_keeper
      from public.golden_goose_assignments
      where status = 'answer_collection' and now() < answer_collection_ends_at
      order by created_at limit 1
      for update;
    if v_goose_id is null then raise exception 'NO_ACTIVE_GOOSE'; end if;
    if v_goose_keeper = v_user then raise exception 'KEEPER_CANNOT_BUY'; end if;
    if exists (select 1 from public.goose_extra_entries
               where user_id = v_user and assignment_id = v_goose_id) then
      raise exception 'ALREADY_HAVE_ENTRY';
    end if;
  end if;

  -- pay
  update public.farms set coin_count = coin_count - v_price where id = v_farm.id;
  insert into public.coin_events (user_id, season_id, amount, reason)
    values (v_user, v_season, -v_price, 'store_purchase');

  -- grant
  if p_item = 'water' then
    v_quantity := public.store_water_amount();  -- always ≥5 and a multiple of 5
    update public.farms set water_count = water_count + v_quantity where id = v_farm.id;
  elsif p_item = 'fertilizer' then
    update public.farms set fertilizer_count = fertilizer_count + 1 where id = v_farm.id;
    insert into public.fertilizer_events (user_id, season_id, amount, reason)
      values (v_user, v_season, 1, 'store_purchase');
  elsif p_item = 'seed' then
    update public.farms set seed_count = seed_count + 1 where id = v_farm.id;
  elsif p_item = 'goose_entry' then
    insert into public.goose_extra_entries (user_id, assignment_id)
      values (v_user, v_goose_id);
  end if;

  insert into public.store_purchases (user_id, item_key, quantity, coin_cost, discount_percent, metadata_json)
    values (v_user, p_item, v_quantity, v_price, v_discount,
            case when p_item = 'goose_entry'
                 then jsonb_build_object('assignment_id', v_goose_id) end);

  return jsonb_build_object(
    'item_key', p_item,
    'quantity', v_quantity,
    'coins_spent', v_price,
    'coins_left', v_farm.coin_count - v_price);
end;
$$;

revoke execute on function public.purchase_store_item(text, boolean) from public, anon;
grant execute on function public.purchase_store_item(text, boolean) to authenticated;

create or replace function public.get_general_store_state()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_enabled boolean := public.game_setting_text('store_enabled', 'true')::boolean;
  v_sale_on boolean := public.game_setting_text('store_sale_enabled', 'true')::boolean;
  v_sale_item text;
  v_sale_pct integer;
  v_sale_base integer;
  v_sale_price integer;
  v_coins integer := 0;
  v_goose_id uuid;
  v_goose_keeper uuid;
  v_entry_status text;
  v_goose_status text := 'no_event';
begin
  if v_user is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select f.coin_count into v_coins
  from public.farms f
  join public.seasons s on s.id = f.season_id and s.status = 'active'
  where f.user_id = v_user;

  -- goose entry availability
  select id, keeper_user_id into v_goose_id, v_goose_keeper
    from public.golden_goose_assignments
    where status = 'answer_collection' and now() < answer_collection_ends_at
    order by created_at limit 1;
  if v_goose_id is not null then
    if v_goose_keeper = v_user then
      v_goose_status := 'keeper';
    else
      select status into v_entry_status from public.goose_extra_entries
        where user_id = v_user and assignment_id = v_goose_id;
      v_goose_status := case
        when v_entry_status is null then 'available_to_buy'
        when v_entry_status = 'used' then 'used'
        else 'owned' end;
    end if;
  end if;

  if v_sale_on then
    select item_key, discount_percent into v_sale_item, v_sale_pct
      from public.store_sale_of_the_day(current_date);
    -- the sale item must actually be purchasable to be advertised
    if v_sale_item = 'goose_entry' and v_goose_status <> 'available_to_buy' then
      v_sale_item := null;
    end if;
  end if;
  if v_sale_item is not null then
    v_sale_base := public.store_item_base_price(v_sale_item);
    v_sale_price := greatest(ceil(v_sale_base * (100 - v_sale_pct) / 100.0)::integer, 1);
  end if;

  return jsonb_build_object(
    'enabled', v_enabled,
    'coins', coalesce(v_coins, 0),
    'water_amount', public.store_water_amount(),
    'prices', jsonb_build_object(
      'water', public.store_item_base_price('water'),
      'fertilizer', public.store_item_base_price('fertilizer'),
      'seed', public.store_item_base_price('seed'),
      'goose_entry', public.store_item_base_price('goose_entry')),
    'goose_entry_status', v_goose_status,
    'sale', case when v_sale_item is null then null else jsonb_build_object(
      'item_key', v_sale_item,
      'discount_percent', v_sale_pct,
      'base_price', v_sale_base,
      'sale_price', v_sale_price) end);
end;
$$;

revoke execute on function public.get_general_store_state() from public, anon;
grant execute on function public.get_general_store_state() to authenticated;

create or replace function public.auto_close_golden_goose_assignments()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_sub_id uuid;
  v_sub_user uuid;
  v_auto boolean := public.game_setting_text('goose_auto_select_enabled', 'true')::boolean;
  v_keeper_reward integer := greatest(public.game_setting_int('goose_keeper_completion_reward_amount', 1), 0);
begin
  for c in
    select * from public.golden_goose_assignments
    where status in ('answer_collection', 'selection_open')
      and now() >= selection_deadline_at
    for update
  loop
    v_sub_id := null;
    v_sub_user := null;

    -- the Keeper's saved favorite, if it is still valid
    if c.selected_submission_id is not null then
      select s.id, s.user_id into v_sub_id, v_sub_user
      from public.golden_goose_submissions s
      join public.profiles p on p.user_id = s.user_id and not p.is_banned
      where s.id = c.selected_submission_id
        and s.assignment_id = c.id and not s.is_deleted;
    end if;

    if v_sub_id is not null then
      perform public.goose_award_egg(c.id, v_sub_user, c.season_id);
      update public.golden_goose_submissions set selected_at = now() where id = v_sub_id;
      if v_keeper_reward > 0 and c.keeper_user_id is not null then
        perform public.goose_credit(c.id, c.keeper_user_id, c.season_id, 'fertilizer',
          v_keeper_reward, 'keeper_completion_fertilizer');
        perform public.goose_credit(c.id, c.keeper_user_id, c.season_id, 'coin',
          public.coin_bonus_for(0, v_keeper_reward), 'keeper_completion_coin');
      end if;
      update public.golden_goose_assignments
        set status = 'completed', auto_selected = false, completed_at = now(), expired_at = now()
        where id = c.id;
      continue;
    end if;

    -- no (valid) pick saved: fall back to a random valid submission
    select s.id, s.user_id into v_sub_id, v_sub_user
    from public.golden_goose_submissions s
    join public.profiles p on p.user_id = s.user_id and not p.is_banned
    where s.assignment_id = c.id and not s.is_deleted
    order by random()
    limit 1;

    if v_auto and v_sub_id is not null then
      perform public.goose_award_egg(c.id, v_sub_user, c.season_id);
      update public.golden_goose_submissions set selected_at = now() where id = v_sub_id;
      update public.golden_goose_assignments
        set status = 'auto_completed', auto_selected = true,
            selected_submission_id = v_sub_id, completed_at = now(), expired_at = now()
        where id = c.id;
    else
      update public.golden_goose_assignments
        set status = 'expired_no_submissions', expired_at = now()
        where id = c.id;
    end if;

    perform public.goose_exclude_keeper(c.keeper_user_id);
  end loop;
end;
$$;

revoke execute on function public.auto_close_golden_goose_assignments() from public, anon, authenticated;
