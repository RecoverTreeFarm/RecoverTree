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

## Database / migrations — ✅ all applied
As of 2026-07-09 every migration is applied to the live Supabase project
(`usmtdjmxvbuuwvmzobln`), verified by querying for the objects each one creates:

| Migration | What it adds |
|---|---|
| `20260709100000` | Admin console + `game_settings` (code defaults, DB overrides) |
| `20260709110000` | Traveling Basket |
| `20260709120000` | Basket total-limits + 24h hold / auto-pass |
| `20260709130000` | Blossom trees (`trees.is_blossom`, 2× harvest) |
| `20260709140000` | Admin-renamable house names; fertilizer ripens blossoms first |
| `20260709150000` | Golden Goose Keeper |
| `20260709160000` | Blossom gameplay repair (see caveat below) |

### ⚠️ Migration ordering caveat (important)
`130000`, `140000` and `150000` **each recreate `update_game_settings`**, every
version adding more allowed setting keys. **Applying them out of order downgrades
that function** and silently drops newer keys (e.g. `goose_enabled`). On the live
DB, `150000` had been applied while `130000`/`140000` were skipped; `20260709160000`
re-applies only the blossom *gameplay* pieces (column + `water_my_trees` /
`harvest_my_trees` / `use_fertilizer`) and deliberately **never touches**
`update_game_settings`.

**To verify the DB state at any time**, paste this into the Supabase SQL editor
(pasting SQL there does *not* register in the Migrations tab, so check objects):

```sql
select '100000 admin+settings' m, (to_regclass('public.game_settings') is not null) applied
union all select '110000 basket', (to_regclass('public.traveling_basket_chains') is not null)
union all select '120000 basket-hold', exists(select 1 from pg_proc where proname='basket_do_pass')
union all select '130000 blossom', exists(select 1 from information_schema.columns where table_name='trees' and column_name='is_blossom')
union all select '140000 house-names', exists(select 1 from pg_proc where proname='use_fertilizer' and pg_get_functiondef(oid) ilike '%is_blossom%')
union all select '150000 goose', (to_regclass('public.golden_goose_assignments') is not null)
union all select 'GUARD goose_enabled', exists(select 1 from pg_proc where proname='update_game_settings' and pg_get_functiondef(oid) ilike '%goose_enabled%')
order by 1;
```

## What has been built
- **Auth** (signup/login/logout), **profiles** + Private Mode (public/anonymous/hidden)
- **Seasons** + starter farms; monthly season auto-created
- **Farm loop**: water → 5 grow stages → 4-hour fruit timer → harvest; fertilizer
  ripens a waiting tree; pink blossom trees (~15%) pay 2×
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
- **Scheduled jobs**: season auto-close, Traveling Basket and Golden Goose all
  advance/auto-close **lazily on dashboard load** (there is no cron). Add a
  Supabase cron / edge function so they fire on time when the community is quiet.
- **Auth email**: uses Supabase's built-in mailer (~2/hour). Wire a real email
  provider before a wider launch.
- Optional polish: more badge/checklist rule types; egg-on-farm animation for the
  Golden Goose winner.

## Current known issues / notes
- **Lazy timers**: with no cron, timed events resolve when someone loads the
  dashboard, not exactly on the clock.
- **4×4 farm grid (16 slots)**: older farms with 17–20 trees show only the first 16.
- **Migration ordering**: see the caveat above before re-running any migration.
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
Smoke-test the newly-live **blossom trees**: water a tree to full, and roughly
1 in 7 should turn pink when it starts its fruit timer; harvesting it should pay
**20 Fruits instead of 10**. (You can force it via Admin → Game settings →
Trees & harvest → set blossom chance to 100, then set it back to 15.)

After that, add a **scheduled job** (Supabase cron / edge function) so season
close, the Traveling Basket, and the Golden Goose advance on time instead of
only when someone opens the dashboard.
