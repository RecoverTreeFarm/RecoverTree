"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Redeems a 4-digit meeting code. All validation happens in the database
 * (logged in, not banned, code active + unexpired, not already redeemed);
 * this action just translates the outcome into gentle messages.
 */
export async function redeemCode(code: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("redeem_meeting_code", {
    p_code: code,
  });
  revalidatePath("/dashboard");
  revalidatePath("/meeting-code");

  if (error) {
    const m = error.message;
    if (m.includes("INVALID_CODE")) {
      return {
        ok: false as const,
        message: "That code isn’t active right now — double-check the digits with your host.",
      };
    }
    if (m.includes("CODE_EXPIRED")) {
      return {
        ok: false as const,
        message: "This code has expired. Codes last 90 minutes — ask your host for a fresh one.",
      };
    }
    if (m.includes("ALREADY_REDEEMED")) {
      return {
        ok: false as const,
        message: "You’ve already checked in for this meeting. See you at the next one! 🌱",
      };
    }
    if (m.includes("BANNED")) {
      return {
        ok: false as const,
        message: "Your account can’t check in right now. Please reach out to an admin.",
      };
    }
    if (m.includes("NO_PROFILE") || m.includes("NOT_AUTHENTICATED")) {
      return {
        ok: false as const,
        message: "Please log in and set up your farmer first.",
      };
    }
    return {
      ok: false as const,
      message: "Something went sideways — please try again in a moment.",
    };
  }

  const row = (
    data as {
      water_awarded: number;
      host_username: string | null;
    }[]
  )[0];
  return { ok: true as const, ...row };
}
