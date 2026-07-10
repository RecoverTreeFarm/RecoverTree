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
Every other reward is one of four currencies — **Seed, Water, Fertilizer, or
Coins 🪙** — **never Fruits**. Coins (added 2026-07-09) MAY be awarded
directly, but they **never count toward the leaderboard** (that still ranks
`fruit_total` only) and are for future shop/cosmetic spending (no shop yet):
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
| `20260709210000` | Golden Goose deferred pick (Keeper can change favorite until deadline) |
| `20260709220000` | Community Garden (shared weekly event) + `update_game_settings` v7 |
| `20260709230000` | Coins 🪙 (`farms.coin_count`, `coin_events` ledger, rewards everywhere) + v8 |
| `20260709240000` | General Store 🏪, Xtra Goose Entry, ceremony invites, garden greetings, water %5 rule + v9 |
| `20260709250000` | Fix: plpgsql `record := null` field-access bug in 3 fns from 240000/210000 |
| `20260710000000` | Generic `location_presence`/`neighbor_greetings`, checklist `coin_reward`, `profiles.music_enabled` |
| `20260710010000` | Store prices +50% (15/45/75/60) |
| `20260710020000` | KudoSeed messages, flat `reward_coin_bonus` on every reward, 7 new monthly goals |
| `20260710030000` | `update_game_settings` **v10** (+ `reward_coin_bonus`) |

### ⚠️ Migration ordering caveat (still important)
`130000`, `140000`, `150000`, `170000`, `180000`, `220000`, `230000` and
`240000` **each recreate `update_game_settings`**, every version adding more
allowed setting keys. Applying an older one on top silently drops newer keys.
**The newest version lives in `20260710030000`** (v10) — it rebuilds the
function from `pg_get_functiondef` and injects one key, so it inherits every
older key automatically. A future migration that RESTATES the function must
copy the live v10 arrays first.

### ⚠️ plpgsql gotcha (bit us in 240000)
`v_rec := null;` on a declared-but-never-SELECTed `record` does NOT make
`v_rec.field` safe — the tuple structure stays indeterminate and raises 55000
*even when the reference sits in an untaken CASE branch* (plpgsql binds every
variable in a SQL statement). Use scalar variables for maybe-unassigned data.
`20260709250000` fixed the three functions that had this.

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
union all select 'GUARD garden key', exists(select 1 from pg_proc where proname='update_game_settings' and pg_get_functiondef(oid) ilike '%garden_enabled%')
union all select 'garden', (to_regclass('public.community_garden_events') is not null)
union all select 'goose deferred pick', exists(select 1 from pg_proc where proname='select_golden_goose_winner' and pg_get_functiondef(oid) ilike '%provisional%')
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
- **World map + travel** — the map (bottom menu) has two destinations:
  the **Community Garden** and **Your RecoverTree Farm**. Traveling between
  locations plays a ~2.3s **walking cinematic** (`TravelCinematic.tsx`:
  parallax trees/flowers, jingle) before the scene swaps. `GameShell` holds a
  `location` state ("farm" | "garden"); the bottom-menu Farm button travels
  home when you're out.
- **Community Garden** — a weekly collaborative event (Monday→Sunday, auto-
  started; `garden_frequency` can be set to `manual` for admin-started events).
  It is a **walkable location** (not a popup): click grass to walk your
  farmer; visitors' farmers idle around (60s presence ping; public = named,
  anonymous = darkened "A neighbor", hidden = not shown; 5-min timeout walks
  them off screen). Everyone contributes Water/Seeds/Fertilizer toward one
  giant shared tree (5 visual stages by combined progress; fully bloomed =
  the pink community tree with petals). Clicking the **donation box** walks
  the farmer over, then opens a **closeup of the crate** — added items
  visibly drop in with a sound + sparkle. Daily per-person limits only. When
  all three goals are met, every contributor gets a **Garden Share Bundle**
  (25💧 / 2🌰 / 1✨ / 15🪙 — settings-driven, never Fruits). A partial reward
  (10💧 + 5🪙 at ≥50%) exists but is **OFF by default**. Admin: Garden tab
  (start/end/distribute) + a Community Garden settings section.
