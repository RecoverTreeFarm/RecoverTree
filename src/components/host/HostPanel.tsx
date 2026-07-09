"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/pixel/ui";
import { startMeeting } from "@/app/host/actions";

type ActiveSession = {
  id: string;
  code: string | null;
  starts_at: string;
  expires_at: string;
  attendance: number;
} | null;

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/**
 * Host controls. A code runs its full 90 minutes — no early end. The host
 * can leave and come back: the same code is re-displayed while it's live
 * (only the host can read it; members can never query codes).
 */
export function HostPanel({ session }: { session: ActiveSession }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [notice, setNotice] = useState<string | null>(null);

  function handleStart() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await startMeeting();
      if (!result.ok) {
        setError(result.message);
      } else if (!result.already_active && result.water_earned > 0) {
        setNotice(`Code created — thanks for hosting! 💧 +${result.water_earned} water.`);
      }
      router.refresh();
    });
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Panel>
        <h2 className="pixel-heading mb-3 text-lg">Attendance code</h2>

        {session ? (
          <>
            <div className="flex items-center justify-center rounded border-[3px] border-dashed border-[var(--rf-ink)] bg-white py-6 text-5xl font-extrabold tracking-[0.3em]">
              {session.code ?? "····"}
            </div>
            <p className="mt-2 text-[11px] font-bold text-[var(--rf-ink-soft)]">
              Read this aloud in your meeting. It stays active for the full 90
              minutes — you can leave this page and come back any time.
            </p>
            <p className="mt-2 text-xs">
              Started {fmtTime(session.starts_at)} · expires{" "}
              <span className="font-bold">{fmtTime(session.expires_at)}</span>
            </p>
          </>
        ) : (
          <>
            <p className="mb-4 text-xs text-[var(--rf-ink-soft)]">
              Start your meeting on Google Meet (or wherever your group meets),
              then generate a code and read it aloud. Attendees enter it to
              earn Fruits and water for their farms.
            </p>
            <button
              type="button"
              onClick={handleStart}
              disabled={pending}
              className="pixel-btn w-full disabled:opacity-60"
            >
              {pending ? "Starting…" : "Start meeting"}
            </button>
          </>
        )}

        {error && (
          <p role="alert" className="mt-3 rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-red)] px-3 py-2 text-xs font-bold text-[var(--rf-cream)]">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="mt-3 rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-grass)] px-3 py-2 text-xs font-bold">
            {notice}
          </p>
        )}
      </Panel>

      <Panel>
        <h2 className="pixel-heading mb-3 text-lg">Attendance</h2>
        <p className="text-4xl font-extrabold">{session?.attendance ?? 0}</p>
        <p className="text-xs uppercase tracking-wide text-[var(--rf-ink-soft)]">
          farmers checked in
        </p>
        {session && (
          <button
            type="button"
            onClick={() => router.refresh()}
            className="pixel-btn pixel-btn--secondary mt-3 text-xs"
          >
            Refresh count
          </button>
        )}
        <p className="mt-4 text-xs text-[var(--rf-ink-soft)]">
          RecoverTree doesn’t create or host the meeting — it only counts
          attendees who enter your code.
        </p>
      </Panel>
    </div>
  );
}
