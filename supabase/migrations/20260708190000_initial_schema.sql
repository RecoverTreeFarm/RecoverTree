-- ============================================================================
-- Recovery Farm — initial database schema
-- Source of truth: RecoverTree Game Design Document (section 17 + rules
-- throughout). All scoring happens SERVER-SIDE: clients get read-only access
-- to their own data; no client can insert/update fruits, farms, or trees.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helper: keep updated_at fresh
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- profiles — one per auth user
-- ----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  username text not null,
  display_name text,
  avatar_config jsonb not null default '{}'::jsonb,
  bio text,
  role text not null default 'member'
    check (role in ('member', 'meeting_host', 'admin')),
  leaderboard_visibility text not null default 'public'
    check (leaderboard_visibility in ('public', 'anonymous', 'hidden')),
  is_banned boolean not null default false,
  banned_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format
    check (username ~ '^[A-Za-z0-9_]{3,20}$')
);

-- Unique usernames, case-insensitively (Sunny = sunny)
create unique index profiles_username_lower_key on public.profiles (lower(username));

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Clients may create/update their own profile, but must NOT be able to grant
-- themselves roles or un-ban themselves. Supabase runs client requests as the
-- 'authenticated'/'anon' database roles; the server (service role) and the
-- dashboard (postgres) are unaffected.
create or replace function public.protect_privileged_profile_columns()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.role := 'member';
      new.is_banned := false;
      new.banned_reason := null;
    elsif tg_op = 'UPDATE' then
      if new.role is distinct from old.role
         or new.is_banned is distinct from old.is_banned
         or new.banned_reason is distinct from old.banned_reason then
        raise exception 'You cannot change role or ban status.';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_protect_privileged_columns
  before insert or update on public.profiles
  for each row execute function public.protect_privileged_profile_columns();

-- Helper used by RLS policies. SECURITY DEFINER so it can read profiles
-- without tripping over profiles' own RLS (no recursion).
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid() and role = 'admin' and not is_banned
  );
$$;

-- ----------------------------------------------------------------------------
-- seasons — one calendar month each
-- ----------------------------------------------------------------------------
create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'upcoming'
    check (status in ('upcoming', 'active', 'closed')),
  created_at timestamptz not null default now(),
  constraint seasons_dates_valid check (ends_at > starts_at)
);

-- Only one Season can be active at a time
create unique index seasons_one_active_key on public.seasons (status)
  where status = 'active';

-- ----------------------------------------------------------------------------
-- farms — one per user per Season; holds server-maintained totals
-- ----------------------------------------------------------------------------
create table public.farms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  season_id uuid not null references public.seasons (id) on delete cascade,
  fruit_total integer not null default 0 check (fruit_total >= 0),
  fertilizer_count integer not null default 0 check (fertilizer_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint farms_one_per_user_per_season unique (user_id, season_id)
);

create index farms_leaderboard_idx on public.farms (season_id, fruit_total desc);

