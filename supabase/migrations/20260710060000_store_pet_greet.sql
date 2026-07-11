-- ============================================================================
-- Store pet (the shop yorkie) — pat it for the same once-a-day water bonus
-- you get from greeting a neighbor (+10 water, a multiple of 5).
--
-- Kept in its OWN table rather than neighbor_greetings so patting the dog
-- never counts toward the "greet 3 neighbors" checklist goal, and so it can't
-- collide with a real store greeting the same day. Water only — no Fruits,
-- no Coins. Server-enforced once per user per day.
-- ============================================================================

create table public.store_pet_greetings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  greeted_on_date date not null default current_date,
  water_awarded integer not null default 10 check (water_awarded % 5 = 0),
  created_at timestamptz not null default now(),
  constraint store_pet_greetings_daily unique (user_id, greeted_on_date)
);

alter table public.store_pet_greetings enable row level security;
create policy "store_pet_greetings: own"
  on public.store_pet_greetings for select to authenticated
  using (user_id = auth.uid());
-- no client write policy — only the SECURITY DEFINER function below inserts.

create or replace function public.greet_store_pet()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_banned boolean;
  v_season uuid;
  v_water integer := 10;  -- always a multiple of 5
begin
  if v_user is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select is_banned into v_banned from public.profiles where user_id = v_user;
  if v_banned is null then raise exception 'NO_PROFILE'; end if;
  if v_banned then raise exception 'BANNED'; end if;

  begin
    insert into public.store_pet_greetings (user_id, water_awarded)
      values (v_user, v_water);
  exception when unique_violation then
    raise exception 'ALREADY_GREETED_TODAY';
  end;

  select id into v_season from public.seasons where status = 'active'
    order by ends_at limit 1;
  if v_season is not null then
    update public.farms set water_count = water_count + v_water
      where user_id = v_user and season_id = v_season;
  end if;

  return jsonb_build_object('water_earned', v_water);
end;
$$;

revoke execute on function public.greet_store_pet() from public, anon;
grant execute on function public.greet_store_pet() to authenticated;
