"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