create trigger farms_set_updated_at
  before update on public.farms
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- trees
-- ----------------------------------------------------------------------------
create table public.trees (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  season_id uuid not null references public.seasons (id) on delete cascade,
  tree_type text not null default 'blueberry'
    check (tree_type in ('blueberry', 'chilli')),
  status text not null default 'active'
    check (status in ('active', 'resting', 'vanished')),
  created_reason text not null default 'starter'
    check (created_reason in
      ('starter', 'seed_received', 'streak', 'badge_reward', 'medal_reward', 'event')),
  fruits_generated integer not null default 0 check (fruits_generated >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index trees_farm_idx on public.trees (farm_id);
create index trees_user_season_idx on public.trees (user_id, season_id);

create trigger trees_set_updated_at
  before update on public.trees
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- fruit_events — append-only ledger; every Fruit award creates a record
-- ----------------------------------------------------------------------------
create table public.fruit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  season_id uuid not null references public.seasons (id) on delete cascade,
  amount integer not null check (amount <> 0),
  source_type text not null
    check (source_type in
      ('meeting_attendance', 'seed_given', 'seed_received', 'streak_bonus',
       'different_hosts_bonus', 'checklist', 'badge', 'medal', 'fertilizer',
       'admin_adjustment')),
  source_id uuid,
  description text,
  created_at timestamptz not null default now()
);

create index fruit_events_user_season_idx on public.fruit_events (user_id, season_id);

-- ----------------------------------------------------------------------------
-- meeting_sessions — host-generated 4-digit codes (only the HASH is stored)
-- ----------------------------------------------------------------------------
create table public.meeting_sessions (
  id uuid primary key default gen_random_uuid(),
  host_user_id uuid not null references auth.users (id) on delete cascade,
  season_id uuid not null references public.seasons (id) on delete cascade,
  code_hash text not null,
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  status text not null default 'active'
    check (status in ('active', 'ended', 'invalidated')),
  created_at timestamptz not null default now(),
  constraint meeting_sessions_expiry_valid check (expires_at > starts_at)
);

-- A host can only have one active code at a time
create unique index meeting_sessions_one_active_per_host_key
  on public.meeting_sessions (host_user_id)
  where status = 'active';

create index meeting_sessions_season_idx on public.meeting_sessions (season_id);

-- ----------------------------------------------------------------------------
-- meeting_attendance — one redemption per user per meeting session
-- ----------------------------------------------------------------------------
create table public.meeting_attendance (
  id uuid primary key default gen_random_uuid(),
  meeting_session_id uuid not null references public.meeting_sessions (id) on delete cascade,
  host_user_id uuid not null references auth.users (id) on delete cascade,
  attendee_user_id uuid not null references auth.users (id) on delete cascade,
  season_id uuid not null references public.seasons (id) on delete cascade,
  attended_at timestamptz not null default now(),
  constraint meeting_attendance_once_per_session
    unique (meeting_session_id, attendee_user_id)
);

create index meeting_attendance_attendee_idx
  on public.meeting_attendance (attendee_user_id, season_id);

-- ----------------------------------------------------------------------------
-- seed_events — one Seed per giver per day; never to yourself
-- ----------------------------------------------------------------------------
create table public.seed_events (
  id uuid primary key default gen_random_uuid(),
  giver_user_id uuid not null references auth.users (id) on delete cascade,
  receiver_user_id uuid not null references auth.users (id) on delete cascade,
  season_id uuid not null references public.seasons (id) on delete cascade,
  given_on_date date not null default current_date,
  created_at timestamptz not null default now(),
  constraint seed_events_one_per_day unique (giver_user_id, given_on_date),
  constraint seed_events_not_self check (giver_user_id <> receiver_user_id)
);

create index seed_events_receiver_idx on public.seed_events (receiver_user_id, season_id);

-- ----------------------------------------------------------------------------
-- checklist_definitions — data-driven monthly goals
-- ----------------------------------------------------------------------------
create table public.checklist_definitions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text,
  fruit_reward integer not null default 0 check (fruit_reward >= 0),
  rule_type text not null,
  config jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- user_checklist_progress
-- ----------------------------------------------------------------------------
create table public.user_checklist_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  season_id uuid not null references public.seasons (id) on delete cascade,
  checklist_definition_id uuid not null references public.checklist_definitions (id) on delete cascade,
  progress_value integer not null default 0 check (progress_value >= 0),
  completed_at timestamptz,
  reward_claimed_at timestamptz,
  constraint user_checklist_progress_unique
    unique (user_id, season_id, checklist_definition_id)
);

-- ----------------------------------------------------------------------------
-- badge_definitions
-- ----------------------------------------------------------------------------
create table public.badge_definitions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text,
  icon text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- season_badge_categories — the 3 categories chosen for a Season
-- ----------------------------------------------------------------------------
create table public.season_badge_categories (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id) on delete cascade,
  badge_definition_id uuid not null references public.badge_definitions (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint season_badge_categories_unique unique (season_id, badge_definition_id)
);

-- ----------------------------------------------------------------------------
-- user_badges
-- ----------------------------------------------------------------------------
create table public.user_badges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  season_id uuid not null references public.seasons (id) on delete cascade,
  badge_definition_id uuid not null references public.badge_definitions (id) on delete cascade,
  awarded_at timestamptz not null default now(),
  constraint user_badges_unique unique (user_id, season_id, badge_definition_id)
);

-- ----------------------------------------------------------------------------
-- user_medals — gold/silver/bronze, one of each per Season
-- ----------------------------------------------------------------------------
create table public.user_medals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  season_id uuid not null references public.seasons (id) on delete cascade,
  medal_type text not null check (medal_type in ('gold', 'silver', 'bronze')),
  rank integer not null check (rank between 1 and 3),
  awarded_at timestamptz not null default now(),
  constraint user_medals_one_per_rank_per_season unique (season_id, rank),
  constraint user_medals_one_per_user_per_season unique (user_id, season_id),
  constraint user_medals_type_matches_rank check (
    (medal_type = 'gold' and rank = 1)
    or (medal_type = 'silver' and rank = 2)
    or (medal_type = 'bronze' and rank = 3)
  )
);

