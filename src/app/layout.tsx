import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SiteNav } from "@/components/pixel/SiteNav";
import { AppFrame } from "@/components/pixel/AppFrame";

export const metadata: Metadata = {
  title: "RecoverTree",
  description:
    "A cute, nostalgic pixel-farm companion for a recovery community. Attend meetings, earn Fruits, grow your farm.",
};

/**
 * viewportFit "cover" lets the game frame extend under iPhone notches / the
 * home indicator, with env(safe-area-inset-*) padding on the header and
 * bottom menu keeping controls tappable. Deliberately NO maximum-scale /
 * user-scalable — accessibility zoom always stays available.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        {/* Player routes render in the fixed phone-width game frame; admin /
            host / debug stay full-width (AppFrame decides by pathname). The
            flex column semantics pages rely on (Container's flex-1, footer's
            mt-auto) live inside AppFrame's wrappers. */}
        <AppFrame
          nav={<SiteNav />}
          footer={
            <footer className="mt-auto border-t-[3px] border-[var(--rf-ink)] bg-[var(--rf-grass-dark)] px-4 py-3 text-center text-[11px] font-bold uppercase tracking-wide text-[var(--rf-cream)]">
              RecoverTree · a gentle place to keep showing up · app shell (preview)
            </footer>
          }
        >
          {children}
        </AppFrame>
      </body>
    </html>
  );
}
