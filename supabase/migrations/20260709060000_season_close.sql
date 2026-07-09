-- ============================================================================
-- Monthly season close
--
-- close_season(): idempotent. Closes the season, awards gold/silver/bronze
-- medals to the top 3 by Fruits (with 3/2/1 fertilizer), randomly picks 3
-- valid badge categories from the MVP pool and awards their winners (+1
-- fertilizer each), then creates the next month's season. Fertilizer is
-- granted on the NEXT season's farm so winners can use it. Badge winners are
-- stored so the ceremony can reveal them.
-- ============================================================================

-- Replace the badge pool with the 15 MVP categories.
delete from public.badge_definitions;
insert into public.badge_definitions (key, name, description, icon, active) values
  ('seed_spreader',       'Seed Spreader',        'Gave the most Seeds.',                       '🌱', true),
  ('beloved_sprout',      'Beloved Sprout',       'Received the most Seeds.',                    '💝', true),
  ('meeting_mouse',       'Meeting Mouse',        'Attended the most meetings.',                 '🐭', true),
  ('host_hopper',         'Host Hopper',          'Attended the most different hosts.',          '🦘', true),
  ('steady_sprout',       'Steady Sprout',        'Best weekly meeting consistency.',            '📅', true),
  ('perfect_little_plant','Perfect Little Plant', 'A meeting every week this month.',            '⭐', true),
  ('barn_raiser',         'Barn Raiser',          'Completed the most checklist goals.',         '🏠', true),
  ('comeback_farmer',     'Comeback Farmer',      'Returned after a quiet stretch.',             '🌤️', true),
  ('tree_whisperer',      'Tree Whisperer',       'Had the most trees at month''s end.',         '🌳', true),
  ('fruit_goblin',        'The Fruit Goblin',     'Earned Fruits from the most sources.',        '👺', true),
  ('quiet_little_farmer', 'Quiet Little Farmer',  'Great Fruits while staying private.',         '🤫', true),
  ('last_minute_turnip',  'Last-Minute Turnip',   'Most Fruits in the final 48 hours.',          '🕛', true),
  ('early_worm_wrangler', 'Early Worm Wrangler',  'Most morning activity.',                      '🐛', true),
  ('night_sprout',        'Night Sprout',         'Most late-night activity.',                   '🦉', true),
  ('golden_potato',       'Golden Potato',        'Randomly picked from 3+ goal finishers.',     '🥔', true);

