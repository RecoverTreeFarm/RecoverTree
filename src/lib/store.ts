/** General Store — client state shapes + item copy. */

export type StoreItemKey = "water" | "fertilizer" | "seed" | "goose_entry";

export type StoreSale = {
  item_key: StoreItemKey;
  discount_percent: number;
  base_price: number;
  sale_price: number;
};

export type StoreState = {
  enabled: boolean;
  coins: number;
  /** how much water one purchase grants (always a multiple of 5) */
  water_amount: number;
  prices: Record<StoreItemKey, number>;
  /** whether the Xtra Goose Entry can be bought right now */
  goose_entry_status: "no_event" | "available_to_buy" | "owned" | "used" | "keeper";
  /** today's sale (null when disabled or the item isn't purchasable) */
  sale: StoreSale | null;
};

/** Display info for the shelf grid (prices come from the server state).
 *  `icon` is the emoji fallback (still used in plain-text messages); `sprite`
 *  is the cozy pixel-art tile used everywhere it's shown as an image.
 *  `shelfName` is an optional short label so tiles stay readable. */
import type { ItemIconName } from "@/components/pixel/Sprite";

export const STORE_ITEMS: Record<
  StoreItemKey,
  { icon: string; sprite: ItemIconName; name: string; blurb: string; shelfName?: string }
> = {
  water: {
    icon: "💧",
    sprite: "water",
    name: "Water",
    blurb: "Adds Water to your inventory. Great for helping trees grow.",
  },
  fertilizer: {
    icon: "🧴",
    sprite: "fertilizer",
    name: "Fertilizer",
    blurb: "Helps an eligible tree ripen faster.",
  },
  seed: {
    icon: "🌰",
    sprite: "seed",
    name: "Seeds",
    blurb: "Plant new trees on your farm.",
  },
  goose_entry: {
    // `shelfName` keeps the shelf tile readable; `name` is the full title
    // used in the confirm panel and messages.
    icon: "🎟️",
    sprite: "ticket",
    name: "Xtra Goose Entry",
    blurb: "Adds one extra Golden Goose answer slot for the current event.",
    shelfName: "Goose Entry",
  },
};
