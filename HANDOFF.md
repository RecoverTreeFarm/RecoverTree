# RecoverTree — Handoff

A cute, nostalgic pixel-art web app that acts as a **gamified companion** for a
recovery community. It does **not** host chat or meetings — people meet on their
own tools (WhatsApp, Signal, Google Meet). RecoverTree tracks participation
through a small farming game. Source of truth for design: `RecoverTree.Game
Design Document.rtf`.

## Tech
- **Next.js 16** (App Router, `src/proxy.ts` for session refresh — not `middleware`)
- **TypeScript + Tailwind v4**
- **Supabase** (Postgres + Auth + Row Level Security) via `@supabase/ssr`
- Custom pixel-styled components in `src/components/pixel/` (no shadcn)
- Run locally: `npm run dev`, open **http://localhost:3000**

## ⚠️ Most important project rule — the economy
**Fruits are the score, and Fruits ONLY come from harvesting trees.**
Everything else gives one of three currencies — **Seeds, Water, or Fertilizer** —
never Fruits:
- Attending a meeting → **Water**
- Hosting a meeting → **Water**
- Giving a Seed → giver gets **Water**; receiver gets a plantable **Seed**
- Completing a checklist goal → **Water + Fertilizer**
- Winning a medal/badge at month-end → **Fertilizer**
- Using **Fertilizer** ripens a waiting tree (still must be harvested for Fruits)

If you ever add a reward, it must be Seed / Water / Fertilizer — not Fruits.

## Other core rules
- All scoring is **server-side only** (Supabase SECURITY DEFINER functions +
  RLS). Clients can read their own data but cannot write scores.
- **Private Mode**: `public` (shown normally), `anonymous` (shown as
  "Anonymous Farmer"), `hidden` (off public boards). Enforced in DB, respected
  everywhere including the ceremony.
- **Watering**: each plant drinks its **own 10 water per stage** (5 plants = 50
  water); oldest plants drink first if water is short. Stages 1→4 by water;
  stage 4 starts a **real 4-hour timer** before fruit (stage 5).
- Meeting codes: 4-digit, 90-minute life, one active per host, no early end.
- Seeds: one per giver per day, never to yourself.
- Season close is **idempotent** (running it twice does not duplicate awards).

## What has been built (phases 1–9)
- App shell + all pages, nostalgic pixel style, sound effects + mute toggle
- Supabase connection; **Auth**: signup / login / logout; `/debug/auth`
- Full **database schema** with RLS (migrations in `supabase/migrations/`)
- **Profiles** + Private Mode; profile pages; settings
- **Seasons** + starter farms; monthly season auto-created
- **Meeting host** page (code generation) + **meeting-code** redemption
- **Seeds** system (send daily seed, plant received seeds)
- **Farm loop**: water → grow (5 stages) → 4-hour fruit timer → harvest;
  fertilizer ripens; farmer walk/water/harvest animations; particle FX
- 20-slot tree grid (dark circles mark empty slots); barn shows a fruit crate
  per 40 Fruits; bearing trees show 3 fruit sprites of one kind (visual only)
- **Leaderboard** (by Fruits, Private-Mode-safe) + dashboard preview
- **Monthly checklist**: 6 random shared goals per season, reshuffled monthly
- **Season close engine**: top-3 medals (+3/2/1 fertilizer), 3 random badge
  categories from a 15-badge pool (skips no-winner/>2-way-tie), +1 fertilizer
  per badge, creates next season
- **Ceremony** at `/ceremony/[seasonId]` — Spotify-Wrapped style: podium rise
  (height ∝ Fruits) → MVP silhouette reveals → personal recap, with looping
  ceremony music

## What still needs to be built
- **Admin page** (`/admin` exists as a placeholder): manage users, assign/remove
  Meeting Host role, ban/unban, invalidate codes, view audit logs
- **Auto-close seasons**: a scheduled job (Supabase cron / edge function) to run
  `close_season()` on the 1st of each month. Today it's admin/manual only.
- **Server-side role gating for `close_season`** is present (admins only); still
  needs a real admin UI/trigger to call it in production.
