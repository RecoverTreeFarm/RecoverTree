"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/pixel/ui";
import {
  startGardenEvent,
  endGardenEvent,
  distributeGardenRewards,
} from "@/app/admin/actions";

/** Row shape returned by list_admin_community_garden(). */
export type AdminGardenEvent = {
  id: string;
  status: "active" | "completed" | "expired" | "cancelled";
  starts_at: string;
  ends_at: string;
  required_water: number;
  required_seeds: number;
  required_fertilizer: number;
  current_water: number;
  current_seeds: number;
  current_fertilizer: number;
  progress_percent: number;
  contributor_count: number;
  completed_at: string | null;
  rewards_distributed_at: string | null;
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/**
 * Community Garden management: see the shared event, start one when none is
 * running, end the active one, and re-run reward distribution if it never
 * fired. Goals/limits/rewards are configured under Game settings.
 */
export function GardenAdmin({ events }: { events: AdminGardenEvent[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmEnd, setConfirmEnd] = useState<string | null>(null);

  const active = events.find((e) => e.status === "active") ?? null;

  function run(fn: () => Promise<{ ok: boolean; message?: string }>, okText: string) {
    setBanner(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setBanner({ ok: false, text: r.message ?? "Something went wrong." });
      else {
        setBanner({ ok: true, text: okText });
        router.refresh();
      }
      setConfirmEnd(null);
    });
  }

  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="pixel-heading text-lg">Community Garden</h2>
            <p className="text-[11px] text-[var(--rf-ink-soft)]">
              One shared garden at a time. Goals, daily limits, and rewards live
              under Game settings → Community Garden.
            </p>
          </div>
          {!active && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(startGardenEvent, "Community Garden opened. 🌳")}
              className="pixel-btn text-[11px] disabled:opacity-50"
            >
              Start a garden event
            </button>
          )}
        </div>

        {banner && (
          <p
            role={banner.ok ? "status" : "alert"}
            className={`mt-2 rounded border-2 border-[var(--rf-ink)] px-3 py-2 text-xs font-bold ${
              banner.ok ? "bg-[var(--rf-grass)]" : "bg-[var(--rf-red)] text-[var(--rf-cream)]"
            }`}
          >
            {banner.text}
          </p>
        )}
      </Panel>

      {events.length === 0 && (
        <Panel>
          <p className="text-sm text-[var(--rf-ink-soft)]">
            No garden events yet. Start one above, or leave the weekly schedule
            to open the next one on Monday.
          </p>
        </Panel>
      )}

      {events.map((e) => {
        const needsDistribution =
          e.status !== "active" && e.status !== "cancelled" && !e.rewards_distributed_at;
        return (
          <Panel key={e.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span
                  className={`rounded border-2 border-[var(--rf-ink)] px-2 py-0.5 text-[10px] font-extrabold uppercase ${
                    e.status === "active"
                      ? "bg-[var(--rf-grass)]"
                      : e.status === "completed"
                        ? "bg-[var(--rf-gold)]"
                        : "bg-[var(--rf-cream)] text-[var(--rf-ink-soft)]"
                  }`}
                >
                  {e.status}
                </span>
                <span className="ml-2 text-[11px] text-[var(--rf-ink-soft)]">
                  {fmt(e.starts_at)} → {fmt(e.ends_at)}
                </span>
              </div>
              <div className="flex gap-2">
                {e.status === "active" &&
                  (confirmEnd === e.id ? (
                    <>
                      <span className="self-center text-[11px] font-bold">End this garden now?</span>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => run(() => endGardenEvent(e.id), "Garden event ended.")}
                        className="pixel-btn text-[11px] disabled:opacity-50"
                        style={{ background: "var(--rf-red)", color: "var(--rf-cream)" }}
                      >
                        Yes, end it
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => setConfirmEnd(null)}
                        className="pixel-btn pixel-btn--secondary text-[11px]"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => setConfirmEnd(e.id)}
                      className="pixel-btn pixel-btn--secondary text-[11px]"
                    >
                      End event
                    </button>
                  ))}
                {needsDistribution && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      run(() => distributeGardenRewards(e.id), "Rewards distributed (if any were due).")
                    }
                    className="pixel-btn pixel-btn--blue text-[11px] disabled:opacity-50"
                  >
                    Distribute rewards
                  </button>
                )}
              </div>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <div>
                <p className="text-[10px] font-bold uppercase text-[var(--rf-ink-soft)]">💧 Water</p>
                <p className="font-extrabold">
                  {e.current_water} / {e.required_water}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase text-[var(--rf-ink-soft)]">🌰 Seeds</p>
                <p className="font-extrabold">
                  {e.current_seeds} / {e.required_seeds}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase text-[var(--rf-ink-soft)]">🧴 Fertilizer</p>
                <p className="font-extrabold">
                  {e.current_fertilizer} / {e.required_fertilizer}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase text-[var(--rf-ink-soft)]">Progress</p>
                <p className="font-extrabold">{e.progress_percent}%</p>
              </div>
            </div>

            <p className="mt-2 text-[11px] text-[var(--rf-ink-soft)]">
              {e.contributor_count} contributor{e.contributor_count === 1 ? "" : "s"}
              {e.completed_at && ` · bloomed ${fmt(e.completed_at)}`}
              {e.rewards_distributed_at
                ? ` · rewards sent ${fmt(e.rewards_distributed_at)}`
                : e.status !== "active"
                  ? " · no rewards sent"
                  : ""}
            </p>
          </Panel>
        );
      })}
    </div>
  );
}