-- ----------------------------------------------------------------------------
-- fertilizer_events — positive = earned, negative = used
-- ----------------------------------------------------------------------------
create table public.fertilizer_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  season_id uuid not null references public.seasons (id) on delete cascade,
  amount integer not null check (amount <> 0),
  reason text not null
    check (reason in ('medal_reward', 'badge_reward', 'used_on_tree', 'admin_adjustment')),
  created_at timestamptz not null default now()
);

create index fertilizer_events_user_idx on public.fertilizer_events (user_id, season_id);

-- ----------------------------------------------------------------------------
-- admin_audit_logs — every admin action is recorded; logs outlive accounts
-- ----------------------------------------------------------------------------
create table public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users (id) on delete set null,
  target_user_id uuid references auth.users (id) on delete set null,
  action text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index admin_audit_logs_created_idx on public.admin_audit_logs (created_at desc);

-- ============================================================================
-- ROW LEVEL SECURITY
--
-- Philosophy: clients READ their own data (plus public profiles and reference
-- data). Clients can WRITE only their own profile. Everything that affects
-- scoring — farms, trees, fruits, attendance, seeds, badges, medals,
-- fertilizer — is written exclusively by the server (service role bypasses
-- RLS), so no client-side scoring is possible.
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.seasons enable row level security;
alter table public.farms enable row level security;
alter table public.trees enable row level security;
alter table public.fruit_events enable row level security;
alter table public.meeting_sessions enable row level security;
alter table public.meeting_attendance enable row level security;
alter table public.seed_events enable row level security;
alter table public.checklist_definitions enable row level security;
alter table public.user_checklist_progress enable row level security;
alter table public.badge_definitions enable row level security;
alter table public.season_badge_categories enable row level security;
alter table public.user_badges enable row level security;
alter table public.user_medals enable row level security;
alter table public.fertilizer_events enable row level security;
alter table public.admin_audit_logs enable row level security;

-- profiles ------------------------------------------------------------------
create policy "profiles: read own, public, or as admin"
  on public.profiles for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or (not is_banned and leaderboard_visibility = 'public')
  );

create policy "profiles: insert own"
  on public.profiles for insert to authenticated
  with check (user_id = auth.uid());

create policy "profiles: update own"
  on public.profiles for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- seasons (read-only reference data) ----------------------------------------
create policy "seasons: readable by members"
  on public.seasons for select to authenticated
  using (true);

-- farms / trees / fruit_events (server-written; read own) --------------------
create policy "farms: read own or as admin"
  on public.farms for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy "trees: read own or as admin"
  on public.trees for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy "fruit_events: read own or as admin"
  on public.fruit_events for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- meetings (codes are created/redeemed server-side only) ---------------------
create policy "meeting_sessions: hosts read own, admins read all"
  on public.meeting_sessions for select to authenticated
  using (host_user_id = auth.uid() or public.is_admin());

create policy "meeting_attendance: attendee, host, or admin"
  on public.meeting_attendance for select to authenticated
  using (
    attendee_user_id = auth.uid()
    or host_user_id = auth.uid()
    or public.is_admin()
  );

-- seeds (server-written) ------------------------------------------------------
create policy "seed_events: giver, receiver, or admin"
  on public.seed_events for select to authenticated
  using (
    giver_user_id = auth.uid()
    or receiver_user_id = auth.uid()
    or public.is_admin()
  );

-- reference data --------------------------------------------------------------
create policy "checklist_definitions: readable when active"
  on public.checklist_definitions for select to authenticated
  using (active or public.is_admin());

create policy "badge_definitions: readable when active"
  on public.badge_definitions for select to authenticated
  using (active or public.is_admin());

-- Badge categories stay secret until the Season closes (ceremony reveal)
create policy "season_badge_categories: revealed after season closes"
  on public.season_badge_categories for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.seasons s
      where s.id = season_id and s.status = 'closed'
    )
  );

-- per-user progress and rewards ------------------------------------------------
create policy "user_checklist_progress: read own or as admin"
  on public.user_checklist_progress for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy "user_badges: read own or as admin"
  on public.user_badges for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy "user_medals: read own or as admin"
  on public.user_medals for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy "fertilizer_events: read own or as admin"
  on public.fertilizer_events for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- audit logs (admin eyes only; written by server) -------------------------------
