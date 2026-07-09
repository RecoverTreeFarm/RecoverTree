"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** Signs the user out, then sends them home and re-renders the nav. */
export function LogoutButton({ className = "" }: { className?: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);

  async function handleLogout() {
    setBusy(true);
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={busy}
      className={`rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-[var(--rf-ink)] hover:bg-[var(--rf-red)] hover:text-[var(--rf-cream)] disabled:opacity-60 ${className}`}
    >
      {busy ? "…" : "Log out"}
    </button>
  );
}
