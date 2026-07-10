/**
 * Bulletin board posts for the public homepage — announcements, patch notes,
 * bug fixes, and upcoming features.
 *
 * This is deliberately a plain data file, not a CMS: the project has no
 * content system, and posts change rarely. To add a notice, put a new object
 * at the TOP of BULLETIN_POSTS (newest first) and redeploy.
 */

export const BULLETIN_CATEGORIES = ["Announcement", "Update", "Patch", "Bug Fix"] as const;
export type BulletinCategory = (typeof BULLETIN_CATEGORIES)[number];

export type BulletinPost = {
  /** stable slug — used as the React key */
  id: string;
  title: string;
  /** ISO date (YYYY-MM-DD) */
  date: string;
  category: BulletinCategory;
  body: string;
};

/** Cozy pin colors per category (the tack holding the note to the board). */
export const CATEGORY_STYLE: Record<BulletinCategory, { pin: string; label: string }> = {
  Announcement: { pin: "var(--rf-gold)", label: "📣" },
  Update: { pin: "var(--rf-grass)", label: "🌱" },
  Patch: { pin: "var(--rf-blue)", label: "🧵" },
  "Bug Fix": { pin: "var(--rf-red)", label: "🐛" },
};

/** Newest first. */
export const BULLETIN_POSTS: BulletinPost[] = [
  {
    id: "cherry-trees",
    title: "Cherry blossom trees are blooming",
    date: "2026-07-09",
    category: "Update",
    body: "The rare cherry blossom tree has fresh art, its own drifting petals, and a little chime when it appears. Cherries now grow on cherry trees only — every other tree keeps its own fruit. A blossom still pays double Fruits when you harvest it.",
  },
  {
    id: "single-plant-care",
    title: "Tend one plant at a time",
    date: "2026-07-09",
    category: "Patch",
    body: "Tapping a single plant now waters, fertilizes, or harvests just that plant. Want to do the whole farm at once? Tap the item in the top bar or in your backpack — that still applies it everywhere it can.",
  },
  {
    id: "world-map",
    title: "A map of the valley",
    date: "2026-07-09",
    category: "Announcement",
    body: "There's a new map button in the corner of your farm. For now it's just a lovely place to look at — travel and locations are coming later.",
  },
  {
    id: "seasons-cycle",
    title: "Seasons now cycle: Sparch through Octobrrr",
    date: "2026-07-09",
    category: "Update",
    body: "Seasons no longer follow the calendar. Five 30-day seasons loop forever — Sparch, Maypril, Junduly, Suntember, Octobrrr — and every community starts on Sparch. When a season ends, the ceremony hands out medals and badges automatically.",
  },
  {
    id: "notification-fixes",
    title: "Quieter notifications, steadier trees",
    date: "2026-07-09",
    category: "Bug Fix",
    body: "Seed reminders now appear once a day instead of every time your seed count changes. Harvested trees no longer flash their fruit for a moment before emptying. Tapping outside the notification panel closes it.",
  },
];
