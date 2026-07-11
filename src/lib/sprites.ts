/**
 * Central registry of the pixel-art sprites shipped in /public/sprites.
 * Art is from the "CozySpriteBundle" (cohesive cozy-farm style). Character
 * variants are composited (base body + eyes + clothes + hair) into single
 * 32x32 idle frames. Keep this file as the single source of truth for sprite
 * paths + intrinsic sizes.
 */

/** All 10 playable farmer variants (32x32 idle frames). */
export const FARMER_VARIANTS = [
  "/sprites/characters/farmer_variant_01.png",
  "/sprites/characters/farmer_variant_02.png",
  "/sprites/characters/farmer_variant_03.png",
  "/sprites/characters/farmer_variant_04.png",
  "/sprites/characters/farmer_variant_05.png",
  "/sprites/characters/farmer_variant_06.png",
  "/sprites/characters/farmer_variant_07.png",
  "/sprites/characters/farmer_variant_08.png",
  "/sprites/characters/farmer_variant_09.png",
  "/sprites/characters/farmer_variant_10.png",
] as const;

/**
 * The "classic" roster — the original characters from the Farm RPG tiny asset
 * pack (Spritesheets/farming sprites/Characters, 16x16), upscaled 2x with
 * nearest-neighbor into drop-in 32x32 idle frames so they render at the same
 * size as the cozy farmers everywhere (farm, presence, ceremony, profile).
 */
export const CLASSIC_VARIANTS = [
  "/sprites/characters/classic_worker_1.png",
  "/sprites/characters/classic_worker_2.png",
  "/sprites/characters/classic_worker_3.png",
  "/sprites/characters/classic_worker_4.png",
  "/sprites/characters/classic_worker_5.png",
  "/sprites/characters/classic_customer_1.png",
  "/sprites/characters/classic_customer_2.png",
  "/sprites/characters/classic_customer_3.png",
  "/sprites/characters/classic_customer_4.png",
  "/sprites/characters/classic_customer_5.png",
  "/sprites/characters/classic_customer_6.png",
  "/sprites/characters/classic_customer_7.png",
  // black-outfit recolours of the classic roster (16x16 → 32x32)
  "/sprites/characters/classic_worker_3_black.png",
  "/sprites/characters/classic_worker_4_black.png",
  "/sprites/characters/classic_customer_3_black.png",
  "/sprites/characters/classic_customer_4_black.png",
] as const;

/** Characters are 32x32 now (were 16x16). */
export const CHARACTER_SIZE = 32;

export const SPRITES = {
  // Default farmer + variant lists (all 32x32).
  farmer: FARMER_VARIANTS[0],
  farmerVariants: FARMER_VARIANTS,
  // "Villagers" (e.g. the anonymous silhouette, signup art) reuse the roster.
  villagerVariants: FARMER_VARIANTS,

  // Ground (CSS-tiled via globals.css) — cozy 16x16 tiles.
  grass: "/sprites/ground/grass_cozy.png",
  dirt: "/sprites/ground/dirt_cozy.png",

  // Trees (cozy nature). Green growth strip + the cherry-blossom bearing
  // variant (CozySpriteBundle/nature/CherryTree.png, bottom-aligned onto the
  // 32x44 growth frame). The old mis-cropped tree_pink.png is unused.
  treeSheet: "/sprites/plants/tree_green.png",
  treeBlossom: "/sprites/plants/tree_cherry.png",
  // The user's clean 32x32 crop (CozySpriteBundle/nature/TreeCropped.png) —
  // used for the Community Garden's giant tree + scene dressing (the strip's
  // mature frame had crop artifacts at large scales).
  treeCommunity: "/sprites/plants/tree_community.png",

  // Misc
  barn: "/sprites/misc/barn_cozy.png", // 60x86 cozy red barn (legacy default)

  // Small UI icons
  seedPacket: "/sprites/icons/seed_packet.png", // 16x16

  // Cozy item icons (real pixel art, replacing the emoji glyphs). All 32x32.
  itemWater: "/sprites/items/water.png",
  itemFertilizer: "/sprites/items/fertilizer.png",
  itemCoin: "/sprites/items/coin.png",
  itemSprout: "/sprites/items/sprout.png",
  itemBasket: "/sprites/items/basket.png",
  itemTicket: "/sprites/items/ticket.png",

  // The shop pet — a little yorkie that wanders the General Store. Real
  // animated GIFs from CozySpriteBundle (18x18, 4-frame walk cycles); the
  // browser animates them, and dedicated left/right sheets avoid CSS flipping.
  yorkieWalkRight: "/sprites/pets/yorkie_walk_right.gif",
  yorkieWalkLeft: "/sprites/pets/yorkie_walk_left.gif",
  yorkieSit: "/sprites/pets/yorkie_sit_right.gif",

  // Golden Goose (two flap frames + egg)
  goose1: "/sprites/goose/goose_1.png", // wings up
  goose2: "/sprites/goose/goose_2.png", // gliding (wing down)
  gooseEgg: "/sprites/goose/egg.png",
} as const;

