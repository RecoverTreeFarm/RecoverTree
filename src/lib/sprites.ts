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

  // Trees (cozy nature). Green growth strip + a pink blossom bearing variant.
  treeSheet: "/sprites/plants/tree_green.png",
  treeBlossom: "/sprites/plants/tree_pink.png",

  // Misc
  barn: "/sprites/misc/barn_cozy.png", // 60x86 cozy red barn (legacy default)

  // Small UI icons
  seedPacket: "/sprites/icons/seed_packet.png", // 16x16

  // Golden Goose (two flap frames + egg)
  goose1: "/sprites/goose/goose_1.png", // wings up
  goose2: "/sprites/goose/goose_2.png", // gliding (wing down)
  gooseEgg: "/sprites/goose/egg.png",
} as const;

/**
 * Season-cycle icons (sliced from CozySpriteBundle/Seasons Icons.png), one per
 * cycle position 1..5 (Sparch..Octobrrr). Soft glow baked in — render with
 * normal smoothing (no .pixelated) at small sizes.
 */
export function seasonIcon(cyclePosition: number | null): string | null {
  if (!cyclePosition || cyclePosition < 1 || cyclePosition > 5) return null;
  return `/sprites/seasons/season_${cyclePosition}.png`;
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

/** Pink blossom trees ALWAYS grow cherries (pool index 2). */
export const CHERRY_FRUIT_INDEX = 2;

/** Map a pool index (any integer, wraps) to a curated fruit sprite path. */
export function fruitSprite(index: number): string {
  const i = ((index % FRUIT_SPRITE_COUNT) + FRUIT_SPRITE_COUNT) % FRUIT_SPRITE_COUNT;
  return `/sprites/fruit/fruit_${FRUIT_POOL[i]}.png`;
}

/**
 * Avatar sprites a user can pick for their profile. The chosen key is stored
 * in profiles.avatar_config as {"sprite": "<key>"}. Keys are variant_01..10.
 */
export const AVATAR_SPRITES: Record<string, string> = Object.fromEntries(
  FARMER_VARIANTS.map((src, i) => [`variant_${String(i + 1).padStart(2, "0")}`, src]),
);

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
