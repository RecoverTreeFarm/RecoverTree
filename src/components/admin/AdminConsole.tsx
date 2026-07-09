"use client";

import { useState } from "react";
import type {
  AdminUser,
  AdminMeetingSession,
  AdminAuditLog,
  AdminChecklistGoal,
  AdminGooseRow,
} from "@/lib/admin";
import type { SettingOverrideRow } from "@/lib/gameSettings";
import { UserManagement } from "./UserManagement";
import { MeetingSessions } from "./MeetingSessions";
import { AuditLogs } from "./AuditLogs";
import { GameSettings } from "./GameSettings";
import { GooseAdmin } from "./GooseAdmin";

type Tab = "users" | "sessions" | "goose" | "logs" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "users", label: "Users" },
  { id: "sessions", label: "Meetings" },
  { id: "goose", label: "Golden Goose" },
  { id: "settings", label: "Game settings" },
  { id: "logs", label: "Audit log" },
];

export function AdminConsole({
  currentUserId,
  users,
  sessions,
  logs,
  goals,
  overrides,
  goose,
}: {
  currentUserId: string;
  users: AdminUser[];
  sessions: AdminMeetingSession[];
  logs: AdminAuditLog[];
  goals: AdminChecklistGoal[];
  overrides: SettingOverrideRow[];
  goose: AdminGooseRow[];
}) {
  const [tab, setTab] = useState<Tab>("users");

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="Admin sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={
              tab === t.id
                ? "rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-gold)] px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-[var(--rf-ink)]"
                : "rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-[var(--rf-ink-soft)] hover:bg-[var(--rf-gold)]"
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "users" && (
        <UserManagement users={users} currentUserId={currentUserId} />
      )}
      {tab === "sessions" && <MeetingSessions sessions={sessions} />}
      {tab === "goose" && <GooseAdmin rows={goose} />}
      {tab === "settings" && (
        <GameSettings overrides={overrides} goals={goals} />
      )}
      {tab === "logs" && <AuditLogs logs={logs} />}
    </div>
  );
}