/**
 * Season-cycle emoji, one per cycle position 1..5 (Sparch..Octobrrr).
 * Replaces the sliced sprite icons (public/sprites/seasons/ kept on disk but
 * no longer rendered) — emojis read crisply at header size on every device.
 */
const SEASON_EMOJI: Record<number, string> = {
  1: "🌱", // Sparch — sprouting spring
  2: "🌸", // Maypril — blossoms and rain
  3: "☀️", // Junduly — high summer
  4: "🍂", // Suntember — falling leaves
  5: "🎃", // Octobrrr — spooky and chilly
};

export function seasonEmoji(cyclePosition: number | null): string | null {
  if (!cyclePosition) return null;
  return SEASON_EMOJI[cyclePosition] ?? null;
}

/**
 * Selectable player houses (from CozySpriteBundle/HouseChoices, trimmed).
 * The chosen key is stored in profiles.avatar_config as {"house": "<key>"} —
 * same jsonb the avatar sprite lives in, so no migration is needed.
 */
export const HOUSE_SPRITES: Record<
  string,
  { src: string; w: number; h: number; label: string }
> = {
  house_1: { src: "/sprites/houses/house_1.png", w: 71, h: 73, label: "Cozy Cottage" },
  house_2: { src: "/sprites/houses/house_2.png", w: 67, h: 80, label: "Old Barn" },
  house_3: { src: "/sprites/houses/house_3.png", w: 77, h: 81, label: "Thatched Home" },
  house_4: { src: "/sprites/houses/house_4.png", w: 77, h: 80, label: "Forest Lodge" },
  house_5: { src: "/sprites/houses/house_5.png", w: 93, h: 64, label: "Bando Barn" },
  house_6: { src: "/sprites/houses/house_6.png", w: 96, h: 75, label: "Blue Bungalow" },
};

export const HOUSE_KEYS = Object.keys(HOUSE_SPRITES);
export const DEFAULT_HOUSE_KEY = "house_1";

/** Resolve an avatar_config to the selected house (falls back to default). */
export function houseKey(avatarConfig: unknown): string {
  if (
    avatarConfig &&
    typeof avatarConfig === "object" &&
    "house" in avatarConfig &&
    typeof (avatarConfig as { house: unknown }).house === "string" &&
    (avatarConfig as { house: string }).house in HOUSE_SPRITES
  ) {
    return (avatarConfig as { house: string }).house;
  }
  return DEFAULT_HOUSE_KEY;
}

/** Green tree growth strip geometry: 6 frames of 32x44. */
export const TREE_SHEET = {
  frameWidth: 32,
  frameHeight: 44,
  frameCount: 6,
} as const;

/**
 * Tree growth model (matches trees.growth_stage in the database).
 *   stage 1 → frame 0 (tiny sprout)   stage 2 → frame 1 (bush)
 *   stage 3 → frame 2 (sapling)       stage 4 → frame 3 (young tree)
 *   stage 5 → frame 4 + fruit sprites (BEARING); pink variant if is_blossom
 * Frames alone read too alike in the middle, so each stage ALSO renders at a
 * growing size (TREE_STAGE_SIZE) — visual only, growth logic unchanged.
 * Watering advances the stage server-side; harvesting a bearing tree pays
 * out Fruits (2x for a blossom tree) and resets it to stage 1.
 */
