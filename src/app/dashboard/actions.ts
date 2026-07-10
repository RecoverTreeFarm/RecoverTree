"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { HOUSE_KEYS } from "@/lib/sprites";

/**
 * Watering and harvesting run entirely in the database (SECURITY DEFINER
 * functions). The client only asks; the server decides how much water is
 * spent, how stages advance, and how many Fruits a harvest pays out.
 */

export async function waterTrees() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("water_my_trees");
  revalidatePath("/dashboard");
  if (error) return { ok: false as const, message: error.message };
  const row = (data as { water_left: number; trees_advanced: number }[])[0];
  return { ok: true as const, ...row };
}

export async function harvestTrees() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("harvest_my_trees");
  revalidatePath("/dashboard");
  if (error) return { ok: false as const, message: error.message };
  const row = (data as { trees_harvested: number; fruits_earned: number }[])[0];
  return { ok: true as const, ...row };
}

/* ---------------------------------------------------------------------------
 * SINGLE-TREE actions — used when the player taps one plant. Each RPC verifies
 * the tree belongs to the caller's active-season farm. The bulk versions above
 * stay the "apply to everything" path (top inventory bar + backpack).
 * ------------------------------------------------------------------------- */

export async function waterOneTree(treeId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("water_one_tree", { p_tree: treeId });
  revalidatePath("/dashboard");
  if (error) {
    const m = error.message;
    if (m.includes("NOT_ENOUGH_WATER")) {
      return { ok: false as const, message: "Not enough water — attend a meeting to earn more. 💧" };
    }
    if (m.includes("TREE_NOT_THIRSTY")) {
      return { ok: false as const, message: "That plant doesn’t need water right now." };
    }
    return { ok: false as const, message: "Couldn’t water that plant — try again." };
  }
  const row = (data as { water_left: number; new_stage: number; became_blossom: boolean }[])[0];
  return { ok: true as const, ...row };
}

export async function fertilizeOneTree(treeId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fertilize_one_tree", { p_tree: treeId });
  revalidatePath("/dashboard");
  if (error) {
    const m = error.message;
    if (m.includes("NO_FERTILIZER")) {
      return { ok: false as const, message: "No fertilizer left — win medals and badges to earn more!" };
    }
    if (m.includes("NO_WAITING_TREE")) {
      return {
        ok: false as const,
        message: "Fertilizer only works on a fully-watered tree that’s waiting to fruit.",
      };
    }
    return { ok: false as const, message: "Couldn’t use fertilizer just now — try again." };
  }
  const row = (data as { fertilizer_left: number }[])[0];
  return { ok: true as const, ...row };
}

export async function harvestOneTree(treeId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("harvest_one_tree", { p_tree: treeId });
  revalidatePath("/dashboard");
  if (error) {
    if (error.message.includes("TREE_NOT_READY")) {
      return { ok: false as const, message: "That tree isn’t ready to harvest yet." };
    }
    return { ok: false as const, message: "Couldn’t harvest just now — try again." };
  }
  const row = (data as { trees_harvested: number; fruits_earned: number; was_blossom: boolean }[])[0];
  return { ok: true as const, ...row };
}

/** Send today's KudoSeed, optionally with an encouraging note (≤300 chars). */
export async function sendSeed(receiverUserId: string, message?: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("give_seed", {
    p_receiver_user_id: receiverUserId,
    p_message: message?.trim() ? message.trim() : null,
  });
  revalidatePath("/dashboard");
  if (error) {
    const m = error.message;
    if (m.includes("ALREADY_SENT_TODAY")) {
      return {
        ok: false as const,
        message: "You’ve already sent today’s KudoSeed. Come back tomorrow! 🌱",
      };
    }
    if (m.includes("MESSAGE_TOO_LONG")) {
      return { ok: false as const, message: "That note is a bit long — please shorten it." };
    }
    if (m.includes("SELF_SEED")) {
      return { ok: false as const, message: "You can’t send a KudoSeed to yourself." };
    }
    if (m.includes("RECEIVER_NOT_FOUND")) {
      return { ok: false as const, message: "Couldn’t find that farmer — try someone else." };
    }
    if (m.includes("BANNED")) {
      return { ok: false as const, message: "Your account can’t send KudoSeeds right now." };
    }
    return { ok: false as const, message: "Something went sideways — please try again." };
  }
  const row = (data as { receiver_username: string; water_earned: number }[])[0];
  return { ok: true as const, ...row };
}

