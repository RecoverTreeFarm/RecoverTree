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
- A **cherry blossom tree** pays **2× on harvest** — a harvest multiplier, still
  Fruits-from-harvest only

If you ever add a reward, it must be Seed / Water / Fertilizer — never Fruits.
The ONLY functions that create Fruits are `harvest_my_trees` and
`harvest_one_tree`. All scoring is **server-side only** (Supabase SECURITY
DEFINER functions + RLS); clients can read their own data but cannot write
scores. Admin debug tools deliberately cannot grant Fruits.

## Database / migrations — ✅ all applied
Every migration is applied to the live Supabase project (`usmtdjmxvbuuwvmzobln`)
and was verified by querying the objects it creates. **Nothing is waiting to be
run by hand.**

| Migration | What it adds |
|---|---|
| `20260709100000` | Admin console + `game_settings` (code defaults, DB overrides) |
| `20260709110000` | Traveling Basket |
| `20260709120000` | Basket total-limits + 24h hold / auto-pass |
| `20260709130000` | Blossom trees (`trees.is_blossom`, 2× harvest) |
| `20260709140000` | Admin-renamable house names; fertilizer ripens blossoms first |
| `20260709150000` | Golden Goose Keeper |
| `20260709160000` | Blossom gameplay repair |
| `20260709170000` | Named season cycle, `close_season` repair, pg_cron scheduling |
| `20260709180000` | Admin debug tools (`debug_settings_enabled`, off by default) |
| `20260709190000` | Single-tree actions (water/fertilize/harvest ONE tree) |
| `20260709200000` | `bulletin_posts` (homepage notice board) + admin RPCs |

### ⚠️ Migration ordering caveat (still important)
`130000`, `140000`, `150000`, `170000` and `180000` **each recreate
`update_game_settings`**, every version adding more allowed setting keys.
Applying an older one on top silently drops newer keys. **The newest version
lives in `20260709180000`** — any future migration that touches this function
must copy ITS allowed-key arrays first.

Verify DB state any time (paste into the Supabase SQL editor):

```sql
select 'game_settings' m, (to_regclass('public.game_settings') is not null) ok
union all select 'basket', (to_regclass('public.traveling_basket_chains') is not null)
union all select 'goose', (to_regclass('public.golden_goose_assignments') is not null)
union all select 'bulletin', (to_regclass('public.bulletin_posts') is not null)
union all select 'season cycle', exists(select 1 from information_schema.columns where table_name='seasons' and column_name='cycle_position')
union all select 'single-tree actions', exists(select 1 from pg_proc where proname='harvest_one_tree')
union all select 'debug tools', exists(select 1 from pg_proc where proname='debug_set_inventory')
union all select 'cron tick', exists(select 1 from cron.job where jobname='recovertree-game-tick')
union all select 'GUARD goose_enabled', exists(select 1 from pg_proc where proname='update_game_settings' and pg_get_functiondef(oid) ilike '%goose_enabled%')
union all select 'GUARD debug key', exists(select 1 from pg_proc where proname='update_game_settings' and pg_get_functiondef(oid) ilike '%debug_settings_enabled%')
order by 1;
```

## What has been built
- **Auth** (signup/login/logout), **profiles** + Private Mode (public/anonymous/hidden).
  Logged-in visitors to `/` are redirected to `/dashboard`; the landing page is
  logged-out only.
- **Named season cycle** — five 30-day seasons loop forever: **Sparch → Maypril →
  Junduly → Suntember → Octobrrr → Sparch…** Every community starts on Sparch.
  Admins can rename each season and change each length; edits apply to the
  running season immediately. To end a season early, shorten its length.
- **Scheduled jobs** — `pg_cron` runs `run_scheduled_game_jobs()` every 10
  minutes: season ceremony (`close_season`), Basket auto-advance, Goose
  auto-close. The old lazy dashboard-load paths remain as a fallback.
- **Farm loop** — water → 5 visibly distinct grow stages → 4-hour fruit timer →
  harvest. Tapping ONE plant waters/fertilizes/harvests only that plant (the
  action button becomes an in-place ⏭ Skip). Applying an item to the whole farm
  is only possible from the top inventory bar or the backpack, which use a
  two-step "Water all?" confirm. During bulk watering each tree grows the moment
  the farmer finishes watering it.
- **Cherry blossom trees** (~15%) pay 2× on harvest, have their own sprite,
  drifting petal particles and a chime. **Cherries only ever appear on cherry
  trees.**
- **Meetings** — host generates a 4-digit code; members redeem it for Water.
- **Seeds** — give a daily Seed (giver Water, receiver a plantable Seed).
- **Seasonal checklist** (random shared goals) + **season-close ceremony**
  (medals/badges) with a blue-sky, brown-ground cinematic showing your house.
- **Traveling Basket** — travels farmer-to-farmer with a 24h hold/auto-pass.
  When you hold it, it appears **on your farm** (pulsing, with a "!"); tap it and
  the farmer walks over before the panel opens.
- **Golden Goose Keeper** — trust-based event. The Keeper sees the goose on
  their farm during the first 24h; everyone else sees a pulsing golden
  **"Golden Goose"** box to submit an anonymous answer. Afterwards the goose
  leaves and the box moves to the Keeper to pick a favorite. Egg = 1 seed +
  1 fertilizer + 10 water.
