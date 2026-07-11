# RecoverTree — Handoff

A cozy pixel-art web app that acts as a gamified companion for a recovery
community. It does **not** host chat or meetings — people meet on their own
tools (WhatsApp / Signal / Google Meet). RecoverTree celebrates showing up,
through a small farming game. Design source of truth:
`RecoverTree.Game Design Document.rtf`.

## 🚦 Next agent: start here

**RecoverTree is LIVE.** As of 2026-07-10 the hard launch is essentially done —
both former blockers below are resolved. Deployment facts:

- **Live URL:** https://recover-tree.vercel.app (Vercel, stock `next build`).
- **GitHub:** `origin` = https://github.com/RecoverTreeFarm/RecoverTree.git
  (`main` pushed + tracking; account `RecoverTreeFarm`, HTTPS via `gh`).
- **Vercel env vars set:** `NEXT_PUBLIC_SUPABASE_URL` +
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (Production + Preview). Remember:
  `NEXT_PUBLIC_` values are baked at build time — changing one needs a redeploy.
- **Email:** transactional email is wired. The owner set up **Resend** (own
  verified sending domain) and pointed **Supabase → Authentication → Emails →
  SMTP Settings** at it (`smtp.resend.com`, user `resend`, API key as
  password). This replaced Supabase's ~2/hr built-in mailer — the one launch
  blocker. Done with ChatGPT's help, owner reports it working.

**Final verification checklist (confirm before inviting a group):**
- [ ] **Supabase → Auth → URL Configuration:** Site URL + Redirect URLs set to
  `https://recover-tree.vercel.app` (else confirmation links point at
  localhost). ⚠️ Easy to miss — verify it's set.
- [ ] **Confirm email** toggled back ON (Auth → Providers → Email; was OFF
  during testing).
- [ ] One real signup on the live site: email arrives, is **from the Resend
  domain** (not `supabase.co`), link points at `recover-tree.vercel.app`, and
  clicking it activates the account. Cross-check Resend → Emails/Logs.

If email doesn't arrive, the usual cause is the Resend domain not fully
**Verified** yet (DNS still propagating) — Resend's logs will say.

**Optional, post-launch (none blocking):** add a custom domain in Vercel (then
update Supabase Site URL again); delete the `/debug/auth` temp page; the
Guidebook bug-report form is still a placeholder (could reuse Resend).

**Deliberately deferred, do not "fix" unless the owner asks:**
- `debug_settings_enabled` stays **ON** in the live DB — the owner wants
  admins to keep access to the Debug tab. Not an oversight.
- Leaked-password protection stays **OFF** in Supabase Auth for now — the
  owner's call, not urgent. It's a 30-second dashboard toggle
  (Auth → Policies) whenever they want it.

**Already done this session (verified, do not redo):**
- `handle_new_profile()` — anon/authenticated `EXECUTE` revoked
  (migration `20260710070000`). The advisor's one real finding is resolved.
- Working tree committed (see git log for exactly what shipped).

## Tech
- **Next.js 16** (App Router; session refresh lives in `src/proxy.ts`, not `middleware`)
- **TypeScript + Tailwind v4**, custom cozy pixel components (no shadcn)
- **Supabase** (Postgres + Auth + RLS) via `@supabase/ssr`
- Art source in `CozySpriteBundle/`, generated into `public/sprites/`
- Run locally: `npm run dev` → **http://localhost:3000**
- Test accounts: the old `sunny_tester`/`FriendlyPal` accounts were DELETED
  on 2026-07-11 (real users exist now). Make a fresh throwaway account for
  testing; the owner can promote/demote roles from /admin.

## ⚠️ MOST IMPORTANT RULE — the economy
**Fruits are the score, and Fruits ONLY come from harvesting trees.**
Every other reward is a currency — **Water, Seed, Fertilizer, or Coins 🪙** —
**never Fruits.**
- The only functions that create Fruits are `harvest_my_trees` / `harvest_one_tree`.
- **Coins** may be granted directly, but they **never count toward the
  leaderboard** (that still ranks `fruit_total` only). They're spending money
  (General Store, future cosmetics).
- **Water is always a multiple of 5** — awarded, spent, contributed, or edited.
- All scoring is server-side (SECURITY DEFINER functions + RLS). Clients read
  their own data but cannot write scores. Debug tools deliberately can't grant Fruits.

## Current state: ✅ safe checkpoint
- **Typecheck:** clean. **Build:** `next build` passes.
- **Lint:** 3 errors + 8 warnings, all **pre-existing and documented** (a
  `Date.now()` purity warning in `FarmPanel`, and `setState-in-effect` in
  `debug/auth` and `CeremonyShow`). Nothing from recent work.
- **All database migrations are applied to the live Supabase project
  (`usmtdjmxvbuuwvmzobln`) and verified.** Nothing waits to be run by hand.
