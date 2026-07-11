/**
 * Fishing — Phase 1 fish data (client mirror of public.fish_definitions).
 * Coin values + rarities live in the DB (source of truth for selling); this
 * table adds the client-only bits: the sprite path and the minigame BEHAVIOR
 * profile that makes each rarity feel different (Stardew-style).
 *
 * Behavior tuning is all here so it's easy to adjust:
 *   speed     — how fast the fish darts (px/sec of the 0..100 track)
 *   dartChance— per-tick chance it suddenly changes target
 *   pause     — how often it briefly holds still (calmer = easier)
 *   catchRate — how fast the meter fills while the fish is inside the bar
 *   escapeRate— how fast the meter drains while it's outside
 */
export type FishRarity = "common" | "uncommon" | "rare" | "legendary";

export type FishBehavior = {
  speed: number;
  dartChance: number;
  pause: number;
  catchRate: number;
  escapeRate: number;
};

export type FishDef = {
  id: string;
  name: string;
  rarity: FishRarity;
  coinValue: number;
  sprite: string;
};

export const RARITY_LABEL: Record<FishRarity, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  legendary: "Legendary",
};

/** Muted rarity accents (cozy palette, not neon). */
export const RARITY_COLOR: Record<FishRarity, string> = {
  common: "var(--rf-ink-soft)",
  uncommon: "#5f8a6b",
  rare: "#5b7fa6",
  legendary: "#a9772e",
};

/** Per-rarity minigame feel. Common = calm/slow, Legendary = frantic. */
export const RARITY_BEHAVIOR: Record<FishRarity, FishBehavior> = {
  common: { speed: 46, dartChance: 0.010, pause: 0.030, catchRate: 42, escapeRate: 26 },
  uncommon: { speed: 66, dartChance: 0.020, pause: 0.022, catchRate: 38, escapeRate: 32 },
  rare: { speed: 92, dartChance: 0.038, pause: 0.014, catchRate: 34, escapeRate: 40 },
  legendary: { speed: 122, dartChance: 0.060, pause: 0.008, catchRate: 30, escapeRate: 50 },
};

const sprite = (id: string) => `/sprites/fishing/fish/${id}.png`;

/** Must stay in sync with public.fish_definitions (ids + values). */
export const FISH: Record<string, FishDef> = {
  bluegill: { id: "bluegill", name: "Bluegill", rarity: "common", coinValue: 10, sprite: sprite("bluegill") },
  pond_smelt: { id: "pond_smelt", name: "Pond Smelt", rarity: "common", coinValue: 8, sprite: sprite("pond_smelt") },
  mossy_carp: { id: "mossy_carp", name: "Mossy Carp", rarity: "common", coinValue: 12, sprite: sprite("mossy_carp") },
  sunset_perch: { id: "sunset_perch", name: "Sunset Perch", rarity: "uncommon", coinValue: 24, sprite: sprite("sunset_perch") },
  reed_catfish: { id: "reed_catfish", name: "Reed Catfish", rarity: "uncommon", coinValue: 30, sprite: sprite("reed_catfish") },
  crystal_trout: { id: "crystal_trout", name: "Crystal Trout", rarity: "rare", coinValue: 60, sprite: sprite("crystal_trout") },
  ember_koi: { id: "ember_koi", name: "Ember Koi", rarity: "rare", coinValue: 75, sprite: sprite("ember_koi") },
  king_of_the_lake: { id: "king_of_the_lake", name: "King of the Lake", rarity: "legendary", coinValue: 220, sprite: sprite("king_of_the_lake") },
};

export function fishDef(id: string): FishDef | null {
  return FISH[id] ?? null;
}

export type FishStack = {
  species_id: string;
  name: string;
  rarity: FishRarity;
  coin_value: number;
  quantity: number;
};

/** What the server hands back from cast_fishing_line(). */
export type HookedFish = {
  species_id: string;
  name: string;
  rarity: FishRarity;
  coin_value: number;
};