-- Grant fertilizer to a user's farm in a given season (creates the farm row).
create or replace function public.grant_fertilizer(
  p_user uuid, p_season uuid, p_amount integer, p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.farms (user_id, season_id) values (p_user, p_season)
    on conflict (user_id, season_id) do nothing;
  update public.farms set fertilizer_count = fertilizer_count + p_amount
    where user_id = p_user and season_id = p_season;
  insert into public.fertilizer_events (user_id, season_id, amount, reason)
    values (p_user, p_season, p_amount, p_reason);
end;
$$;

revoke execute on function public.grant_fertilizer(uuid, uuid, integer, text) from public;
revoke execute on function public.grant_fertilizer(uuid, uuid, integer, text) from anon;
revoke execute on function public.grant_fertilizer(uuid, uuid, integer, text) from authenticated;

-- Compute a badge's winner for a season.
-- Returns (winner, valid). valid=false if there is no winner or a >2-way tie,
-- so the caller can pick a different category.
create or replace function public.pick_badge_winner(p_season uuid, p_key text)
returns table (winner uuid, valid boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max numeric;
  v_ties integer;
  v_winner uuid;
  v_ends timestamptz;
  v_weeks integer;
begin
  select ends_at into v_ends from public.seasons where id = p_season;
  select count(distinct date_trunc('week', d))::int into v_weeks
  from generate_series(
    (select starts_at from public.seasons where id = p_season),
    (select ends_at - interval '1 second' from public.seasons where id = p_season),
    interval '1 day') d;

  -- Golden Potato: random among users who finished 3+ checklist goals.
  if p_key = 'golden_potato' then
    select ucp.user_id into v_winner
    from public.user_checklist_progress ucp
    join public.profiles pr on pr.user_id = ucp.user_id and not pr.is_banned
    where ucp.season_id = p_season and ucp.completed_at is not null
    group by ucp.user_id
    having count(*) >= 3
    order by random()
    limit 1;
    return query select v_winner, v_winner is not null;
    return;
  end if;

  drop table if exists _bscores;
  create temp table _bscores (user_id uuid, val numeric);

  if p_key = 'seed_spreader' then
    insert into _bscores select giver_user_id, count(*)
      from public.seed_events where season_id = p_season group by giver_user_id;
  elsif p_key = 'beloved_sprout' then
    insert into _bscores select receiver_user_id, count(*)
      from public.seed_events where season_id = p_season group by receiver_user_id;
  elsif p_key = 'meeting_mouse' then
    insert into _bscores select attendee_user_id, count(*)
      from public.meeting_attendance where season_id = p_season group by attendee_user_id;
  elsif p_key = 'host_hopper' then
    insert into _bscores select attendee_user_id, count(distinct host_user_id)
      from public.meeting_attendance where season_id = p_season group by attendee_user_id;
  elsif p_key = 'steady_sprout' then
    insert into _bscores select attendee_user_id, count(distinct date_trunc('week', attended_at))
      from public.meeting_attendance where season_id = p_season group by attendee_user_id;
  elsif p_key = 'perfect_little_plant' then
    insert into _bscores
      select attendee_user_id, count(distinct date_trunc('week', attended_at))
      from public.meeting_attendance where season_id = p_season
      group by attendee_user_id
      having count(distinct date_trunc('week', attended_at)) >= v_weeks;
  elsif p_key = 'barn_raiser' then
    insert into _bscores select user_id, count(*)
      from public.user_checklist_progress
      where season_id = p_season and completed_at is not null group by user_id;
  elsif p_key = 'comeback_farmer' then
    insert into _bscores
      select user_id, max_gap from (
        select attendee_user_id as user_id, max(gap) as max_gap from (
          select attendee_user_id,
            extract(epoch from (attended_at -
              lag(attended_at) over (partition by attendee_user_id order by attended_at))) / 86400 as gap
          from public.meeting_attendance where season_id = p_season
        ) g group by attendee_user_id
      ) h where max_gap >= 7;
  elsif p_key = 'tree_whisperer' then
    insert into _bscores select user_id, count(*)
      from public.trees where season_id = p_season and status <> 'vanished' group by user_id;
  elsif p_key = 'fruit_goblin' then
    insert into _bscores select user_id, count(distinct source_type)
      from public.fruit_events where season_id = p_season group by user_id;
  elsif p_key = 'quiet_little_farmer' then
    insert into _bscores select f.user_id, f.fruit_total
      from public.farms f join public.profiles p on p.user_id = f.user_id
      where f.season_id = p_season and p.leaderboard_visibility in ('anonymous', 'hidden');
  elsif p_key = 'last_minute_turnip' then
    insert into _bscores select user_id, sum(amount)
      from public.fruit_events
      where season_id = p_season and amount > 0 and created_at >= v_ends - interval '48 hours'
      group by user_id;
  elsif p_key = 'early_worm_wrangler' then
    insert into _bscores select attendee_user_id, count(*)
      from public.meeting_attendance
      where season_id = p_season and extract(hour from attended_at) between 5 and 11
      group by attendee_user_id;
  elsif p_key = 'night_sprout' then
    insert into _bscores select attendee_user_id, count(*)
      from public.meeting_attendance
      where season_id = p_season
        and (extract(hour from attended_at) >= 22 or extract(hour from attended_at) < 5)
      group by attendee_user_id;
  end if;

  -- exclude banned users
  delete from _bscores s using public.profiles p
    where p.user_id = s.user_id and p.is_banned;

  select max(val) into v_max from _bscores where val > 0;
  if v_max is null then
    drop table if exists _bscores;
    return query select null::uuid, false;
    return;
  end if;
  select count(*) into v_ties from _bscores where val = v_max;
  if v_ties > 2 then
    drop table if exists _bscores;
    return query select null::uuid, false;
    return;
  end if;
  select user_id into v_winner from _bscores where val = v_max order by random() limit 1;
  drop table if exists _bscores;
  return query select v_winner, true;
end;
$$;

revoke execute on function public.pick_badge_winner(uuid, text) from public;
revoke execute on function public.pick_badge_winner(uuid, text) from anon;
revoke execute on function public.pick_badge_winner(uuid, text) from authenticated;

-- The season close itself.
create or replace function public.close_season(p_season uuid default null)
returns table (closed_season uuid, next_season uuid, medals_awarded integer, badges_awarded integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season uuid;
  v_next uuid;
  v_starts timestamptz;
  v_medals integer := 0;
  v_badges integer := 0;
  v_chosen integer := 0;
  r record;
  v_medal text;
  v_fert integer;
  v_key text;
  v_win record;
  v_badge_id uuid;
begin
  -- admins (or the SQL editor / service role, where auth.uid() is null) only
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Only admins can close a season';
  end if;

  if p_season is null then
    select id into v_season from public.seasons where status = 'active'
      order by ends_at limit 1;
  else
    v_season := p_season;
  end if;
  if v_season is null then
    raise exception 'No season to close';
  end if;

  -- idempotency: medals already exist → already processed
  if exists (select 1 from public.user_medals where season_id = v_season) then
    select id into v_next from public.seasons
      where starts_at >= (select ends_at from public.seasons where id = v_season)
      order by starts_at limit 1;
    return query select v_season, v_next, 0, 0;
    return;
  end if;

  update public.seasons set status = 'closed' where id = v_season;

  -- next season starts where this one ended
  v_starts := (select ends_at from public.seasons where id = v_season);
  insert into public.seasons (name, starts_at, ends_at, status)
  values (
    trim(to_char(v_starts, 'FMMonth YYYY')),
    v_starts, v_starts + interval '1 month', 'active'
  )
  returning id into v_next;
  perform public.pick_season_checklist(v_next);

  -- MEDALS: top 3 by Fruits
  for r in
    select f.user_id, f.fruit_total,
      row_number() over (order by f.fruit_total desc, f.created_at) as rn
    from public.farms f
    join public.profiles p on p.user_id = f.user_id and not p.is_banned
    where f.season_id = v_season and f.fruit_total > 0
    order by f.fruit_total desc
    limit 3
  loop
    v_medal := case r.rn when 1 then 'gold' when 2 then 'silver' else 'bronze' end;
    v_fert := case r.rn when 1 then 3 when 2 then 2 else 1 end;
    insert into public.user_medals (user_id, season_id, medal_type, rank)
      values (r.user_id, v_season, v_medal, r.rn::int)
      on conflict do nothing;
    perform public.grant_fertilizer(r.user_id, v_next, v_fert, 'medal_reward');
    v_medals := v_medals + 1;
  end loop;

  -- BADGES: shuffle categories, take the first 3 that have a valid winner
  for v_key in
    select key from public.badge_definitions where active order by random()
  loop
    exit when v_chosen >= 3;
    select * into v_win from public.pick_badge_winner(v_season, v_key);
    if v_win.valid then
      select id into v_badge_id from public.badge_definitions where key = v_key;
      insert into public.season_badge_categories (season_id, badge_definition_id)
        values (v_season, v_badge_id) on conflict do nothing;
      insert into public.user_badges (user_id, season_id, badge_definition_id)
        values (v_win.winner, v_season, v_badge_id) on conflict do nothing;
      perform public.grant_fertilizer(v_win.winner, v_next, 1, 'badge_reward');
      v_badges := v_badges + 1;
      v_chosen := v_chosen + 1;
    end if;
  end loop;

  return query select v_season, v_next, v_medals, v_badges;
end;
$$;

revoke execute on function public.close_season(uuid) from public;
revoke execute on function public.close_season(uuid) from anon;
grant execute on function public.close_season(uuid) to authenticated;
