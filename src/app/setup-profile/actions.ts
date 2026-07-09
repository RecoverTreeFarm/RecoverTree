"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { USERNAME_REGEX } from "@/lib/profile";
import { AVATAR_KEYS } from "@/lib/sprites";

/**
 * Creates the user's profile. Runs on the SERVER with the user's own session
 * (RLS enforced: they can only insert a row for themselves, and the database
 * trigger forces role='member'). The database trigger also plants their
 * starter farm + tree.
 */
export async function createProfile(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const username = String(formData.get("username") ?? "").trim();
  const displayName = String(formData.get("display_name") ?? "").trim();
  const visibility = String(formData.get("visibility") ?? "public");
  const sprite = String(formData.get("avatar") ?? "worker_1");

  const fail = (message: string) =>
    redirect(`/setup-profile?error=${encodeURIComponent(message)}`);

  if (!USERNAME_REGEX.test(username)) {
    fail("Usernames are 3–20 characters: letters, numbers, and _ only.");
  }
  if (displayName.length > 40) {
    fail("Display names can be at most 40 characters.");
  }
  if (!["public", "anonymous", "hidden"].includes(visibility)) {
    fail("Please pick a visibility option.");
  }
  if (!AVATAR_KEYS.includes(sprite)) {
    fail("Please pick an avatar.");
  }

  const { error } = await supabase.from("profiles").insert({
    user_id: user.id,
    username,
    display_name: displayName || null,
    leaderboard_visibility: visibility,
    avatar_config: { sprite },
  });

  if (error) {
    if (error.code === "23505") {
      fail("That username is already taken — try another one.");
    }
    fail("Something went wrong saving your profile. Please try again.");
  }

  redirect("/dashboard");
}