- Optional polish: reskin UI with the added UI sprite packs; more badge rule
  types; weekly-resetting checklist goals; email provider for auth (currently
  Supabase's built-in email, ~2/hour rate limit).

## Current known issues / notes
- **Manual season close**: seasons only close when `close_season()` is run (e.g.
  in the Supabase SQL editor: `select close_season();`). No automation yet.
- Auth email confirmation uses Supabase's built-in mailer (low rate limit); for
  testing you can disable "Confirm email" in Supabase Auth settings.
- Raw asset source folders (`Spritesheets/`, `SoundFX/`, `8BitMusic/`, ~47MB)
  are committed alongside the app-used copies in `public/`. Consider
  git-ignoring the raw folders later to slim the repo (the app only needs
  `public/`).
- `/debug/auth` is a temporary developer page — delete before a real launch.
- Test accounts (dev): `sunny_tester` and `FriendlyPal` exist in Supabase.

## Secrets / safety
- `.env.local` holds the Supabase URL + **publishable** key and is git-ignored.
- The publishable key is browser-safe by design and is only read via
  `process.env` — never hardcoded.
- **No** service-role/secret keys, DB passwords, or API secrets are in the repo.

## Next recommended step
Build the **Admin page** (role management, ban/unban, audit log) — it's the last
placeholder route and unblocks safely running the app with a real community.
After that, add a **scheduled auto-close** so seasons roll over on their own.

---

## Update — 2026-07-09 session (phases 10+)

A large batch of features landed. **All the Supabase migrations below are new
and must be applied** (the MCP was network-unreachable during the session, so
they were written but not auto-applied — run each in the Supabase SQL editor,
in filename order):

- `20260709100000_admin_and_game_settings.sql` — Admin console + `game_settings`
  (code defaults + DB overrides), admin functions (roles/ban/invalidate/audit),
  reward amounts made settings-driven.
- `20260709110000_traveling_basket.sql` — Traveling Basket event.
- `20260709120000_basket_hold_and_limits.sql` — basket total-limits + 24h
  hold/auto-pass + water-floor-to-receive.
- `20260709130000_blossom_trees.sql` — `trees.is_blossom`; ~15% pink blossom
  trees pay **2× on harvest** (harvest-only; multiplier, not a direct award).
- `20260709140000_house_names_and_fert_priority.sql` — admin-renamable house
  names (default big barn = **Bando Barn**); fertilizer ripens blossoms first.
- `20260709150000_golden_goose.sql` — **Golden Goose Keeper** event (see below).

**What was added, app-side:**
- **Admin console** (`/admin`) — Users / Meetings / Golden Goose / Game settings
  / Audit log, all `is_admin()`-gated + audit-logged.
- **Cozy visual swap** — all art now from `CozySpriteBundle/`: 10 composited
  farmer variants (avatar picker), cozy ground/trees/barn, real fruit icons.
- **Game-shell dashboard** — farm is the main canvas; a fixed bottom menu opens
  everything else (Items / Code / Seed / Basket / Goose / Goals / Leaders /
  Profile) in windows (bottom sheets on mobile). Tap a plant for contextual
  actions; inventory items are click-to-use. Notification center + Plant-Seed
  callout over the farm. Retro text tree-timers. Muted cozy palette.
- **Selectable houses** — stored in `profiles.avatar_config.house` (no migration
  for that part). Public profile shows the farmer in front of their house.
- **Affirmation greeting** — from `affirmations.rtf` (104 lines).

**Golden Goose Keeper** (trust-based; app never shows the question):
- On a Goose day (default 7 random days/wk) one fair-lottery Keeper (fewest
  prior turns) gets the goose. 24h Answer Collection → 24h Selection. Members
  submit answers in-app (anonymous to the Keeper); Keeper picks a favorite →
  that author gets a **Golden Goose Egg** (1 seed + 1 fertilizer + 10 water,
  configurable) and the Keeper gets 1 fertilizer for finishing in time.
  Auto-selects at 48h (Keeper then takes a gentle 2-month break from selection).
  Keeper can "Not today" (pass) with no penalty. Public opted-in users only.
  Fully configurable in Admin → Game settings (Golden Goose). No Fruits awarded.

**Economy rule still holds everywhere:** direct rewards are only Water / Seed /
Fertilizer; Fruits come only from harvesting trees.
