"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/profile";

/**
 * Admin actions. Every one calls a SECURITY DEFINER database function that
 * re-checks is_admin() server-side and writes an audit-log row — so even a
 * hand-crafted request can't act without the admin role. These wrappers just
 * translate coded exceptions into friendly messages and refresh the page.
 */

type Result = { ok: true } | { ok: false; message: string };

/** Re-verify the caller is an admin before doing anything. Defense in depth
 *  on top of the DB guard, so non-admins never even reach the RPC. */
async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, error: "Please log in." as const };
  const { data } = await supabase
    .from("profiles")
    .select("role, is_banned")
    .eq("user_id", user.id)
    .maybeSingle();
  const profile = data as Pick<Profile, "role" | "is_banned"> | null;
  if (!profile || profile.role !== "admin" || profile.is_banned) {
    return { supabase, error: "Admins only." as const };
  }
  return { supabase, error: null as null };
}

function friendly(message: string): string {
  const m = message;
  if (m.includes("NOT_ADMIN")) return "Admins only.";
  if (m.includes("INVALID_ROLE")) return "That isn’t a valid role.";
  if (m.includes("LAST_ADMIN")) return "You can’t remove the last remaining admin.";
  if (m.includes("CANNOT_BAN_SELF")) return "You can’t ban yourself.";
  if (m.includes("USER_NOT_FOUND")) return "That user no longer exists.";
  if (m.includes("SESSION_NOT_FOUND")) return "That meeting session no longer exists.";
  if (m.includes("NOT_ACTIVE")) return "That code isn’t active anymore.";
  if (m.includes("GOAL_NOT_FOUND")) return "That checklist goal no longer exists.";
  if (m.includes("NEGATIVE_NOT_ALLOWED")) return "Amounts can’t be negative.";
  if (m.includes("INVALID_REWARD_TYPE")) return "Rewards can only be water, seed, or fertilizer.";
  if (m.includes("INVALID_SCHEDULE_MODE")) return "Schedule mode must be Random or Specific.";
  if (m.includes("DAYS_PER_WEEK_OUT_OF_RANGE")) return "Days per week must be between 0 and 7.";
  if (m.includes("DAY_OUT_OF_RANGE") || m.includes("INVALID_DAY")) return "Weekdays must be Sunday–Saturday.";
  if (m.includes("UNKNOWN_SETTING_KEY")) return "One of the settings isn’t recognized.";
  if (m.includes("TEXT_LENGTH") || m.includes("INVALID_TEXT")) return "Names must be 1–40 characters.";
  if (m.includes("INVALID_")) return "One of the values isn’t valid.";
  return "Something went wrong — please try again.";
}

export async function setUserRole(targetUserId: string, role: string): Promise<Result> {
  const { supabase, error } = await requireAdmin();
  if (error) return { ok: false, message: error };
  const { error: rpcError } = await supabase.rpc("set_user_role", {
    p_target: targetUserId,
    p_role: role,
  });
  revalidatePath("/admin");
  if (rpcError) return { ok: false, message: friendly(rpcError.message) };
  return { ok: true };
}

export async function setUserBan(
  targetUserId: string,
  isBanned: boolean,
  reason: string | null,
): Promise<Result> {
  const { supabase, error } = await requireAdmin();
  if (error) return { ok: false, message: error };
  const { error: rpcError } = await supabase.rpc("set_user_ban", {
    p_target: targetUserId,
    p_is_banned: isBanned,
    p_reason: reason && reason.trim() ? reason.trim() : null,
  });
  revalidatePath("/admin");
  if (rpcError) return { ok: false, message: friendly(rpcError.message) };
  return { ok: true };
}

export async function invalidateMeetingCode(sessionId: string): Promise<Result> {
  const { supabase, error } = await requireAdmin();
  if (error) return { ok: false, message: error };
  const { error: rpcError } = await supabase.rpc("invalidate_meeting_code", {
    p_session: sessionId,
  });
  revalidatePath("/admin");
  if (rpcError) return { ok: false, message: friendly(rpcError.message) };
  return { ok: true };
}

export async function updateChecklistReward(
  definitionId: string,
  water: number,
  fertilizer: number,
): Promise<Result> {
  const { supabase, error } = await requireAdmin();
  if (error) return { ok: false, message: error };
  const { error: rpcError } = await supabase.rpc("update_checklist_reward", {
    p_definition_id: definitionId,
    p_water: water,
    p_fertilizer: fertilizer,
  });
  revalidatePath("/admin");
  if (rpcError) return { ok: false, message: friendly(rpcError.message) };
  return { ok: true };
}

/** Save a batch of changed settings. `settings` is { key: value } — only the
 *  keys the admin actually changed need to be included. */
export async function updateGameSettings(
  settings: Record<string, unknown>,
): Promise<Result> {
  const { supabase, error } = await requireAdmin();
  if (error) return { ok: false, message: error };
  if (!settings || Object.keys(settings).length === 0) return { ok: true };
  const { error: rpcError } = await supabase.rpc("update_game_settings", {
    p_settings: settings,
  });
  revalidatePath("/admin");
  if (rpcError) return { ok: false, message: friendly(rpcError.message) };
  return { ok: true };
}

export async function cancelGoose(assignmentId: string): Promise<Result> {
  const { supabase, error } = await requireAdmin();
  if (error) return { ok: false, message: error };
  const { error: rpcError } = await supabase.rpc("admin_cancel_golden_goose", {
    p_assignment: assignmentId,
  });
  revalidatePath("/admin");
  if (rpcError) return { ok: false, message: friendly(rpcError.message) };
  return { ok: true };
}

export async function resetGameSettings(): Promise<Result> {
  const { supabase, error } = await requireAdmin();
  if (error) return { ok: false, message: error };
  const { error: rpcError } = await supabase.rpc("reset_game_settings_to_defaults");
  revalidatePath("/admin");
  if (rpcError) return { ok: false, message: friendly(rpcError.message) };
  return { ok: true };
}
