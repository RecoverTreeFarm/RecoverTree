"use client";

import { useState } from "react";
import type {
  AdminUser,
  AdminMeetingSession,
  AdminAuditLog,
  AdminChecklistGoal,
} from "@/lib/admin";
import type { SettingOverrideRow } from "@/lib/gameSettings";
import { UserManagement } from "./UserManagement";
import { MeetingSessions } from "./MeetingSessions";
import { AuditLogs } from "./AuditLogs";
import { GameSettings } from "./GameSettings";
import { DebugTools, type DebugInventoryRow, type DebugEventStates } from "./DebugTools";
import { BulletinAdmin } from "./BulletinAdmin";
import { GardenAdmin, type AdminGardenEvent } from "./GardenAdmin";
import type { AdminBulletinPost } from "@/lib/bulletin";

// The standalone Golden Goose tab was removed by request — Golden Goose
// SETTINGS remain editable under Game settings. (The admin cancel RPC still
// exists server-side if a management UI is ever wanted again.)
type Tab = "users" | "sessions" | "bulletin" | "garden" | "logs" | "settings" | "debug";

export function AdminConsole({
  currentUserId,
  users,
  sessions,
  logs,
  goals,
  overrides,
  debug,
  bulletin,
  garden,
}: {
  currentUserId: string;
  users: AdminUser[];
  sessions: AdminMeetingSession[];
  logs: AdminAuditLog[];
  goals: AdminChecklistGoal[];
  overrides: SettingOverrideRow[];
  /** null = debug settings disabled → no Debug tab */
  debug: { players: DebugInventoryRow[]; events: DebugEventStates | null } | null;
  bulletin: AdminBulletinPost[];
  garden: AdminGardenEvent[];
}) {
  const [tab, setTab] = useState<Tab>("users");

  const tabs: { id: Tab; label: string }[] = [
    { id: "users", label: "Users" },
    { id: "sessions", label: "Meetings" },
    { id: "bulletin", label: "Bulletin" },
    { id: "garden", label: "Garden" },
    { id: "settings", label: "Game settings" },
    ...(debug ? [{ id: "debug" as Tab, label: "Debug 🧪" }] : []),
    { id: "logs", label: "Audit log" },
  ];

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="Admin sections">
        {tabs.map((t) => (
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
      {tab === "bulletin" && <BulletinAdmin posts={bulletin} />}
      {tab === "garden" && <GardenAdmin events={garden} />}
      {tab === "settings" && (
        <GameSettings overrides={overrides} goals={goals} />
      )}
      {tab === "debug" && debug && (
        <DebugTools players={debug.players} events={debug.events} />
      )}
      {tab === "logs" && <AuditLogs logs={logs} />}
    </div>
  );
}
