import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase client for use on the SERVER (Server Components, Route Handlers,
 * Server Actions). It reads the logged-in user's session from cookies.
 *
 * Note: it's async because Next.js `cookies()` is async.
 *
 * Usage (in a Server Component):
 *   const supabase = await createClient();
 *   const { data } = await supabase.auth.getUser();
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // The `setAll` method was called from a Server Component. This can
            // be ignored if you have middleware refreshing user sessions.
          }
        },
      },
    },
  );
}
