import Link from "next/link";
import { SPRITES, HOUSE_SPRITES, houseKey } from "@/lib/sprites";
import { createClient } from "@/lib/supabase/server";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { SoundToggle } from "@/components/pixel/SoundToggle";
import { MusicToggle } from "@/components/pixel/MusicToggle";

const memberLinks: { href: string; label: string }[] = [
  { href: "/dashboard", label: "Farm" },
  { href: "/news", label: "News" },
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
  let musicEnabled = true;
  let houseSrc: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, music_enabled, avatar_config")
      .eq("user_id", user.id)
      .maybeSingle();
    role = profile?.role ?? null;
    musicEnabled = (profile?.music_enabled as boolean | undefined) ?? true;
    houseSrc =
      HOUSE_SPRITES[houseKey(profile?.avatar_config)]?.src ??
      HOUSE_SPRITES.house_1.src;
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
        // keep the header clear of iPhone notches (viewportFit: "cover")
        paddingTop: "env(safe-area-inset-top)",
      }}
    >
      <nav className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-3 py-2">
        {user ? (
          // Logged-in: the player's chosen house is the emblem (tap = home),
          // with the domain wordmark tucked small underneath.
          <Link
            href="/dashboard"
            className="flex shrink-0 flex-col items-center leading-none"
            aria-label="Return to your farm"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={houseSrc ?? SPRITES.treeBlossom} alt="" className="pixelated h-10 w-auto" />
            <span className="mt-0.5 text-[9px] font-bold tracking-wide text-[var(--rf-ink)]">
              recovertree.farm
            </span>
          </Link>
        ) : (
          // Logged-out visitors: the cherry-blossom emblem + wordmark.
          <Link href="/" className="flex shrink-0 items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={SPRITES.treeBlossom} alt="" className="pixelated h-11 w-auto" />
            <span className="pixel-heading text-sm text-[var(--rf-ink)] sm:text-lg">
              RecoverTree
            </span>
          </Link>
        )}

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
          {user && (
            <li>
              <MusicToggle initialEnabled={musicEnabled} />
            </li>
          )}

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
