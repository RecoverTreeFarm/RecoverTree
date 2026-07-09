import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for use in the BROWSER (Client Components — files that start
 * with "use client"). It only ever sees the public URL + publishable key,
 * both of which are safe to expose to visitors.
 *
 * Usage:
 *   const supabase = createClient();
 *   const { data } = await supabase.auth.getUser();
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
