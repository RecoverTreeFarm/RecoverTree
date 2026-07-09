"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/pixel/ui";
import type { AdminGooseRow } from "@/lib/admin";
import { cancelGoose } from "@/app/admin/actions";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString([], { dateStyle: "short", timeStyle: "short" });

const STATUS_LABEL: Record<string, string> = {
  answer_collection: "Answer collection",
  selection_open: "Selection open",
  completed: "Completed",
  auto_completed: "Auto-completed",
  expired_no_submissions: "Expired (no answers)",
  passed: "Passed",
  cancelled: "Cancelled",
};

function GooseRow({ g }: { g: AdminGooseRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const active = g.status === "answer_collection" || g.status === "selection_open";

  function cancel() {
    setErr(null);
    startTransition(async () => {
      const r = await cancelGoose(g.id);
      if (!r.ok) setErr(r.message);
      else router.refresh();
      setConfirming(false);
    });
  }

  return (
    <Panel className="!p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-bold">@{g.keeper_username ?? "unknown"}</span>
          <span className="ml-2 rounded border border-[var(--rf-ink)] bg-[var(--rf-cream)] px-1.5 py-0.5 text-[10px] font-bold uppercase">
            {STATUS_LABEL[g.status] ?? g.status}
          </span>
          {g.auto_selected && (
            <span className="ml-1 text-[10px] text-[var(--rf-ink-soft)]">(auto)</span>
          )}
        </div>
        <span className="text-[11px] text-[var(--rf-ink-soft)]">
          {g.submission_count} answer{g.submission_count === 1 ? "" : "s"}
        </span>
      </div>
      <p className="mt-0.5 text-[11px] text-[var(--rf-ink-soft)]">
        {g.assigned_date} · started {fmt(g.assigned_at)} · deadline {fmt(g.selection_deadline_at)}
      </p>
      {active && (
        <div className="mt-2">
          {confirming ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold">Cancel this Golden Goose event?</span>
              <button type="button" disabled={pending} onClick={cancel}
                className="pixel-btn text-[11px]" style={{ background: "var(--rf-red)", color: "var(--rf-cream)" }}>
                Yes, cancel
              </button>
              <button type="button" disabled={pending} onClick={() => setConfirming(false)}
                className="pixel-btn pixel-btn--secondary text-[11px]">
                Keep it
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirming(true)}
              className="pixel-btn pixel-btn--secondary text-[11px]">
              Cancel event
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

export function GooseAdmin({ rows }: { rows: AdminGooseRow[] }) {
  return (
    <div>
      <p className="mb-3 text-xs text-[var(--rf-ink-soft)]">
        Recent Golden Goose events. You can cancel an active one; cancelling is
        recorded in the audit log and applies no exclusion to the Keeper.
      </p>
      <div className="grid gap-2">
        {rows.map((g) => (
          <GooseRow key={g.id} g={g} />
        ))}
        {rows.length === 0 && (
          <p className="text-sm text-[var(--rf-ink-soft)]">No Golden Goose events yet.</p>
        )}
      </div>
    </div>
  );
}
