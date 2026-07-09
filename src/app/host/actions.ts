"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Starting a meeting code. Validated in the database (role check, one
 * active code per host). Codes run their full 90 minutes — there is no
 * early-end. If a code is already live, the same one is returned.
 */
export async function startMeeting() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_meeting");
  revalidatePath("/host");
  if (error) return { ok: false as const, message: error.message };
  const row = (
    data as {
      meeting_session_id: string;
      code: string;
      expires_at: string;
      already_active: boolean;
      water_earned: number;
    }[]
  )[0];
  return { ok: true as const, ...row };
}
