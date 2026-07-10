import type { SupabaseClient } from "@supabase/supabase-js";

export type Profile = {
  id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_config: { sprite?: string } | null;
  bio: string | null;
  role: "member" | "meeting_host" | "admin";
  leaderboard_visibility: "public" | "anonymous" | "hidden";
  is_banned: boolean;
  created_at: string;
  /** first-time tutorial state (see 20260710040000 migration) */
  tutorial_completed: boolean;
  tutorial_completed_at: string | null;
  tutorial_supplies_granted: boolean;
  /** which first-time feature-guide popups the user has already seen */
  feature_intro_seen: Record<string, boolean> | null;
};

export const USERNAME_REGEX = /^[A-Za-z0-9_]{3,20}$/;

export const VISIBILITY_OPTIONS = [
  {
    value: "public",
    label: "Public",
    description: "Your username shows on the leaderboard and your profile is visible.",
  },
  {
    value: "anonymous",
    label: "Anonymous",
    description: "You appear as “Anonymous Farmer” publicly, but still compete.",
  },
  {
    value: "hidden",
    label: "Hidden",
    description: "You don’t appear on public leaderboards. You still earn Fruits privately.",
  },
] as const;

/** Fetch the current user's profile (or null if they haven't made one). */
export async function getOwnProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<Profile | null> {
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  return (data as Profile | null) ?? null;
}