export const TREE_BEARING_STAGE = 5;
export const TREE_EMPTY_MATURE_FRAME = 4;

/** Convert a growth stage (1..5) to a sheet frame index (0-based). */
export function treeFrameForStage(stage: number): number {
  return Math.min(Math.max(stage, 1), TREE_BEARING_STAGE) - 1;
}

/** Per-stage size multiplier so every growth phase is clearly taller/fuller. */
export const TREE_STAGE_SIZE: Record<number, number> = {
  1: 0.55,
  2: 0.7,
  3: 0.85,
  4: 1,
  5: 1,
};

/** Blueberry blue sampled from the sheet's berry pixels. */
export const FRUIT_BLUE = "#3d55c8";

/**
 * Harvestable fruit sprites (sliced from the pxl-food-8x8 icon sheet). We use
 * a curated FRUIT-ONLY pool — the raw slices also include a few veg/mushroom/
 * nut icons, which we skip so a "random fruit" is always actually a fruit.
 * These small fruit sprites are the icon for the Fruit currency AND the fruits
 * hanging on a bearing tree.
 */
const FRUIT_POOL = [4, 11, 13, 14, 15, 12, 16, 1, 3, 5, 7, 10, 18, 19, 0] as const;
export const FRUIT_SPRITE_COUNT = FRUIT_POOL.length;

/** Default fruit shown for the Fruit currency (cherries). */
export const DEFAULT_FRUIT_INDEX = 2;

/** Cherry-blossom trees ALWAYS grow cherries (pool index 2 → fruit_13). */
export const CHERRY_FRUIT_INDEX = 2;

/**
 * CHERRIES ARE EXCLUSIVE TO THE CHERRY-BLOSSOM TREE. An ordinary tree picks
 * its fruit from this pool, which is FRUIT_POOL with the cherry removed —
 * previously a plain tree in slot 2 (and every 15th slot after) rendered
 * cherries, which made the rare blossom tree look ordinary.
 */
const ORCHARD_FRUIT_POOL = FRUIT_POOL.filter((_, i) => i !== CHERRY_FRUIT_INDEX);

/** Map a pool index (any integer, wraps) to a curated fruit sprite path. */
export function fruitSprite(index: number): string {
  const i = ((index % FRUIT_SPRITE_COUNT) + FRUIT_SPRITE_COUNT) % FRUIT_SPRITE_COUNT;
  return `/sprites/fruit/fruit_${FRUIT_POOL[i]}.png`;
}

/** Fruit sprite for an ORDINARY tree — never a cherry. */
export function orchardFruitSprite(index: number): string {
  const n = ORCHARD_FRUIT_POOL.length;
  const i = ((index % n) + n) % n;
  return `/sprites/fruit/fruit_${ORCHARD_FRUIT_POOL[i]}.png`;
}

/**
 * Avatar sprites a user can pick for their profile. The chosen key is stored
 * in profiles.avatar_config as {"sprite": "<key>"}. Keys are variant_01..10
 * for the cozy farmers, plus classic_worker_N / classic_customer_N for the
 * classic roster (key = the sprite's filename, so keys stay stable). The
 * pickers and server validation both iterate AVATAR_KEYS, so this map is the
 * only place a new choice has to be added.
 */
export const AVATAR_SPRITES: Record<string, string> = {
  ...Object.fromEntries(
    FARMER_VARIANTS.map((src, i) => [`variant_${String(i + 1).padStart(2, "0")}`, src]),
  ),
  ...Object.fromEntries(
    CLASSIC_VARIANTS.map((src) => [
      src.slice(src.lastIndexOf("/") + 1).replace(".png", ""),
      src,
    ]),
  ),
};

export const AVATAR_KEYS = Object.keys(AVATAR_SPRITES);

/** Resolve an avatar_config to a sprite path (falls back to the default). */
export function avatarSprite(avatarConfig: unknown): string {
  if (
    avatarConfig &&
    typeof avatarConfig === "object" &&
    "sprite" in avatarConfig &&
    typeof (avatarConfig as { sprite: unknown }).sprite === "string"
  ) {
    const key = (avatarConfig as { sprite: string }).sprite;
    if (key in AVATAR_SPRITES) return AVATAR_SPRITES[key];
  }
  return SPRITES.farmer;
}