export async function useFertilizer() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("use_fertilizer");
  revalidatePath("/dashboard");
  if (error) {
    if (error.message.includes("NO_FERTILIZER")) {
      return { ok: false as const, message: "No fertilizer left — win medals and badges to earn more!" };
    }
    if (error.message.includes("NO_WAITING_TREE")) {
      return {
        ok: false as const,
        message: "Fertilizer only works on a fully-watered tree that’s waiting to fruit.",
      };
    }
    return { ok: false as const, message: "Couldn’t use fertilizer just now — try again." };
  }
  const row = (data as { fertilizer_left: number }[])[0];
  return { ok: true as const, ...row };
}

export async function plantSeed() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("plant_seed");
  revalidatePath("/dashboard");
  if (error) {
    if (error.message.includes("NO_SEEDS")) {
      return { ok: false as const, message: "No seeds to plant — a friend can send you one!" };
    }
    return { ok: false as const, message: "Couldn’t plant just now — try again." };
  }
  const row = (data as { tree_count: number; seeds_left: number }[])[0];
  return { ok: true as const, ...row };
}

/* ---------------------------------------------------------------------------
 * Traveling Basket. All rules live in the database (holder-only, must add
 * ≥1 item, per-pass/per-day limits, eligibility, lock-in). These wrappers
 * translate coded exceptions into friendly copy.
 * ------------------------------------------------------------------------- */

function basketError(message: string): string {
  const m = message;
  if (m.includes("MUST_ADD_ITEM")) return "Add at least one item to pass the basket along.";
  if (m.includes("PASS_LIMIT_EXCEEDED")) return "That’s more than the basket can take in one pass.";
  if (m.includes("DAILY_LIMIT_EXCEEDED")) return "You’ve reached today’s contribution limit for one of those items.";
  if (m.includes("NOT_ENOUGH_ITEMS")) return "You don’t have that many items to give.";
  if (m.includes("NEGATIVE_NOT_ALLOWED")) return "Amounts can’t be negative.";
  if (m.includes("CANNOT_PASS_TO_SELF")) return "The basket has to travel — pick another farmer.";
  if (m.includes("RECEIVER_NOT_ELIGIBLE")) return "That farmer can’t receive the basket right now — pick someone else.";
  if (m.includes("NOT_HOLDER")) return "The basket isn’t in your hands right now.";
  if (m.includes("NO_ACTIVE_BASKET")) return "There’s no traveling basket right now.";
  if (m.includes("BASKET_EXPIRED")) return "Today’s basket has already gone to rest.";
  if (m.includes("BANNED")) return "Your account can’t take part right now.";
  if (m.includes("NO_FARM") || m.includes("NO_PROFILE")) return "Set up your farm first, then try again.";
  return "Something went sideways — please try again.";
}

export async function passBasket(
  receiverUserId: string,
  water: number,
  seed: number,
  fertilizer: number,
  coin = 0,
) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pass_traveling_basket", {
    p_receiver: receiverUserId,
    p_water: water,
    p_seed: seed,
    p_fertilizer: fertilizer,
    p_coin: coin,
  });
  revalidatePath("/dashboard");
  if (error) return { ok: false as const, message: basketError(error.message) };
  const row = data as { locked_in: boolean; participants: number };
  return { ok: true as const, ...row };
}

/**
 * Pick a farmhouse. Stored in profiles.avatar_config (same jsonb as the
 * avatar sprite) — merged, never clobbered, so the avatar choice survives.
 * RLS restricts the update to the user's own row; the DB trigger still
 * blocks role/ban changes.
 */
export async function setHouse(houseKey: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, message: "Please log in." };
  if (!HOUSE_KEYS.includes(houseKey)) {
    return { ok: false as const, message: "That house isn’t available." };
  }

  const { data: row } = await supabase
    .from("profiles")
    .select("avatar_config")
    .eq("user_id", user.id)
    .maybeSingle();
  const current =
    row?.avatar_config && typeof row.avatar_config === "object"
      ? (row.avatar_config as Record<string, unknown>)
      : {};

  const { error } = await supabase
    .from("profiles")
    .update({ avatar_config: { ...current, house: houseKey } })
    .eq("user_id", user.id);

  revalidatePath("/dashboard");
  if (error) return { ok: false as const, message: "Couldn’t save your house — try again." };
  return { ok: true as const };
}

