"use client";

import { Panel } from "@/components/pixel/ui";
import { describeAuditAction, type AdminAuditLog } from "@/lib/admin";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString([], { dateStyle: "short", timeStyle: "short" });

export function AuditLogs({ logs }: { logs: AdminAuditLog[] }) {
  return (
    <div>
      <p className="mb-3 text-xs text-[var(--rf-ink-soft)]">
        The {logs.length} most recent admin actions, newest first. Logs are
        append-only and outlive deleted accounts.
      </p>
      <div className="grid gap-2">
        {logs.map((l) => (
          <Panel key={l.id} className="!p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-bold">{describeAuditAction(l)}</span>
              <span className="text-[10px] uppercase tracking-wide text-[var(--rf-ink-soft)]">
                {fmt(l.created_at)}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-[var(--rf-ink-soft)]">
              by @{l.actor_username ?? "unknown"}
              {l.target_username ? ` → @${l.target_username}` : ""}
            </p>
            {l.metadata_json && Object.keys(l.metadata_json).length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-wide text-[var(--rf-ink-soft)]">
                  Details
                </summary>
                <pre className="mt-1 overflow-x-auto rounded border-2 border-[var(--rf-ink)]/30 bg-[var(--rf-cream)] p-2 text-[10px]">
                  {JSON.stringify(l.metadata_json, null, 2)}
                </pre>
              </details>
            )}
          </Panel>
        ))}
        {logs.length === 0 && (
          <p className="text-sm text-[var(--rf-ink-soft)]">No admin actions recorded yet.</p>
        )}
      </div>
    </div>
  );
}
