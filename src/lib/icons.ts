/**
 * One place for the little item glyphs used all over the UI. Changing an item's
 * look is a one-line edit here instead of a hunt through twenty components.
 *
 * TODO(item-art): these are emoji placeholders. Water/Seed/Fertilizer deserve
 * real pixel sprites from the cozy bundle; `seedPacket` already has one.
 */
export const ICON = {
  water: "💧",
  /** KudoSeeds — the daily gift you send another farmer */
  seed: "🌰",
  /** Fertilizer: a bottle of plant food. (Was ✨ sparkles, which read as
   *  "magic" and collided with every other sparkle effect in the game.) */
  fertilizer: "🧴",
  coin: "🪙",
  fruit: "🍒",
  tree: "🌳",
} as const;

/** Icon for a reward_type string coming back from the database. */
export const REWARD_ICON: Record<string, string> = {
  water: ICON.water,
  seed: ICON.seed,
  fertilizer: ICON.fertilizer,
  coin: ICON.coin,
};
