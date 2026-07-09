"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/pixel/ui";
import { ROLE_LABELS, type AdminUser } from "@/lib/admin";
import { setUserRole, setUserBan } from "@/app/admin/actions";

const inputClass =
  "w-full border-[3px] border-[var(--rf-ink)] bg-white px-2 py-1.5 text-xs rounded";

const ROLES: AdminUser["role"][] = ["member", "meeting_host", "admin"];

function Banner({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return (
    <p
      role={msg.ok ? "status" : "alert"}
      className={`mt-2 rounded border-2 border-[var(--rf-ink)] px-2 py-1 text-[11px] font-bold ${
        msg.ok ? "bg-[var(--rf-grass)]" : "bg-[var(--rf-red)] text-[var(--rf-cream)]"
      }`}
    >
      {msg.text}
    </p>
  );
}

function UserRow({
  u,
  isSelf,
}: {
  u: AdminUser;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [role, setRole] = useState<AdminUser["role"]>(u.role);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const roleChanged = role !== u.role;

  function saveRole() {
    setMsg(null);
    startTransition(async () => {
      const r = await setUserRole(u.user_id, role);
      if (!r.ok) {
        setRole(u.role);
        setMsg({ ok: false, text: r.message });
      } else {
        setMsg({ ok: true, text: "Role updated." });
        router.refresh();
      }
    });
  }

  function toggleBan(nextBanned: boolean) {
    setMsg(null);
    startTransition(async () => {
      const r = await setUserBan(u.user_id, nextBanned, nextBanned ? reason : null);
      if (!r.ok) {
        setMsg({ ok: false, text: r.message });
      } else {
        setMsg({ ok: true, text: nextBanned ? "User banned." : "User unbanned." });
        setReason("");
        router.refresh();
      }
    });
  }

  return (
    <Panel className={u.is_banned ? "opacity-90" : ""}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold">@{u.username}</span>
            {isSelf && (
              <span className="rounded border border-[var(--rf-ink)] bg-[var(--rf-sky)] px-1 text-[10px] font-bold uppercase">
                you
              </span>
            )}
            {u.is_banned && (
              <span className="rounded border border-[var(--rf-ink)] bg-[var(--rf-red)] px-1 text-[10px] font-bold uppercase text-[var(--rf-cream)]">
                banned
              </span>
            )}
          </div>
          <p className="truncate text-[11px] text-[var(--rf-ink-soft)]">
            {u.display_name ? `${u.display_name} · ` : ""}
            {u.email ?? "no email"}
          </p>
          {u.is_banned && u.banned_reason && (
            <p className="mt-0.5 text-[11px] italic text-[var(--rf-ink-soft)]">
              Reason: {u.banned_reason}
            </p>
          )}
        </div>
        <span className="rounded border border-[var(--rf-ink)] bg-[var(--rf-cream)] px-1.5 py-0.5 text-[10px] font-bold uppercase">
          {ROLE_LABELS[u.role]}
        </span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {/* Role */}
        <div>
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[var(--rf-ink-soft)]">
            Role
          </span>
          <div className="flex gap-1.5">
            <select
              value={role}
              disabled={pending}
              onChange={(e) => setRole(e.target.value as AdminUser["role"])}
              className={inputClass}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!roleChanged || pending}
              onClick={saveRole}
              className="pixel-btn pixel-btn--blue text-[11px] disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>

        {/* Ban / unban */}
        <div>
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[var(--rf-ink-soft)]">
            Access
          </span>
          {u.is_banned ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => toggleBan(false)}
              className="pixel-btn pixel-btn--secondary text-[11px] disabled:opacity-50"
            >
              Unban
            </button>
          ) : isSelf ? (
            <p className="text-[11px] text-[var(--rf-ink-soft)]">
              You can’t ban yourself.
            </p>
          ) : (
            <div className="flex gap-1.5">
              <input
                type="text"
                value={reason}
                disabled={pending}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason (optional)"
                className={inputClass}
                maxLength={200}
              />
              <button
                type="button"
                disabled={pending}
                onClick={() => toggleBan(true)}
                className="pixel-btn text-[11px] disabled:opacity-50"
                style={{ background: "var(--rf-red)", color: "var(--rf-cream)" }}
              >
                Ban
              </button>
            </div>
          )}
        </div>
      </div>

      <Banner msg={msg} />
    </Panel>
  );
}

export function UserManagement({
  users,
  currentUserId,
}: {
  users: AdminUser[];
  currentUserId: string;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? users.filter(
        (u) =>
          u.username.toLowerCase().includes(needle) ||
          (u.display_name ?? "").toLowerCase().includes(needle) ||
          (u.email ?? "").toLowerCase().includes(needle),
      )
    : users;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs text-[var(--rf-ink-soft)]">
          {users.length} member{users.length === 1 ? "" : "s"}. Change roles
          (assign or remove Meeting Host / Admin) and ban or unban accounts.
        </p>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search…"
          className="w-40 border-[3px] border-[var(--rf-ink)] bg-white px-2 py-1 text-xs rounded"
        />
      </div>
      <div className="grid gap-3">
        {filtered.map((u) => (
          <UserRow key={u.user_id} u={u} isSelf={u.user_id === currentUserId} />
        ))}
        {filtered.length === 0 && (
          <p className="text-sm text-[var(--rf-ink-soft)]">No matching members.</p>
        )}
      </div>
    </div>
  );
}