/* ---------------------------------------------------------------------------
 * Golden Goose. All rules are enforced in the database (phase windows, keeper
 * checks, anonymity, idempotent selection).
 * ------------------------------------------------------------------------- */

function gooseError(message: string): string {
  const m = message;
  if (m.includes("NO_OPEN_REQUEST")) return "There’s no Golden Goose Request open right now.";
  if (m.includes("COLLECTION_CLOSED")) return "Answers have closed for this Golden Goose.";
  if (m.includes("KEEPER_CANNOT_SUBMIT")) return "You’re the Keeper — you can’t answer your own request.";
  if (m.includes("EMPTY_ANSWER")) return "Write a short answer first.";
  if (m.includes("ANSWER_TOO_LONG")) return "That answer is a bit long — please shorten it.";
  if (m.includes("SELECTION_NOT_OPEN")) return "Selection hasn’t opened yet — answers are still coming in.";
  if (m.includes("SELECTION_CLOSED")) return "The goose has flown — selection has closed.";
  if (m.includes("INVALID_SUBMISSION")) return "That answer isn’t available to pick.";
  if (m.includes("CANNOT_SELECT_SELF")) return "You can’t pick your own answer.";
  if (m.includes("NOT_KEEPER")) return "You’re not the Golden Goose Keeper right now.";
  if (m.includes("PASS_DISABLED")) return "Passing isn’t available right now.";
  if (m.includes("BANNED")) return "Your account can’t take part right now.";
  return "Something went sideways — please try again.";
}

export async function submitGooseAnswer(text: string, entry: 1 | 2 = 1) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_golden_goose_answer", {
    p_text: text,
    p_entry: entry,
  });
  revalidatePath("/dashboard");
  if (error) {
    if (error.message.includes("NO_EXTRA_ENTRY")) {
      return { ok: false as const, message: "You’ll need an Xtra Goose Entry from the General Store for a second answer." };
    }
    return { ok: false as const, message: gooseError(error.message) };
  }
  return { ok: true as const };
}

export async function selectGooseWinner(submissionId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("select_golden_goose_winner", { p_submission: submissionId });
  revalidatePath("/dashboard");
  if (error) return { ok: false as const, message: gooseError(error.message) };
  return { ok: true as const };
}

export async function passGoose() {
  const supabase = await createClient();
  const { error } = await supabase.rpc("pass_golden_goose");
  revalidatePath("/dashboard");
  if (error) return { ok: false as const, message: gooseError(error.message) };
  return { ok: true as const };
}

export async function setGooseOptIn(optIn: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_golden_goose_opt_in", { p_opt_in: optIn });
  revalidatePath("/dashboard");
  if (error) return { ok: false as const, message: "Couldn’t update your Golden Goose setting." };
  return { ok: true as const };
}

/* ---------------------------------------------------------------------------
 * Community Garden. All rules live in the database (active-event checks,
 * daily limits, inventory deduction, reward distribution). Copy stays gentle.
 * ------------------------------------------------------------------------- */

function gardenError(message: string): string {
  const m = message;
  if (m.includes("NO_ACTIVE_GARDEN")) return "The garden is resting right now — check back soon.";
  if (m.includes("GARDEN_ENDED")) return "The garden wrapped up for the week — see you at the next one.";
  if (m.includes("GARDEN_COMPLETE")) return "The garden is already fully cared for. 🌸";
  if (m.includes("DAILY_LIMIT_EXCEEDED")) return "You’ve reached today’s garden limit. Come back tomorrow!";
  if (m.includes("NOT_ENOUGH_ITEMS")) return "You’re out of that supply.";
  if (m.includes("MUST_ADD_ITEM")) return "Add a little something first.";
  if (m.includes("NEGATIVE_NOT_ALLOWED")) return "Amounts can’t be negative.";
  if (m.includes("PRIVATE_CONTRIBUTIONS_DISABLED")) return "Garden contributions aren’t available for private profiles right now.";
  if (m.includes("BANNED")) return "Your account can’t take part right now.";
  if (m.includes("NO_FARM") || m.includes("NO_PROFILE")) return "Set up your farm first, then try again.";
  return "Something went sideways — please try again.";
}

