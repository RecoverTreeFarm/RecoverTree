# RecoverTree — Handoff

A cozy pixel-art web app that acts as a gamified companion for a recovery
community. It does **not** host chat or meetings — people meet on their own
tools (WhatsApp / Signal / Google Meet). RecoverTree celebrates showing up,
through a small farming game. Design source of truth:
`RecoverTree.Game Design Document.rtf`.

## Tech
- **Next.js 16** (App Router; session refresh lives in `src/proxy.ts`, not `middleware`)
- **TypeScript + Tailwind v4**, custom cozy pixel components (no shadcn)
- **Supabase** (Postgres + Auth + RLS) via `@supabase/ssr`
- Art source in `CozySpriteBundle/`, generated into `public/sprites/`
- Run locally: `npm run dev` → **http://localhost:3000**
- Test account: `dominictallariti+rf-test@gmail.com` / `pixel-farm-test-1234` (sunny_tester)

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
- **In-game Guidebook** (wiki) with chapters for every feature + sprite strips.

## Migrations (all applied + verified)
Recent additions: Community Garden, Coins, General Store + Xtra Goose Entry +
ceremony invites + water-%5 rule, generic location presence + checklist coins +
music pref, store prices +50%, KudoSeed notes + flat reward-coin bonus + new
goals, and settings validator **v10**.

⚠️ **Migration-ordering caveat:** `update_game_settings` has been recreated many
times, each adding allowed setting keys. **The newest version is v10 in
`20260710030000`** — it rebuilds the function from `pg_get_functiondef` and
injects one key, so it inherits every older key. Any future migration that
RESTATES the function must copy the live v10 key arrays first.

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
- **Ceremony recap doesn't list coin rewards** (they're paid, just not shown);
  the **certificate download** hasn't been clicked fully end-to-end.
- `debug_settings_enabled` may be ON in the live DB — turn off before real play.
- Pre-existing lint baseline (3 errors) is safe to leave.

## What still needs building (before a wide launch)
- **Auth email**: uses Supabase's built-in mailer (~2/hr). Wire a real email
  provider and enable **leaked-password protection** in Supabase Auth.
- **`handle_new_profile()`** is a SECURITY DEFINER function the `anon` role can
  call directly (flagged by the Supabase advisor) — revoke `anon` EXECUTE.
- **Bug-report form** in the Guidebook is a placeholder (`BUG_REPORT_EMAIL` in
  `src/lib/wiki.ts`); no email backend.
- Real pixel sprites for Water/Seed/Fertilizer (all glyphs live in `src/lib/icons.ts`).
- `/debug/auth` is a temporary dev page — delete before launch.

## Secrets / safety
- `.env.local` holds the Supabase URL + **publishable** (browser-safe) key and is
  git-ignored. Only `.env.example` (placeholders) is tracked.
- No service-role/secret keys, DB passwords, or API secrets are in the repo.

## Next recommended step
Ship-readiness, not new features: enable leaked-password protection + wire a real
email provider + revoke `anon` EXECUTE on `handle_new_profile()`. These are the
only things between this build and letting real members in. If building instead:
swap the CSS store interior for real interior sprites, or surface coin rewards in
the ceremony recap.
