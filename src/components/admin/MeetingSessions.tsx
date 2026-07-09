"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/pixel/ui";
import type { AdminMeetingSession } from "@/lib/admin";
import { invalidateMeetingCode } from "@/app/admin/actions";

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "—";

const statusStyle: Record<AdminMeetingSession["status"], string> = {
  active: "bg-[var(--rf-grass)]",
  ended: "bg-[var(--rf-cream)]",
  invalidated: "bg-[var(--rf-red)] text-[var(--rf-cream)]",
};

function SessionRow({ s }: { s: AdminMeetingSession }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const isLive = s.status === "active" && new Date(s.expires_at) > new Date();

  function invalidate() {
    setErr(null);
    startTransition(async () => {
      const r = await invalidateMeetingCode(s.id);
      if (!r.ok) setErr(r.message);
      else router.refresh();
      setConfirming(false);
    });
  }

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-bold">@{s.host_username ?? "unknown"}</span>
          <span
            className={`ml-2 rounded border border-[var(--rf-ink)] px-1.5 py-0.5 text-[10px] font-bold uppercase ${statusStyle[s.status]}`}
          >
            {s.status}
          </span>
        </div>
        <span className="text-[11px] text-[var(--rf-ink-soft)]">
          {s.attendance_count} attended
        </span>
      </div>
      <div className="mt-1 grid gap-0.5 text-[11px] text-[var(--rf-ink-soft)] sm:grid-cols-3">
        <span>Started {fmt(s.starts_at)}</span>
        <span>Expires {fmt(s.expires_at)}</span>
        <span>Ended {fmt(s.ended_at)}</span>
      </div>

      {isLive && (
        <div className="mt-2">
          {confirming ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold">Invalidate this live code?</span>
              <button
                type="button"
                disabled={pending}
                onClick={invalidate}
                className="pixel-btn text-[11px] disabled:opacity-50"
                style={{ background: "var(--rf-red)", color: "var(--rf-cream)" }}
              >
                Yes, invalidate
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setConfirming(false)}
                className="pixel-btn pixel-btn--secondary text-[11px]"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="pixel-btn pixel-btn--secondary text-[11px]"
            >
              Invalidate code
            </button>
          )}
        </div>
      )}
      {err && (
        <p role="alert" className="mt-2 rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-red)] px-2 py-1 text-[11px] font-bold text-[var(--rf-cream)]">
          {err}
        </p>
      )}
    </Panel>
  );
}

export function MeetingSessions({ sessions }: { sessions: AdminMeetingSession[] }) {
  return (
    <div>
      <p className="mb-3 text-xs text-[var(--rf-ink-soft)]">
        The {sessions.length} most recent meeting sessions. You can invalidate a
        live code to stop further check-ins immediately.
      </p>
      <div className="grid gap-3">
        {sessions.map((s) => (
          <SessionRow key={s.id} s={s} />
        ))}
        {sessions.length === 0 && (
          <p className="text-sm text-[var(--rf-ink-soft)]">No meeting sessions yet.</p>
        )}
      </div>
    </div>
  );
}
