"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AVATAR_KEYS } from "@/lib/sprites";

/** Updates the user's own profile (RLS restricts to their row; the database
 *  trigger blocks role/ban changes). Username is not editable. */
export async function updateProfile(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const displayName = String(formData.get("display_name") ?? "").trim();
  const bio = String(formData.get("bio") ?? "").trim();
  const visibility = String(formData.get("visibility") ?? "public");
  const sprite = String(formData.get("avatar") ?? "worker_1");

  const fail = (message: string) =>
    redirect(`/settings?error=${encodeURIComponent(message)}`);

  if (displayName.length > 40) fail("Display names can be at most 40 characters.");
  if (bio.length > 200) fail("Bios can be at most 200 characters.");
  if (!["public", "anonymous", "hidden"].includes(visibility)) {
    fail("Please pick a visibility option.");
  }
  if (!AVATAR_KEYS.includes(sprite)) fail("Please pick an avatar.");

  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: displayName || null,
      bio: bio || null,
      leaderboard_visibility: visibility,
      avatar_config: { sprite },
    })
    .eq("user_id", user.id);

  if (error) fail("Something went wrong saving your settings. Please try again.");

  redirect("/settings?saved=1");
}
