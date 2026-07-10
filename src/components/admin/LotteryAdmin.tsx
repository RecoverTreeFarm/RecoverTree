"use client";

import { useState, useTransition } from "react";
import { forceResolveLotteryRound, cancelLotteryRound } from "@/app/admin/actions";

/** One round as returned by get_admin_lottery_rounds (already privacy-fine
 *  for admins — winner shown by username). */
export type AdminLotteryRound = {
  round_id: string;
  week_key: string;
  status: string;
  opens_at: string;
  sales_close_at: string;
  draw_at: string;
  ticket_price_coins: number;
  max_tickets_per_user: number;
  orchard_bonus_percent: number;
  total_tickets: number;
  distinct_participant_count: number;
  player_funded_pot_coins: number;
  orchard_bonus_coins: number;
  final_prize_coins: number;
  winner_username: string | null;
  resolved_at: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  sales_closed: "Sales closed",
  drawn: "Drawn",
  no_entries: "No entries",
  refunded_single_participant: "Refunded (1 farmer)",
  cancelled: "Cancelled",
  scheduled: "Scheduled",
};

/**
 * Admin → Lottery: current + past rounds with the numbers that matter, plus
 * Force resolve (testing) and Cancel & refund. Both server functions are
 * idempotent and audit-logged; repeating them never double-pays.
 */
export function LotteryAdmin({ rounds }: { rounds: AdminLotteryRound[] }) {
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<{ id: string; kind: "resolve" | "cancel" } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function run(id: string, kind: "resolve" | "cancel") {
    setConfirm(null);
    setMsg(null);
    startTransition(async () => {
      const r =
        kind === "resolve"
          ? await forceResolveLotteryRound(id)
          : await cancelLotteryRound(id, "cancelled from the admin console");
      setMsg(r.ok ? (kind === "resolve" ? "Round resolved." : "Round cancelled and tickets refunded.") : r.message);
    });
  }

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  if (rounds.length === 0) {
    return (
      <p className="text-sm text-[var(--rf-ink-soft)]">
        No lottery rounds yet — the first one is created automatically when the week begins
        (or the first time someone opens the Lottery panel).
      </p>
    );
  }

  return (
    <div>
      <p className="mb-3 text-xs text-[var(--rf-ink-soft)]">
        Tickets and prizes are Coins only. Force resolve applies the real Sunday rules
        (one farmer → refund; two+ → draw). Cancel refunds every valid ticket exactly once.
        Both are audit-logged.
      </p>
      {msg && (
        <p role="status" className="mb-3 rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-3 py-1.5 text-xs font-bold">
          {msg}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-xs">
          <thead>
            <tr className="border-b-2 border-[var(--rf-ink)] text-left">
              <th className="px-2 py-1.5">Week</th>
              <th className="px-2 py-1.5">Status</th>
              <th className="px-2 py-1.5">Draw</th>
              <th className="px-2 py-1.5">Tickets</th>
              <th className="px-2 py-1.5">Farmers</th>
              <th className="px-2 py-1.5">Pot 🪙</th>
              <th className="px-2 py-1.5">Bonus 🪙</th>
              <th className="px-2 py-1.5">Prize 🪙</th>
              <th className="px-2 py-1.5">Winner</th>
              <th className="px-2 py-1.5">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rounds.map((r) => {
              const active = r.status === "open" || r.status === "sales_closed";
              return (
                <tr key={r.round_id} className="border-b border-dashed border-[var(--rf-ink)]/30 align-top">
                  <td className="px-2 py-1.5 font-bold">{r.week_key}</td>
                  <td className="px-2 py-1.5">{STATUS_LABEL[r.status] ?? r.status}</td>
                  <td className="px-2 py-1.5">{fmt(r.draw_at)}</td>
                  <td className="px-2 py-1.5">{r.total_tickets}</td>
                  <td className="px-2 py-1.5">{r.distinct_participant_count}</td>
                  <td className="px-2 py-1.5">{r.player_funded_pot_coins}</td>
                  <td className="px-2 py-1.5">
                    {r.status === "drawn" ? r.orchard_bonus_coins : `${r.orchard_bonus_percent}%`}
                  </td>
                  <td className="px-2 py-1.5">{r.final_prize_coins}</td>
                  <td className="px-2 py-1.5">{r.winner_username ? `@${r.winner_username}` : "—"}</td>
                  <td className="px-2 py-1.5">
                    {active ? (
                      confirm?.id === r.round_id ? (
                        <span className="flex flex-wrap gap-1">
                          <button type="button" disabled={pending} onClick={() => run(r.round_id, confirm.kind)}
                            className="rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-gold)] px-1.5 py-0.5 font-extrabold disabled:opacity-50">
                            Confirm {confirm.kind === "resolve" ? "resolve" : "cancel"}
                          </button>
                          <button type="button" disabled={pending} onClick={() => setConfirm(null)}
                            className="rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-1.5 py-0.5 font-extrabold disabled:opacity-50">
                            Back
                          </button>
                        </span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          <button type="button" disabled={pending}
                            onClick={() => setConfirm({ id: r.round_id, kind: "resolve" })}
                            className="rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-1.5 py-0.5 font-extrabold hover:bg-[var(--rf-gold)] disabled:opacity-50">
                            Force resolve
                          </button>
                          <button type="button" disabled={pending}
                            onClick={() => setConfirm({ id: r.round_id, kind: "cancel" })}
                            className="rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-1.5 py-0.5 font-extrabold hover:bg-[var(--rf-red)]/20 disabled:opacity-50">
                            Cancel &amp; refund
                          </button>
                        </span>
                      )
                    ) : (
                      <span className="text-[var(--rf-ink-soft)]">
                        {r.resolved_at ? `resolved ${fmt(r.resolved_at)}` : "—"}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
