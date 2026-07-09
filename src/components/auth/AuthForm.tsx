"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Panel } from "@/components/pixel/ui";

/**
 * Shared email + password form used by both /login and /signup.
 * mode="login"  → signInWithPassword
 * mode="signup" → signUp (handles the "confirm your email" case gently)
 */
export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isSignup = mode === "signup";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);

    try {
      if (isSignup) {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) {
          setError(error.message);
          return;
        }
        if (data.session) {
          // Signed up AND logged in (email confirmation is off).
          router.push("/dashboard");
          router.refresh();
          return;
        }
        // Email confirmation is on — no session until they click the link.
        setNotice(
          "Almost there! Check your email for a confirmation link, then come back and log in.",
        );
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) {
          setError(error.message);
          return;
        }
        router.push("/dashboard");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "w-full border-[3px] border-[var(--rf-ink)] bg-white px-3 py-2 text-sm font-mono rounded";

  return (
    <Panel className="w-full max-w-md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1 block text-xs font-bold uppercase tracking-wide">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-1 block text-xs font-bold uppercase tracking-wide">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={6}
            autoComplete={isSignup ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
            placeholder={isSignup ? "At least 6 characters" : "Your password"}
          />
        </div>

        {error && (
          <p
            role="alert"
            className="rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-red)] px-3 py-2 text-xs font-bold text-[var(--rf-cream)]"
          >
            {error}
          </p>
        )}
        {notice && (
          <p
            role="status"
            className="rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-gold)] px-3 py-2 text-xs font-bold"
          >
            {notice}
          </p>
        )}

        <button type="submit" disabled={busy} className="pixel-btn w-full disabled:opacity-60">
          {busy ? "Working…" : isSignup ? "Create account" : "Log in"}
        </button>
      </form>

      <p className="mt-4 text-center text-xs text-[var(--rf-ink-soft)]">
        {isSignup ? (
          <>
            Already have a farm?{" "}
            <Link href="/login" className="font-bold underline">
              Log in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link href="/signup" className="font-bold underline">
              Create an account
            </Link>
          </>
        )}
      </p>
    </Panel>
  );
}