- **Admin console** (`/admin`) — Users, Meetings, **Bulletin**, Game settings,
  (optional) Debug, Audit log. Every admin action is audit-logged.
- **Homepage notice board** — admins add / schedule / remove posts
  (Announcement, Update, Event) with a game-sprite image. Scheduling is a future
  `publish_at`; RLS hides unpublished posts from the public.
- **In-game Guidebook** — a "?" button opens 13 cozy chapters, incl. a
  Report-a-Bug placeholder.
- **World map** — a placeholder viewer opened from the bottom menu.
- **Cozy game-shell dashboard** — the farm is the canvas; a fixed bottom menu
  opens everything else in windows. Clicking bare grass walks the farmer there;
  he can't stand on the house. Event objects are depth-sorted like a 2D game.

## What still needs to be built
- **Auth email** — uses Supabase's built-in mailer (~2/hour). Wire a real email
  provider before a wider launch, and enable **leaked-password protection** in
  Supabase Auth (currently off, one click).
- **Bug reports don't send.** The Guidebook's Report-a-Bug form is a placeholder.
  The recipient lives in one constant, `BUG_REPORT_EMAIL` in `src/lib/wiki.ts`.
- **Cherry blossom sound** is borrowing `reveal.ogg`. Drop a
  `public/sfx/cherry.ogg` in and change `CHERRY_SFX` in `src/lib/sfx.ts`.
- Optional polish: more badge/checklist rule types; egg-on-farm animation for
  the Golden Goose winner; interactive map locations.

## Current known issues / TODOs
- **⚠️ Watch full-screen overlays on the farm.** The Golden Goose swoops across
  the whole play area, so its wrapper is `absolute inset-0`. It MUST keep
  `pointer-events-none`, with `pointer-events-auto` on the goose button itself.
  Dropping that once (commit `437f3c2`) turned it into an invisible sheet over
  the farm and made trees and grass unclickable **for the Keeper only** — the
  one person who sees the goose. Fixed in `829966d`. Any future farm overlay
  (egg animation, weather, confetti) needs the same treatment.
- **TODO(selected-hole planting)** — `plant_seed` always fills the NEXT open
  plot, so a seed lands in the first free hole, not necessarily the one you
  tapped. Honouring the tapped hole needs a `plant_seed(p_slot)` RPC and a slot
  column on `trees`. The farmer walks to the plot the seed really lands in, so
  the animation never lies.
- **The Golden Goose Keeper cannot change their pick.**
  `select_golden_goose_winner` awards the egg, pays the Keeper's fertilizer, and
  marks the event `completed` on the FIRST pick; a second call is refused. The
  box now stays on their farm until the selection deadline so they can reopen the
  review screen, but real re-picking would require changing the reward rules
  (deferring the egg award to the deadline). **Ask before doing this.**
- `water_my_trees` (the old bulk RPC) is no longer called by the UI — bulk
  watering now loops `water_one_tree` so each tree grows individually. The old
  function still exists in the database.
- **Lint** reports a small pre-existing baseline: 9 problems, 3 errors
  (`Date.now()` purity in `FarmPanel`, and setState-in-effect in `debug/auth`
  and `CeremonyShow`). Typecheck and `next build` are clean.
- `/debug/auth` is a temporary developer page — delete before a real launch.
- Dev data is not real: test accounts `sunny_tester` / `FriendlyPal` have
  hand-edited inventories, trees, and goose state from testing.
- `public/sprites/seasons/*.png` are unused (the season header uses emojis).
- The ~31 MB `Spritesheets/More Farming Sprites/` download is intentionally left
  untracked.

## Secrets / safety
- `.env.local` holds the Supabase URL + **publishable** key and is git-ignored
  (verified: no `.env*` file is tracked except `.env.example`, which contains
  only placeholders).
- The publishable key is browser-safe by design and only read via `process.env`.
- **No** service-role/secret keys, DB passwords, or API secrets are in the repo.
- Admin **debug tools are OFF** in the live database and are double-gated
  (admin role AND the `debug_settings_enabled` setting).

## How to sanity-check the farm after any UI change
Log in as the **Keeper** of an active Golden Goose event (not just any account —
the goose only renders for them) and confirm you can still:
tap a tree → the action menu opens; click bare grass → the farmer walks;
tap the goose → he walks over and the panel opens. A quick DOM probe:
`document.elementFromPoint(x, y)` over a tree should return the tree, never a
full-screen wrapper.

## Next recommended step
**Pick one of the two open questions above**, because both change behavior the
players will notice:

1. Decide whether the Golden Goose Keeper should be able to **change their
   favorite answer** before the deadline. If yes, that's a migration that defers
   the egg award — a reward-rule change, so it needs your explicit go-ahead.
2. Decide whether a seed should land in the **exact hole you tap**. If yes, add
   `plant_seed(p_slot)` + a slot column on `trees`.

If you'd rather ship than build: enable **leaked-password protection** in
Supabase Auth and wire a real email provider — those are the only things
standing between this and letting real members in.
