/**
 * Central registry of the pixel-art sprites shipped in /public/sprites.
 * Source art lives in the repo's "Spritesheets/" folder and is copied into
 * public/ so Next.js can serve it. Keep this file as the single source of
 * truth for sprite paths + intrinsic sizes.
 */

export const SPRITES = {
  // Characters (16x16). "worker" sprites read as farmers.
  farmer: "/sprites/characters/worker_1.png",
  farmerVariants: [
    "/sprites/characters/worker_1.png",
    "/sprites/characters/worker_2.png",
    "/sprites/characters/worker_3.png",
    "/sprites/characters/worker_4.png",
    "/sprites/characters/worker_5.png",
  ],
  villagerVariants: [
    "/sprites/characters/customer_1.png",
    "/sprites/characters/customer_2.png",
    "/sprites/characters/customer_3.png",
    "/sprites/characters/customer_4.png",
    "/sprites/characters/customer_5.png",
    "/sprites/characters/customer_6.png",
    "/sprites/characters/customer_7.png",
  ],

  // Ground
  grass: "/sprites/ground/grass.png", // 16x16
  soilUnwatered: "/sprites/ground/soil_unwatered.png", // 64x64 (green seams baked in)
  soilSolid: "/sprites/ground/soil_solid.png", // 32x32 seam-free crop for the plot
  soilWatered: "/sprites/ground/soil_watered.png", // 64x64
  pathway: "/sprites/ground/pathway.png", // 64x64

  // Plants — these are bushes but the product calls them "Trees".
  // Each PNG is a 96x20 horizontal strip of 6 growth frames (16x20 each).
  treeSheet: "/sprites/plants/blueberry.png",
  treeSheetAlt: "/sprites/plants/chilli.png",

  // Misc
  barn: "/sprites/misc/barn.png", // 96x88 (user-provided red pixel barn)
  marketStand: "/sprites/misc/market_stand_red.png", // 65x48
  marketStandAlt: "/sprites/misc/market_stand_blue.png",
  fence: "/sprites/misc/fence.png", // 48x48
} as const;

/** Plant growth strip geometry (blueberry / chilli share these dims). */
export const TREE_SHEET = {
  frameWidth: 16,
  frameHeight: 20,
  frameCount: 6,
} as const;

/**
 * Tree growth model (matches trees.growth_stage in the database).
 * Sheet column 1 (frame 0) is a pile of loose berries — NOT a plant stage.
 * The five growth stages map to sheet columns 2–5:
 *   stage 1 → frame 1 (sheet column 2, sapling)
 *   stage 2 → frame 2 (sheet column 3)
 *   stage 3 → frame 3 (sheet column 4)
 *   stage 4 → frame 4 (sheet column 5, full empty bush)
 *   stage 5 → frame 4 again + fruit dots on top (BEARING)
 * Watering advances the stage server-side; harvesting a bearing tree pays
 * out Fruits and resets it to stage 1.
 */
export const TREE_BEARING_STAGE = 5;
export const TREE_EMPTY_MATURE_FRAME = 4;

/** Convert a growth stage (1..5) to a sheet frame index. */
export function treeFrameForStage(stage: number): number {
  return Math.min(Math.max(stage, 1), TREE_EMPTY_MATURE_FRAME);
}

/** Blueberry blue sampled from the sheet's berry pixels. */
export const FRUIT_BLUE = "#3d55c8";

/**
 * Harvestable fruit sprites (sliced from Spritesheets/Fruit/pxl-food-8x8.png
 * into public/sprites/fruit/fruit_N.png — ~8-10px each, transparent bg).
 * A bearing tree shows 3 of ONE kind, picked stably per tree slot.
 */
export const FRUIT_SPRITE_COUNT = 20;
export function fruitSprite(index: number): string {
  const i = ((index % FRUIT_SPRITE_COUNT) + FRUIT_SPRITE_COUNT) % FRUIT_SPRITE_COUNT;
  return `/sprites/fruit/fruit_${i}.png`;
}

/**
 * Avatar sprites a user can pick for their profile. The chosen key is stored
 * in profiles.avatar_config as {"sprite": "<key>"}.
 */
export const AVATAR_SPRITES: Record<string, string> = {
  worker_1: "/sprites/characters/worker_1.png",
  worker_2: "/sprites/characters/worker_2.png",
  worker_3: "/sprites/characters/worker_3.png",
  worker_4: "/sprites/characters/worker_4.png",
  worker_5: "/sprites/characters/worker_5.png",
  customer_1: "/sprites/characters/customer_1.png",
  customer_2: "/sprites/characters/customer_2.png",
  customer_3: "/sprites/characters/customer_3.png",
  customer_4: "/sprites/characters/customer_4.png",
  customer_5: "/sprites/characters/customer_5.png",
  customer_6: "/sprites/characters/customer_6.png",
  customer_7: "/sprites/characters/customer_7.png",
};

export const AVATAR_KEYS = Object.keys(AVATAR_SPRITES);

/** Resolve an avatar_config to a sprite path (falls back to the farmer). */
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
