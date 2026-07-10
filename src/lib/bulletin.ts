/**
 * Bulletin board — the homepage notice board.
 *
 * Posts live in the `bulletin_posts` table and are managed from
 * Admin → Bulletin. Anyone (including logged-out visitors) can read posts
 * whose `publish_at` has arrived, which is how scheduling works: pick a
 * future date and the post appears on its own.
 */

/** The three types an admin may choose. (`patch`/`bugfix` exist in the DB for
 *  legacy rows but are deliberately NOT offered in the admin UI.) */
export const BULLETIN_CATEGORIES = ["announcement", "update", "event"] as const;
export type BulletinCategory = (typeof BULLETIN_CATEGORIES)[number];

/** Every category the DB may return, including the legacy ones. */
export type BulletinCategoryAny = BulletinCategory | "patch" | "bugfix";

export type BulletinPost = {
  id: string;
  title: string;
  body: string;
  category: BulletinCategoryAny;
  /** a path under /sprites, or null */
  image_src: string | null;
  publish_at: string;
};

/** Admin view adds scheduling info. */
export type AdminBulletinPost = BulletinPost & {
  created_at: string;
  is_published: boolean;
};

/** Cozy pin color + emoji per category (the tack holding the note up). */
export const CATEGORY_STYLE: Record<BulletinCategoryAny, { pin: string; label: string }> = {
  announcement: { pin: "var(--rf-gold)", label: "📣" },
  update: { pin: "var(--rf-grass)", label: "🌱" },
  event: { pin: "var(--rf-blue)", label: "🎪" },
  patch: { pin: "var(--rf-blue)", label: "🧵" },
  bugfix: { pin: "var(--rf-red)", label: "🐛" },
};

export const CATEGORY_LABEL: Record<BulletinCategoryAny, string> = {
  announcement: "Announcement",
  update: "Update",
  event: "Event",
  patch: "Patch",
  bugfix: "Bug Fix",
};

/* ---------------------------------------------------------------------------
 * Sprite picker catalog.
 *
 * Game art an admin can attach to a post: characters, trees, fruit, farm and
 * nature objects. UI assets (/ui/*, frames, buttons) are intentionally absent
 * — the server also rejects anything that isn't under /sprites/.
 * ------------------------------------------------------------------------- */

export type SpriteChoice = { src: string; label: string };
export type SpriteGroup = { group: string; sprites: SpriteChoice[] };

const farmerSprites: SpriteChoice[] = Array.from({ length: 10 }, (_, i) => {
  const n = String(i + 1).padStart(2, "0");
  return { src: `/sprites/characters/farmer_variant_${n}.png`, label: `Farmer ${i + 1}` };
});

const fruitSprites: SpriteChoice[] = [4, 11, 13, 14, 15, 12, 16, 1, 3, 5, 7, 10, 18, 19, 0].map(
  (n) => ({ src: `/sprites/fruit/fruit_${n}.png`, label: `Fruit ${n}` }),
);

export const SPRITE_CATALOG: SpriteGroup[] = [
  {
    group: "Trees & nature",
    sprites: [
      { src: "/sprites/plants/tree_cherry.png", label: "Cherry blossom tree" },
      { src: "/sprites/plants/tree_green.png", label: "Tree growth strip" },
      { src: "/sprites/ground/grass_cozy.png", label: "Grass" },
      { src: "/sprites/ground/dirt_cozy.png", label: "Tilled soil" },
    ],
  },
  {
    group: "Farm & objects",
    sprites: [
      { src: "/sprites/misc/barn_cozy.png", label: "Barn" },
      { src: "/sprites/icons/seed_packet.png", label: "Seed packet" },
      { src: "/sprites/goose/egg.png", label: "Golden egg" },
      { src: "/sprites/goose/goose_2.png", label: "Golden Goose" },
      { src: "/sprites/map/world_map.png", label: "World map" },
      ...Array.from({ length: 6 }, (_, i) => ({
        src: `/sprites/houses/house_${i + 1}.png`,
        label: `House ${i + 1}`,
      })),
    ],
  },
  { group: "Characters", sprites: farmerSprites },
  { group: "Fruit", sprites: fruitSprites },
];

/** Guard mirroring the server's check — nothing outside /sprites/ is allowed. */
export function isAllowedSprite(src: string | null): boolean {
  if (src === null) return true;
  return src.startsWith("/sprites/");
}