- Working tree is clean except intentionally-untracked spritesheet downloads.

## What has been built
- **Auth + profiles** with Private Mode (public / anonymous / hidden).
- **Named season cycle** (Sparch → Maypril → Junduly → Suntember → Octobrrr,
  30 days each, admin-tunable) with a `pg_cron` tick every 10 min that runs the
  season ceremony, basket auto-advance, goose auto-close, and garden tick.
- **Farm loop** — water → 5 grow stages → 4-hour fruit timer → harvest; per-tree
  or bulk actions; cherry-blossom trees (~15%) pay 2× on harvest.
- **Meetings** (host code → members redeem for Water), **KudoSeeds** (daily gift
  + optional encouraging note; both farmers get a few Coins).
- **Seasonal checklist** — random shared goals; completing one pays Water +
  Fertilizer + Coins. New goals cover garden/store/greetings/goose/KudoSeeds.
  A "!" badge shows on the Goals menu button when a goal completes.
- **Season-end ceremony** (medals/badges, medal Coins 100/60/35) with a
  Wrapped-style show; **downloadable PNG certificate** of your farmer + stats;
  a per-user invite popup and a Leaderboard "Replay last month's ceremony" link.
- **Traveling Basket** (farmer-to-farmer, 24h hold/auto-pass; carries Coins too).
- **Golden Goose Keeper** — trust-based event; the Keeper's pick is provisional
  until the deadline; **Xtra Goose Entry** (bought at the store) unlocks a 2nd
  anonymous answer (max 2).
- **Walkable locations reached from the Map** with a travel cinematic (parallax
  scenery, butterflies, walking music that stops on scene exit):
  - **Community Garden** — weekly collaborative event; one giant shared tree that
    grows with combined progress; donation box you walk up to; Garden Share
    Bundle (Water/Seed/Fertilizer/Coins) on completion.
  - **General Store** — walkable interior with a solid counter and a shopkeeper;
    3×3 shelf + daily SALE; buy Water/Fertilizer/Seeds (with a quantity picker),
    or an Xtra Goose Entry; a grayed Lottery/Furniture/Fishing teaser.
  - **Shared presence system** (`location_presence`): other players who are there
    appear, wander between spots, and **fade out with a particle puff** when they
    leave; tap one to greet (+10 Water, once/person/location/day).
- **Coins 🪙** as a full currency: shown in the farm bar/backpack, edited in debug
  tools, and a flat `reward_coin_bonus` rides along with every reward.
- **Admin console** (`/admin`) — Users, Meetings, Bulletin, Garden, Game
  settings, optional Debug, Audit log. Every action is audit-logged.
- **Music/Sound**: separate 🔊 (effects) and 🎵 (background music) nav toggles;
  the music preference persists on the account (`profiles.music_enabled`).
- **Cozy item sprites + shop pet** — the emoji glyphs are replaced by real
  pixel art (`public/sprites/items/`: coin/water/fertilizer/sprout/basket/
  ticket) via `PixelIcon` (Sprite.tsx) and `STORE_ITEMS[key].sprite`. Swapped
  everywhere prominent: the General Store (shelves, tiles, prices, decor,
  sale, confirm), the farm inventory bar (water/fert/seed/coin), and the
  Lottery panel coin rows. Plain-text messages/banners keep the emoji (can't
  inline a sprite there). The **shop yorkie** wanders the store floor using
  the real animated CozySpriteBundle GIFs (`public/sprites/pets/
  yorkie_walk_{left,right}.gif`, 18×18 4-frame cycles, dedicated L/R sheets so
  no CSS-flip artifacts — the browser just animates them); patting it gives
  the same +10 water once-a-day bonus as greeting a neighbor — server-enforced
  via `greet_store_pet()` + its own `store_pet_greetings` table (migration
  `20260710060000`, applied + verified; kept separate so it never counts
  toward the "greet neighbors" goal). Item sprites were sliced/recolored from
  the asset packs (fertilizer = recolored potion; ticket hand-authored). The
  avatar roster also gained 4 black-outfit classic variants (worker/customer
  3 & 4 → 26 total avatar choices).
- **Walkable-scene boundaries fixed** — the General Store and Community Garden
  confine the player BELOW their obstacles (store `maxBottom` under the
  counter; garden `maxBottom` under the tree base + a trunk `Blocker`). Since
  walks are straight-line CSS transitions, staying below the obstacle means the
  player can never climb the wall/sky, stand in the counter/tree, or pass
  through it. Stray neighbour/shopper spots that sat on the wall/upper grass
  were moved onto the floor; store floor decor was removed. Garden tending now
  shows the farmer holding the item used (watering can / seed bag / fertilizer)
  via `PlayerFarmer`'s `held` prop, cleared a few seconds after the crate closes.