create policy "admin_audit_logs: admins only"
  on public.admin_audit_logs for select to authenticated
  using (public.is_admin());

-- ============================================================================
-- SEED REFERENCE DATA (from the game document)
-- ============================================================================

insert into public.badge_definitions (key, name, description, icon) values
  ('most_seeds_given', 'Most Seeds Given', 'Gave the most Seeds this Season.', '🌱'),
  ('most_seeds_received', 'Most Seeds Received', 'Received the most Seeds this Season.', '💝'),
  ('most_consistent_seed_giver', 'Most Consistent Seed Giver', 'Gave Seeds most consistently.', '📅'),
  ('most_meetings_attended', 'Most Meetings Attended', 'Attended the most meetings.', '🏆'),
  ('most_different_hosts', 'Most Different Hosts Attended', 'Attended meetings from the most different hosts.', '🧭'),
  ('longest_weekly_streak', 'Longest Weekly Meeting Streak', 'Kept the longest weekly meeting streak.', '🔥'),
  ('perfect_weekly_attendance', 'Perfect Weekly Attendance', 'Attended at least one meeting every week.', '⭐'),
  ('community_builder', 'Community Builder', 'Helped the community grow.', '🤝'),
  ('orchard_starter', 'Orchard Starter', 'Started a thriving orchard.', '🌳'),
  ('barn_raiser', 'Barn Raiser', 'A pillar of the farm community.', '🏠'),
  ('early_bird', 'Early Bird', 'Showed up bright and early.', '🐦'),
  ('night_owl', 'Night Owl', 'Kept the farm going late.', '🦉'),
  ('comeback_farmer', 'Comeback Farmer', 'Came back and kept showing up.', '🌤️'),
  ('most_improved', 'Most Improved From Last Month', 'Grew the most since last Season.', '📈'),
  ('most_supportive', 'Most Supportive Member', 'Lifted others up all Season.', '💛');

insert into public.checklist_definitions (key, name, description, fruit_reward, rule_type, config) values
  ('attend_1', 'Attend 1 meeting', 'Attend your first meeting this Season.', 5, 'meeting_count', '{"target": 1}'),
  ('attend_3', 'Attend 3 meetings', 'Attend 3 meetings this Season.', 10, 'meeting_count', '{"target": 3}'),
  ('attend_5', 'Attend 5 meetings', 'Attend 5 meetings this Season.', 15, 'meeting_count', '{"target": 5}'),
  ('attend_10', 'Attend 10 meetings', 'Attend 10 meetings this Season.', 30, 'meeting_count', '{"target": 10}'),
  ('hosts_3', 'Meet 3 different hosts', 'Attend meetings from 3 different hosts.', 15, 'distinct_hosts', '{"target": 3}'),
  ('hosts_5', 'Meet 5 different hosts', 'Attend meetings from 5 different hosts.', 25, 'distinct_hosts', '{"target": 5}'),
  ('hosts_10', 'Meet 10 different hosts', 'Attend meetings from 10 different hosts.', 50, 'distinct_hosts', '{"target": 10}'),
  ('give_seed_1', 'Give a Seed', 'Send someone a Seed of encouragement.', 5, 'seed_given_count', '{"target": 1}'),
  ('seed_streak_3', 'Give Seeds 3 days in a row', 'Give a Seed three days in a row.', 10, 'seed_given_streak', '{"target": 3}'),
  ('seed_streak_7', 'Give Seeds 7 days in a row', 'Give a Seed seven days in a row.', 25, 'seed_given_streak', '{"target": 7}'),
  ('receive_seed_1', 'Receive a Seed', 'Someone planted a Seed for you.', 5, 'seed_received_count', '{"target": 1}'),
  ('receive_from_3', 'Seeds from 3 members', 'Receive Seeds from 3 different members.', 10, 'distinct_seed_givers', '{"target": 3}'),
  ('weekly_every_week', 'A meeting every week', 'Attend at least 1 meeting every week this Season.', 30, 'weekly_attendance', '{}'),
  ('use_fertilizer_1', 'Use fertilizer', 'Use fertilizer on one of your trees.', 5, 'fertilizer_used', '{"target": 1}'),
  ('finish_streak_tree', 'Finish with a streak tree', 'End the Season with an active streak tree.', 20, 'streak_tree_active', '{}');
