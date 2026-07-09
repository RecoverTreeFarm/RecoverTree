# RecoverTree — Handoff

A cute, nostalgic **cozy pixel-art web app** that acts as a **gamified companion**
for a recovery community. It does **not** host chat or meetings — people meet on
their own tools (WhatsApp, Signal, Google Meet). RecoverTree celebrates showing
up, through a small farming game. Source of truth for design: `RecoverTree.Game
Design Document.rtf`.

## Tech
- **Next.js 16** (App Router; `src/proxy.ts` refreshes the session — not `middleware`)
- **TypeScript + Tailwind v4**
- **Supabase** (Postgres + Auth + Row Level Security) via `@supabase/ssr`
- Custom cozy pixel components in `src/components/` (no shadcn)
- Art from `CozySpriteBundle/` (source), generated into `public/sprites/`
- Run locally: `npm run dev`, open **http://localhost:3000**

## ⚠️ Most important project rule — the economy
**Fruits are the score, and Fruits ONLY come from harvesting trees.**
Every other reward is one of three currencies — **Seed, Water, or Fertilizer** —
**never Fruits**:
- Attend/host a meeting → **Water**
- Give a Seed → giver gets **Water**; receiver gets a plantable **Seed**
- Complete a checklist goal → **Water + Fertilizer**
- Traveling Basket / Golden Goose rewards → **Water / Seed / Fertilizer** only
- Use **Fertilizer** to ripen a waiting tree (still must be harvested for Fruits)
- A pink **blossom tree** pays **2× on harvest** — a harvest multiplier, still Fruits-from-harvest only

If you ever add a reward, it must be Seed / Water / Fertilizer — never Fruits.
All scoring is **server-side only** (Supabase SECURITY DEFINER functions + RLS);
clients can read their own data but cannot write scores.

## ⚠️ Migrations to apply (do this first)
The Supabase MCP was network-unreachable during recent work, so these migrations
were **written but not applied**. Apply each in the **Supabase SQL editor**, in
filename order, before relying on the newer features:
1. `20260709100000_admin_and_game_settings.sql`
2. `20260709110000_traveling_basket.sql`
3. `20260709120000_basket_hold_and_limits.sql`
4. `20260709130000_blossom_trees.sql`
5. `20260709140000_house_names_and_fert_priority.sql`
6. `20260709150000_golden_goose.sql`

The app is written to degrade gracefully if a migration isn't applied yet (the
related panel hides or shows an "isn't set up yet" note instead of crashing).

## What has been built
- **Auth** (signup/login/logout), **profiles** + Private Mode (public/anonymous/hidden)
- **Seasons** + starter farms; monthly season auto-created
- **Farm loop**: water → 5 grow stages → 4-hour fruit timer → harvest; fertilizer
  ripens a waiting tree; blossom trees (~15%) pay 2×
- **Meetings**: host generates a 4-digit code; members redeem it for Water
- **Seeds**: give a daily Seed (giver Water, receiver a plantable Seed)
- **Monthly checklist** (random shared goals) + **season-close ceremony** (medals/badges)
- **Traveling Basket** — a community basket travels farmer-to-farmer with a 24h
  hold/auto-pass; keep it for double or pass it on; locks in for everyone at target
- **Golden Goose Keeper** — trust-based event: a fair-lottery Keeper asks a
  question in the group chat (app never shows it); members submit anonymous
  answers; Keeper picks a favorite → Golden Goose Egg (1 seed + 1 fertilizer +
  10 water); 48h idempotent auto-select; gentle 2-month exclusion on a miss
- **Admin console** (`/admin`) — Users, Meetings, Golden Goose, Game settings
  (all defaults admin-editable), Audit log; every admin action is audit-logged
- **Cozy game-shell dashboard** — the farm is the main canvas; a fixed bottom
  menu opens everything else in windows (bottom sheets on mobile). Tap a plant
  for actions; click-to-use inventory; notification center; selectable house;
  affirmation greeting; muted earthy palette

## What still needs to be built
- **Apply the migrations above** (nothing new works until they're applied)
- **Scheduled jobs**: season auto-close, Traveling Basket, and Golden Goose all
  advance/auto-close **lazily on dashboard load** (no cron). Add a Supabase cron
  / edge function to fire them on time if the community is quiet.
- **Auth email**: uses Supabase's built-in mailer (~2/hour). Wire a real email
  provider before a wider launch.
- Optional polish: more badge/checklist rule types; egg-on-farm animation for the
  Golden Goose winner; goose fully wired to a real scheduler.

## Current known issues / notes
- **Lazy timers**: with no cron, timed events resolve when someone loads the
  dashboard, not exactly on the clock.
- **4×4 farm grid (16 slots)**: older farms with 17–20 trees show only the first 16.
- **Lint** reports a small pre-existing baseline (`Date.now()` purity, `<img>`
  hints) — typecheck and `next build` are clean.
- `/debug/auth` is a temporary developer page — delete before a real launch.
- Test accounts (dev): `sunny_tester` and `FriendlyPal` exist in Supabase.
- The unused ~31 MB `Spritesheets/More Farming Sprites/` download is intentionally
  left untracked (not used by the app).

## Secrets / safety
- `.env.local` holds the Supabase URL + **publishable** key and is git-ignored.
- The publishable key is browser-safe by design and is only read via `process.env`.
- **No** service-role/secret keys, DB passwords, or API secrets are in the repo.

## Next recommended step
**Apply the six pending migrations in the Supabase SQL editor**, then smoke-test
each new area (admin settings, Traveling Basket, blossom trees, Golden Goose).
After that, add a **scheduled job** (Supabase cron/edge function) so season
close, the Basket, and the Golden Goose advance on time instead of only on
dashboard visits.