- **Mobile-first fixed game viewport** — player routes render inside a
  phone-shaped frame (`--game-w: 420px`, `.rf-game-frame` / `.rf-backdrop` in
  globals.css; `AppFrame` picks by pathname — `/admin`, `/host`, `/debug`
  stay full-width). On phones the frame is the screen (100% under 460px); on
  desktop it's centered over a muted textured backdrop with border + shadow.
  Every fixed overlay (bottom menu, GameWindow sheets, Wiki, store menu,
  reward banners, travel cinematic) is individually capped/centered at
  `--game-w` via `.rf-fixed-game-w` — deliberately NOT the
  transform-containing-block trick (Safari fixed-in-transform bugs).
  Safe-area insets via `viewport: { viewportFit: "cover" }` + `env()` padding
  on the header and bottom menu; no zoom-blocking meta. The Wiki now uses one
  wrapping chip-tab row everywhere (the desktop sidebar was retired).
  Tutorial coach cards render top/center/anchored only — never at the bottom
  of the screen where mobile chrome could clip them.
- **In-game Guidebook** (wiki) with chapters for every feature + sprite strips.
  Now deep-linkable to a chapter (one panel mounted via `wikiController`); a
  Cherry Blossom "Rare Trees" section lives under Fruits & Leaderboard.
- **Mandatory first-time tutorial** — a hands-on coach-mark flow taught through
  the REAL farm loop (plant → water ×3 → timer/cherry info → fertilize →
  harvest → leaderboard → explore). Required for every existing user too
  (`profiles.tutorial_completed` defaults false). Supplies are granted once by
  `grant_tutorial_supplies()` (idempotent; Water/Seed/Fertilizer only, never
  Fruits/Coins). During the tutorial the farm's item buttons act on the single
  tutorial tree (no bulk confirm). Replayable from the Guidebook (never
  re-grants; has an "End replay" escape). State: `TutorialOverlay.useTutorial`.
- **First-time feature guides** — one cozy popup the first time a user reaches
  Meeting Code / Store / Community Garden / Traveling Basket / Golden Goose /
  Lottery, offering to open that Guidebook chapter. Tracked in
  `profiles.feature_intro_seen` (jsonb); shown only after the tutorial is done.
- **Weekly Orchard Lottery 🎟️** — a weekly community drawing, **Coins ONLY**
  (never Water/Seeds/Fertilizer/Fruits; no real money). Rules:
  - Up to **3 tickets** per farmer per round (snapshot per round; hard cap 10);
    default price 🪙 20. Buying is atomic + all-or-nothing, with an
    idempotency key per confirmed tap (`buy_lottery_tickets`).
  - Rounds run Mon 00:00 → Sun 18:00 **America/Los_Angeles** by default
    (weekday/time/timezone/cutoff admin-tunable; snapshots on the round).
    Sales close 15 min before the draw.
  - On draw: **Orchard bonus = floor(pot × 25% )** (percent snapshotted per
    round); winner gets pot + bonus, credited to their ACTIVE-season farm.
  - **One distinct participant → exact refund, no bonus**
    (`refunded_single_participant`); none → `no_entries`. Banned users are
    excluded at resolution: tickets invalidated, NOT refunded, coins NOT paid
    out. Admin can cancel (refunds every valid ticket once) or force-resolve.
  - Everything is idempotent — re-running resolution never double-pays.
  - Resolution is wired into the existing pg_cron 10-min tick
    (`run_scheduled_game_jobs` v3 → `resolve_due_lottery_rounds`), **verified
    live**: the job exists and the tick runs the lottery jobs cleanly.
  - UI: opened from the Map and from the General Store shelf (the old
    "out of stock" Lottery tile is now live). Panel shows pot / bonus preview /
    prize / times with worded status labels; no casino styling. Notifications
    ride the existing client-derived system. Wiki chapter `weekly-lottery`.
  - Extras: 4 optional lottery checklist goals + `harvest_5` (winning is never
    a goal), 10 new ceremony badges (5 lottery incl. Lucky Farmer + Green
    Thumb / Cherry Blossom / Goose Whisperer / Basket Builder / Garden
    Helper), a privacy-safe season stats card in the ceremony
    (`get_season_lottery_summary`), own-only profile lottery stats, and an
    Admin → Lottery tab (rounds, force resolve, cancel & refund; audit-logged).

