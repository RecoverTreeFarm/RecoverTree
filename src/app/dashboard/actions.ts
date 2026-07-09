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

export async function sendSeed(receiverUserId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("give_seed", {
    p_receiver_user_id: receiverUserId,
  });
  revalidatePath("/dashboard");
  if (error) {
    const m = error.message;
    if (m.includes("ALREADY_SENT_TODAY")) {
      return {
        ok: false as const,
        message: "You’ve already sent today’s Seed. Come back tomorrow! 🌱",
      };
    }
    if (m.includes("SELF_SEED")) {
      return { ok: false as const, message: "You can’t send a Seed to yourself." };
    }
    if (m.includes("RECEIVER_NOT_FOUND")) {
      return { ok: false as const, message: "Couldn’t find that farmer — try someone else." };
    }
    if (m.includes("BANNED")) {
      return { ok: false as const, message: "Your account can’t send Seeds right now." };
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
) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pass_traveling_basket", {
    p_receiver: receiverUserId,
    p_water: water,
    p_seed: seed,
    p_fertilizer: fertilizer,
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

export async function submitGooseAnswer(text: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_golden_goose_answer", { p_text: text });
  revalidatePath("/dashboard");
  if (error) return { ok: false as const, message: gooseError(error.message) };
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

export async function keepBasket() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("keep_traveling_basket");
  revalidatePath("/dashboard");
  if (error) return { ok: false as const, message: basketError(error.message) };
  const row = data as { water: number; seed: number; fertilizer: number };
  return { ok: true as const, ...row };
}