- **Coins 🪙** — fourth currency (`farms.coin_count`, `coin_events` ledger,
  `grant_coins`/`coin_bonus_for` helpers). Never below 0, never leaderboard.
  Awarded by: Garden bundle (15/5), ceremony medals (gold 100 / silver 60 /
  bronze 35 — `medal_coin_*` settings, no bonus stacking), and the automatic
  bonus rule: any reward granting Seeds also grants `coin_bonus_seed` (5) and
  any granting Fertilizer grants `coin_bonus_fertilizer` (10) — applied to the
  Goose Egg (+15), Keeper completion (+10), receiving the daily Seed (+5),
  checklist fertilizer rewards (+10), badge fertilizer (+10). Coins can ride
  in the Traveling Basket (contribute up to `basket_max_coin_per_pass` 25,
  paid out on lock-in/keep like everything else). Debug tools edit coins
  (audit-logged); shown in the farm bar, backpack, basket, egg reveal, admin
  Coins settings section. **No shop exists yet — Coins are held, not spent.**
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
- **The Golden Goose Keeper CAN now change their pick** (user-approved reward
  rule change, migration `20260709210000`): `select_golden_goose_winner` only
  saves `selected_submission_id` and the event stays `selection_open`; the egg
  + Keeper completion fertilizer are paid by `auto_close_golden_goose_assignments`
  at the deadline, to whatever pick is saved then. No pick saved → old behavior
  (random auto-select or expire, Keeper takes the exclusion break). Consequence:
  the winner's EggReveal appears only AFTER the deadline, not at pick time.
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

## General Store / newest features (2026-07-09, second pass)
- **General Store** — third map location (travel cinematic like the others).
  CSS-drawn interior (wall/floor/counter/register/shelves; the shopkeeper is
  farmer variant 8). Register AND shopkeeper both open the purchase menu
  (3×3 shelf + SALE shelf). Items: 25💧/10🪙 · 1✨/30🪙 · 1🌰/50🪙 ·
  Xtra Goose Entry/40🪙 · Lottery Ticket (grayed teaser, never on sale).
  Confirm-before-buy; server-priced; atomic; `store_purchases` audit +
  coin_events 'store_purchase'. **TODO(store-art):** swap the CSS furniture
  for real slices from `CozySpriteBundle/interior/` once coordinates are
  mapped.
- **Daily sale** — one item/day, deterministic from md5(**UTC** date; no
  community timezone setting exists), weighted 10..40% (deep discounts
  rarer), floor 1🪙, `store_sale_min/max_percent` clamps.
- **Xtra Goose Entry** — purchasable ONLY during an active answer-collection
  phase (safest: bound to the event, one per user per event, keeper blocked).
  Unlocks a second anonymous answer (submissions have `entry_number` 1|2,
  hard-capped at 2). GoosePanel shows the 🎟️ ticket under the first box.
- **Ceremony invites** — `ceremony_view_states` per user/season;
  `get_ceremony_invite` powers the "Great season" popup (once; Attend →
  /ceremony/[id] + attended; Maybe later → dismissed). Leaderboard has
  "Replay last month's ceremony" (visual only — close_season remains the only
  reward path).
- **Garden greetings** — click a neighbor → walk over → 💗 over both →
  greeter +10 water; server-limited once per neighbor per day
  (`garden_greetings`). Neighbors now idle NEAR the donation box.
- **WATER RULE: all water moves in multiples of 5** (0 = "none" allowed).
  Enforced server-side in garden contributions, basket passes, debug edits,
  checklist reward edits, store amounts, and settings v9 (`water_step_keys`);
  UI steppers/inputs move by 5. Live values were scanned — none violated the
  rule. Caveat: the generic `*_reward_amount` keys (meeting/hosting/seed) are
  NOT %5-validated because their reward TYPE is admin-switchable to
  seed/fertilizer; defaults (10) comply.
- **Polish:** community tree uses the user's clean `TreeCropped.png`
  (public/sprites/plants/tree_community.png) and GROWS with progress
  (2.8→6.2×) with ground flowers appearing every 10%; bloomed stage uses the
  single-frame `tree_cherry.png` (the old strip math was a latent bug);
  in-scene characters are 20% smaller; nav logo = the pink cherry tree;
  the farm bar's 🍒/🪙/🌳 chips have tap/hover info popups.

## Locations, music, KudoSeeds (2026-07-10)
- **Presence is generic now.** `location_presence(user_id, location_key)` +
  `ping_location_presence('garden'|'store')` + `greet_neighbor(presence_id)`
  replace the garden-only tables (dropped). `Neighbors.tsx` holds the shared
  hooks — `usePresence`, `useGreeting`, `useWalk`, `useWandering` — so **every
  new location gets neighbors, greeting, walking, and collision for free.**
  Neighbors stroll to a spot, loiter 7–15s, wander on. Greeting walks you
  right up to them, hearts both, pays 💧10 (once per person per location/day).
- **The General Store is walkable** with a solid counter (`COUNTER` rect is a
  `Blocker`); the shopkeeper stands directly behind the register.
