"use server";

import { createClient } from "@/lib/supabase/server";
import type { FishRarity, HookedFish } from "@/lib/fish";

/**
 * Fishing server actions (Phase 1). Every one goes through a SECURITY DEFINER
 * RPC that checks fishing_allowed() — the module is admin-only while in
 * preview, so a non-admin can never cast, catch, or sell even by calling these
 * directly. Fish sales pay COINS ONLY; Fruits are never touched.
 */

function locked(msg: string) {
  return { ok: false as const, message: msg };
}

/** Roll a fish server-side (weighted rarity). The catch is only recorded once
 *  the minigame is WON, via recordCatch. */
export async function castLine() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cast_fishing_line");
  if (error) {
    if (error.message.includes("FISHING_LOCKED"))
      return locked("Fishing isn’t open for you yet.");
    return locked("The line snagged — try casting again.");
  }
  const row = (data as HookedFish[] | null)?.[0];
  if (!row) return locked("Nothing’s biting right now — try again.");
  return {
    ok: true as const,
    fish: {
      species_id: row.species_id,
      name: row.name,
      rarity: row.rarity as FishRarity,
      coin_value: row.coin_value,
    },
  };
}

/** Record a fish the player successfully reeled in. */
export async function recordCatch(speciesId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_fish_catch", {
    p_species: speciesId,
  });
  if (error) {
    if (error.message.includes("FISHING_LOCKED"))
      return locked("Fishing isn’t open for you yet.");
    return locked("Couldn’t log that catch — try again.");
  }
  return { ok: true as const, quantity: data as number };
}

/** Sell a stack of fish for Coins at the hut. */
export async function sellFish(speciesId: string, qty: number) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sell_fish", {
    p_species: speciesId,
    p_qty: qty,
  });
  if (error) {
    if (error.message.includes("FISHING_LOCKED"))
      return locked("Fishing isn’t open for you yet.");
    if (error.message.includes("NOT_ENOUGH_FISH"))
      return locked("You don’t have that many to sell.");
    return locked("The shopkeeper couldn’t ring that up — try again.");
  }
  return { ok: true as const, coins: data as number };
}
