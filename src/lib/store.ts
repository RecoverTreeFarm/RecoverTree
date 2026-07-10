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

/** Display info for the shelf grid (prices come from the server state). */
export const STORE_ITEMS: Record<
  StoreItemKey,
  { icon: string; name: string; blurb: string }
> = {
  water: {
    icon: "💧",
    name: "Water",
    blurb: "Adds Water to your inventory. Great for helping trees grow.",
  },
  fertilizer: {
    icon: "✨",
    name: "Fertilizer",
    blurb: "Helps an eligible tree ripen faster.",
  },
  seed: {
    icon: "🌰",
    name: "Seeds",
    blurb: "Plant new trees on your farm.",
  },
  goose_entry: {
    icon: "🎟️",
    name: "Xtra Goose Entry",
    blurb: "Adds one extra Golden Goose answer slot for the current event.",
  },
};
