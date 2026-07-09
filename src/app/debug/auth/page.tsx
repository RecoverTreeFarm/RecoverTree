"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { Container, Panel, PageHeader, PlaceholderNote } from "@/components/pixel/ui";

/**
 * TEMPORARY local-only debug page. Confirms the Supabase wiring is correct.
 * It reports only yes/no for the env vars and NEVER prints the URL or key.
 * Safe to delete once real auth is built.
 */

// These read as booleans only — the actual values are never rendered.
const urlLoaded = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
const keyLoaded = Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

function YesNo({ ok }: { ok: boolean }) {
  return (
    <span
      className="rounded border-2 border-[var(--rf-ink)] px-2 py-0.5 text-xs font-extrabold uppercase"
      style={{
        background: ok ? "var(--rf-grass)" : "var(--rf-red)",
        color: ok ? "var(--rf-ink)" : "var(--rf-cream)",
      }}
    >
      {ok ? "Yes" : "No"}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b-2 border-[var(--rf-ink)]/15 py-2 text-sm">
      <span className="font-bold">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

export default function DebugAuthPage() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const supabase = createClient();

  async function refresh() {
    setLoading(true);
    const { data } = await supabase.auth.getUser();
    setUser(data.user ?? null);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    // Re-check whenever auth state changes (sign in / sign out).
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    await refresh();
  }

  const loggedIn = Boolean(user);

  return (
    <Container>
      <PageHeader
        title="Auth Debug"
        subtitle="Temporary local-only page to confirm the Supabase connection. No keys or secrets are shown here."
        route="/debug/auth"
      />

      <Panel className="max-w-lg">
        <h2 className="pixel-heading mb-3 text-lg">Environment</h2>
        <Row label="Supabase URL loaded">
          <YesNo ok={urlLoaded} />
        </Row>
        <Row label="Supabase publishable key loaded">
          <YesNo ok={keyLoaded} />
        </Row>

        <h2 className="pixel-heading mb-3 mt-6 text-lg">Session</h2>
        {loading ? (
          <p className="py-2 text-sm text-[var(--rf-ink-soft)]">Checking…</p>
        ) : (
          <>
            <Row label="Logged in">
              <YesNo ok={loggedIn} />
            </Row>
            <Row label="User email">
              <span className="font-mono text-xs">{user?.email ?? "—"}</span>
            </Row>
            <Row label="User ID">
              <span className="font-mono text-xs break-all">{user?.id ?? "—"}</span>
            </Row>
          </>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSignOut}
            disabled={!loggedIn}
            className="pixel-btn pixel-btn--secondary disabled:cursor-not-allowed disabled:opacity-50"
          >
            Sign out
          </button>
          {!loading && !loggedIn && (
            <span className="text-xs text-[var(--rf-ink-soft)]">
              Not logged in —{" "}
              <a href="/login" className="font-bold underline">
                log in
              </a>{" "}
              or{" "}
              <a href="/signup" className="font-bold underline">
                sign up
              </a>
            </span>
          )}
        </div>

        <PlaceholderNote>delete this page before shipping</PlaceholderNote>
      </Panel>
    </Container>
  );
}