- **Approach distances were tightened everywhere** (farm objects/trees, garden
  box, store counter, greetings) — the farmer now ends up almost touching what
  he's interacting with.
- **Music**: `src/lib/music.ts`, one track at a time, started in a scene's
  `useEffect` and **stopped on unmount** (walking / garden / store). The nav's
  🎵 button toggles it and persists to `profiles.music_enabled` (mirrored to
  localStorage for instant response). Sound effects keep their own 🔊 control.
- **Reward banners**: `announceReward("…")` from anywhere fires a window event;
  `RewardBannerHost` in GameShell renders it in the travel-plate style.
- **Butterflies** (`Butterflies.tsx`, from the user's 32×16 two-frame sheet)
  drift across the garden and the travel cinematic.
- **KudoSeeds**: the daily Seed is renamed and now carries an optional note
  (≤300 chars, `seed_events.message`, starter phrases in the panel). Received
  notes surface in the notification centre via `get_my_kudoseeds()`.
- **Coins on everything**: `reward_coin_bonus` (default 5, admin-editable)
  rides along with meetings, hosting, KudoSeeds (both sides), the goose egg,
  and basket payouts. Rewards with their OWN coin amount (medals, garden
  bundle, checklist `coin_reward`) use theirs and never stack the flat bonus.
- **Checklist goals pay coins** (`checklist_definitions.coin_reward`, backfilled
  to what the old implicit bonus granted) and **7 new goals** cover the garden,
  store, greetings, goose answers, and KudoSeed notes.
- **Goals "!" badge**: a gold "!" sits on the Goals menu button when a goal has
  completed that you haven't looked at; opening the window clears it
  (localStorage `rf-goals-seen`).
- **Fertilizer is 🧴, not ✨.** All item glyphs now live in `src/lib/icons.ts`
  (`ICON.water/seed/fertilizer/coin`) — change them in one place.
  TODO(item-art): real pixel sprites for water/seed/fertilizer.
- **The goose only flaps on the farm.** `GooseSprite` takes `animated`
  (default false), so geese inside panels/menus are perfectly still.
- **Ceremony certificate**: `Certificate.tsx` draws your farmer in front of
  your house with the season's stats onto a canvas and downloads a PNG.
- **Wiki** gained World Map / Community Garden / General Store / Coins chapters
  and renders real sprite strips (`WikiSection.sprites`).

## Coins TODOs / notes
- **`ensure_my_farm` does NOT return `coin_count`** — the dashboard reads the
  column directly (`fetchCoinCount` in `dashboard/page.tsx`). If you ever
  recreate `ensure_my_farm`, consider adding coins to its summary.
- The **ceremony show (`CeremonyShow.tsx`) doesn't display coin rewards yet**
  — winners receive them (coin_events reason `medal_reward`), the recap just
  doesn't mention them.
- Basket coin limits follow the basket's TOTAL-per-person structure
  (`basket_max_coin_per_pass` 25). The suggested separate per-day cap doesn't
  exist for any basket resource; adding one would be a design change.
- `debug_advance_time` doesn't touch coins (nothing to advance).

## Community Garden TODOs
- **TODO(garden-monthly):** only `weekly` and `manual` frequencies exist;
  `monthly` needs a scheduling rule in `create_or_get_current_community_garden`
  plus the validator/`gameSettings.ts` allowing the value.
- Contributions may overshoot a goal (e.g. water 251/250) — harmless, display
  caps at the goal; clamp server-side if it ever matters.
- Daily limits use the **UTC** calendar date (`current_date` in Postgres).
- Presence walk-off is client-side only (an entry vanishing from the poll
  animates off); there is no server "leaving" state.
- The Golden Goose re-pick UI was **not exercised live** (needs a Keeper in
  the selection phase); the SQL paths were reviewed and the state shape is
  typechecked. Sanity-check on the next real goose day.
- `debug_settings_enabled` was found **ON** in the live DB (HANDOFF previously
  said off) — turn it off in Admin → Game settings before real play.

## Next recommended step
The Golden Goose re-pick question is **resolved** (built, 2026-07-09). Still open:

1. Decide whether a seed should land in the **exact hole you tap**. If yes, add
   `plant_seed(p_slot)` + a slot column on `trees` (deliberately not built yet
   — user said to hold off).

If you'd rather ship than build: enable **leaked-password protection** in
Supabase Auth, wire a real email provider, and revoke `anon` EXECUTE on
`handle_new_profile()` (flagged by the Supabase security advisor) — those are
the things standing between this and letting real members in.
