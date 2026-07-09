import Link from "next/link";
import { Sprite } from "./Sprite";
import { SPRITES } from "@/lib/sprites";
import { createClient } from "@/lib/supabase/server";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { SoundToggle } from "@/components/pixel/SoundToggle";

const memberLinks: { href: string; label: string }[] = [
  { href: "/dashboard", label: "Farm" },
  { href: "/meeting-code", label: "Code" },
  { href: "/leaderboard", label: "Leaders" },
];

const navBtn =
  "rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-[var(--rf-ink)] hover:bg-[var(--rf-gold)]";

/**
 * Top navigation bar (Server Component). Checks the Supabase session on the
 * server: logged-in users see their email + Log out; logged-out users see
 * Log in / Sign up.
 */
export async function SiteNav() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  // Role-aware links: Host for meeting_host/admin, Admin for admin only.
  let role: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();
    role = profile?.role ?? null;
  }
  const links = [
    ...memberLinks,
    ...(role === "meeting_host" || role === "admin"
      ? [{ href: "/host", label: "Host" }]
      : []),
    ...(role === "admin" ? [{ href: "/admin", label: "Admin" }] : []),
  ];

  return (
    <header
      className="sticky top-0 z-20 w-full"
      style={{
        background: "var(--rf-grass)",
        borderBottom: "3px solid var(--rf-ink)",
      }}
    >
      <nav className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <Sprite src={SPRITES.farmer} size={[32, 32]} scale={1} alt="" />
          {/* wordmark hides on narrow phones so wrapped nav buttons don't overlap it */}
          <span className="pixel-heading hidden text-lg text-[var(--rf-ink)] sm:inline">
            RecoverTree
          </span>
        </Link>

        <ul className="flex flex-wrap items-center gap-1.5">
          {user &&
            links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className={navBtn}>
                  {l.label}
                </Link>
              </li>
            ))}

          <li>
            <SoundToggle />
          </li>

          {user ? (
            <>
              <li className="hidden sm:block">
                <Link
                  href="/settings"
                  className="block max-w-40 truncate px-1 text-[10px] font-bold text-[var(--rf-ink)] underline"
                  title={`${user.email ?? ""} — settings`}
                >
                  {user.email}
                </Link>
              </li>
              <li>
                <LogoutButton />
              </li>
            </>
          ) : (
            <>
              <li>
                <Link href="/login" className={navBtn}>
                  Log in
                </Link>
              </li>
              <li>
                <Link
                  href="/signup"
                  className="rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-gold)] px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-[var(--rf-ink)] hover:bg-[var(--rf-cream)]"
                >
                  Sign up
                </Link>
              </li>
            </>
          )}
        </ul>
      </nav>
    </header>
  );
}
