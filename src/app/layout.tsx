import type { Metadata } from "next";
import "./globals.css";
import { SiteNav } from "@/components/pixel/SiteNav";

export const metadata: Metadata = {
  title: "RecoverTree",
  description:
    "A cute, nostalgic pixel-farm companion for a recovery community. Attend meetings, earn Fruits, grow your farm.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <SiteNav />
        {children}
        <footer className="mt-auto border-t-[3px] border-[var(--rf-ink)] bg-[var(--rf-grass-dark)] px-4 py-3 text-center text-[11px] font-bold uppercase tracking-wide text-[var(--rf-cream)]">
          RecoverTree · a gentle place to keep showing up · app shell (preview)
        </footer>
      </body>
    </html>
  );
}
