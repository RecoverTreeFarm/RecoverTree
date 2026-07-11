"use client";

import { usePathname } from "next/navigation";

/**
 * Routes that keep the normal full-width responsive layout: management
 * surfaces with tables and dense forms that would suffocate at phone width.
 * Everything else (the actual game) renders inside the fixed mobile frame.
 */
const FULL_WIDTH_PREFIXES = ["/admin", "/host", "/debug"];

/**
 * The player-facing app is a phone-shaped game: on mobile the frame IS the
 * screen; on desktop it stays at --game-w, centered over a quiet backdrop
 * (see .rf-game-frame / .rf-backdrop in globals.css). `nav` and `footer`
 * are server components passed through from the root layout.
 */
export function AppFrame({
  nav,
  footer,
  children,
}: {
  nav: React.ReactNode;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const fullWidth = FULL_WIDTH_PREFIXES.some((p) => pathname?.startsWith(p));

  if (fullWidth) {
    return (
      <div className="flex min-h-dvh flex-col bg-[linear-gradient(var(--rf-sky)_0%,var(--rf-sky-2)_100%)]">
        {nav}
        {children}
        {footer}
      </div>
    );
  }

  return (
    <div className="rf-backdrop">
      <div className="rf-game-frame">
        {nav}
        {children}
        {/* No footer inside the game frame — the play area should end at the
            bottom menu with nothing to scroll to (owner request). The footer
            still renders on full-width management routes above. */}
      </div>
    </div>
  );
}