export async function contributeToGarden(water: number, seed: number, fertilizer: number) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("contribute_to_community_garden", {
    p_water: water,
    p_seed: seed,
    p_fertilizer: fertilizer,
  });
  revalidatePath("/dashboard");
  if (error) return { ok: false as const, message: gardenError(error.message) };
  const row = data as {
    contributed: boolean;
    completed: boolean;
    current_water: number;
    current_seeds: number;
    current_fertilizer: number;
    progress_percent: number;
  };
  return { ok: true as const, ...row };
}

/* ---------------------------------------------------------------------------
 * General Store. Prices, sale math, and item granting all live server-side;
 * the client only names the item and whether it's using today's sale.
 * ------------------------------------------------------------------------- */

export async function purchaseStoreItem(itemKey: string, sale: boolean) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("purchase_store_item", {
    p_item: itemKey,
    p_sale: sale,
  });
  revalidatePath("/dashboard");
  if (error) {
    const m = error.message;
    if (m.includes("NOT_ENOUGH_COINS")) return { ok: false as const, message: "Not enough Coins." };
    if (m.includes("STORE_CLOSED")) return { ok: false as const, message: "The store is closed right now." };
    if (m.includes("SALE_UNAVAILABLE")) return { ok: false as const, message: "That sale has ended for today." };
    if (m.includes("ITEM_UNAVAILABLE")) return { ok: false as const, message: "That item isn’t on the shelf." };
    if (m.includes("NO_ACTIVE_GOOSE")) return { ok: false as const, message: "The Golden Goose isn’t collecting answers right now." };
    if (m.includes("KEEPER_CANNOT_BUY")) return { ok: false as const, message: "You’re the Keeper this time — no extra entries needed." };
    if (m.includes("ALREADY_HAVE_ENTRY")) return { ok: false as const, message: "You already have an Xtra Goose Entry for this visit." };
    if (m.includes("BANNED")) return { ok: false as const, message: "Your account can’t shop right now." };
    if (m.includes("NO_FARM") || m.includes("NO_PROFILE")) return { ok: false as const, message: "Set up your farm first, then come back." };
    return { ok: false as const, message: "Something went sideways at the register — try again." };
  }
  const row = data as { item_key: string; quantity: number; coins_spent: number; coins_left: number };
  return { ok: true as const, ...row };
}

/* ---------------------------------------------------------------------------
 * Ceremony invitations — per-user per-season view state (no popup spam).
 * ------------------------------------------------------------------------- */

export async function setCeremonyViewState(
  seasonId: string,
  action: "dismissed" | "attended" | "replayed",
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_ceremony_view_state", {
    p_season: seasonId,
    p_action: action,
  });
  revalidatePath("/dashboard");
  if (error) return { ok: false as const, message: "Couldn’t save that — try again." };
  return { ok: true as const };
}

/* ---------------------------------------------------------------------------
 * Location presence + greetings. Works for EVERY walkable location (garden,
 * store, and whatever comes next) — the location key is just a string.
 * ------------------------------------------------------------------------- */

/** Heartbeat while a location scene is open; returns who else is there. */
export async function pingLocationPresence(location: "garden" | "store") {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ping_location_presence", {
    p_location: location,
  });
  if (error) return { ok: false as const, others: [] as unknown[] };
  const row = data as { others: unknown[] };
  return { ok: true as const, others: row.others ?? [] };
}

/** Say hi to a neighbor — hearts + a little water for reaching out
 *  (server-limited to once per neighbor per location per day). */
export async function greetNeighbor(presenceId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("greet_neighbor", {
    p_presence: presenceId,
  });
  revalidatePath("/dashboard");
  if (error) {
    const m = error.message;
    if (m.includes("ALREADY_GREETED_TODAY"))
      return { ok: false as const, message: "You’ve already said hi to them today. 💗" };
    if (m.includes("NEIGHBOR_LEFT") || m.includes("NEIGHBOR_NOT_FOUND"))
      return { ok: false as const, message: "Looks like they just headed home." };
    if (m.includes("CANNOT_GREET_SELF"))
      return { ok: false as const, message: "That’s you! 🌱" };
    return { ok: false as const, message: "Couldn’t say hi just now — try again." };
  }
  const row = data as { water_earned: number };
  return { ok: true as const, water_earned: row.water_earned };
}

export async function keepBasket() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("keep_traveling_basket");
  revalidatePath("/dashboard");
  if (error) return { ok: false as const, message: basketError(error.message) };
  const row = data as { water: number; seed: number; fertilizer: number; coin?: number };
  return { ok: true as const, ...row };
}