## Migrations (all applied + verified)
Recent additions: Community Garden, Coins, General Store + Xtra Goose Entry +
ceremony invites + water-%5 rule, generic location presence + checklist coins +
music pref, store prices +50%, KudoSeed notes + flat reward-coin bonus + new
goals, settings validator **v10**, and the **tutorial + feature-intros**
migration (`20260710040000` — profiles columns + `grant_tutorial_supplies` /
`complete_tutorial` / `mark_feature_intro_seen`; all applied + verified), and
the **Weekly Orchard Lottery** (`20260710050000` + `20260710051000` — tables,
purchase/resolution functions, goals, badges, settings **v11**, season summary;
both applied + verified live), the **store pet greet** bonus
(`20260710060000`), and the **anon-execute revoke** on `handle_new_profile()`
(`20260710070000`). All applied + verified live on `usmtdjmxvbuuwvmzobln`.

⚠️ **Advisor noise, not a gap:** `get_advisors` (security) reports ~76 warnings
of the form "Signed-In Users Can Execute SECURITY DEFINER Function." That's
expected and by design for this app — every game action (`plant_seed`,
`water_one_tree`, `purchase_store_item`, every `admin_*` function, etc.) is
deliberately a SECURITY DEFINER RPC the authenticated client calls directly,
and each one internally checks `auth.uid()`, ownership, ban status, or
`is_admin()` before doing anything. Don't "fix" these one by one — the only
finding worth acting on was the `anon`-callable `handle_new_profile()`, now
resolved. (One low-severity leftover: `protect_privileged_profile_columns()`
has a mutable search_path — cosmetic hardening, not urgent.)

⚠️ **Migration-ordering caveat:** `update_game_settings` has been recreated many
times, each adding allowed setting keys. **The newest version is v11 in
`20260710050000`** — like v10 it rebuilds the live function from
`pg_get_functiondef` and injects the lottery keys, so it inherits every older
key. `pick_badge_winner` was extended the same way (anchor after the
night_sprout branch). Any future migration that RESTATES either function must
copy the live arrays/branches first.

⚠️ **plpgsql gotcha:** `v_rec := null` on a never-SELECTed `record` does NOT make
`v_rec.field` safe (raises 55000 even in an untaken CASE branch). Use scalar
variables for maybe-unassigned data. (Fixed in `20260709250000`.)

## Current known issues / TODOs
- The screenshotted `Cannot read properties of null (reading 'click')` was a
  **transient dev-overlay artifact from automated test clicks**, not an app bug —
  the app has no unguarded programmatic `.click()`. Clears on reload.
- **New checklist goals only appear when a new season starts** (goals are picked
  at season start). Force with Debug → "End season now" to see them sooner.
- **Store interior is CSS-drawn** (TODO(store-art): slice real furniture from
  `CozySpriteBundle/interior/`).
- ~~Ceremony recap doesn't list coin rewards~~ **Fixed** — Act 3 now shows the
  medal (100/60/35) and badge (coin_bonus_fertilizer) coin payouts, using the
  effective (admin-tunable) values passed from the ceremony page.
- ~~Certificate download not verified end-to-end~~ **Verified** — drives the
  canvas → PNG path cleanly (900×640, same-origin sprites, no CORS taint).
- Pre-existing lint baseline (3 errors) is safe to leave.
- **Bug-report form** in the Guidebook is a placeholder (`BUG_REPORT_EMAIL` in
  `src/lib/wiki.ts`); no email backend. Could piggyback on whichever email
  provider gets wired in for auth, but that's a separate, optional feature —
  not required for launch.
- `/debug/auth` is a temporary dev page — harmless (not linked anywhere, and
  `debug_settings_enabled` is intentionally on), but worth deleting once the
  owner is confident they won't need it for troubleshooting after launch.

## What still needs building before a hard launch
**Nothing — the app is deployed and email is wired (see "Next agent: start
here" at the top).** Only the final verification checklist remains (URL config,
Confirm-email toggle, one real signup test). Everything else is optional polish.

## Secrets / safety
- `.env.local` holds the Supabase URL + **publishable** (browser-safe) key and is
  git-ignored. Only `.env.example` (placeholders) is tracked.
- No service-role/secret keys, DB passwords, or API secrets are in the repo.

## Next recommended step
App is live at https://recover-tree.vercel.app with Resend email wired. Run the
final verification checklist at the top (URL config + Confirm-email + one real
signup) to fully close out launch. After that, if asked to build instead of
ship: swapping the CSS store interior for real interior sprites is the
next-best use of time.

## Promotional poster (marketing asset, not part of the app)
Built once this session as a self-contained HTML file composited from real
game sprites (base64-inlined PNGs/GIFs — house, cherry-blossom tree, farmer,
coins, medal, item icons), then exported to a one-page PDF via headless
Chrome (`--headless --print-to-pdf`, with a custom `@page` size in the file's
print CSS sized to the actual content so it doesn't paginate onto a blank
second page). It lives only in this session's scratchpad (ephemeral, not in
the repo) and was published as a Claude Artifact. If the owner wants it
changed again, ask them for the Artifact URL — updating it needs the `url:`
param on the Artifact tool to edit in place rather than minting a new link.
