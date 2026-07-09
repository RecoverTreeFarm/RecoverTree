"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/pixel/ui";
import {
  debugSetInventory,
  debugGiveBundle,
  debugResetInventory,
  debugRipenTrees,
  debugAdvanceTime,
  debugRunGameTick,
  debugEndSeasonNow,
} from "@/app/admin/actions";

export type DebugInventoryRow = {
  user_id: string;
  username: string;
  display_name: string | null;
  water: number;
  seeds: number;
  fertilizer: number;
  fruit_total: number;
  tree_count: number;
};

export type DebugEventStates = {
  season: { name: string; cycle_position: number | null; starts_at: string; ends_at: string } | null;
  basket: {
    id: string;
    status: string;
    basket_date: string;
    target_participant_count: number;
    expires_at: string;
    holder: string | null;
  } | null;
  goose: {
    id: string;
    status: string;
    assigned_date: string;
    selection_deadline_at: string;
    keeper: string | null;
  } | null;
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleString([], { dateStyle: "short", timeStyle: "short" });

/**
 * DEBUG-ONLY admin tools. This tab only renders when the
 * `debug_settings_enabled` game setting is on, and every action below calls a
 * SECURITY DEFINER RPC that re-checks admin + the debug switch server-side
 * and writes an audit-log row. Inventory edits touch Water/Seeds/Fertilizer
 * only — Fruits are never granted here.
 */
export function DebugTools({
  players,
  events,
}: {
  players: DebugInventoryRow[];
  events: DebugEventStates | null;
}) {
  return (
    <div className="grid gap-4">
      <p
        className="rounded border-2 px-3 py-2 text-xs font-bold"
        style={{ borderColor: "var(--rf-ink)", background: "var(--rf-gold)" }}
      >
        🧪 Debug tools — for testing only. Every change here is server-validated,
        admin-only, and recorded in the audit log. Turn off “Enabled Debug
        Settings” in Game settings when you’re done.
      </p>

      <section>
        <h3 className="pixel-heading mb-2 text-base">Player inventories</h3>
        <p className="mb-2 text-xs text-[var(--rf-ink-soft)]">
          Edit Water / Seeds / Fertilizer for this season’s farms. Fruits are
          shown for reference only — they can’t be edited (Fruits only come
          from harvesting).
        </p>
        <div className="grid gap-2">
          {players.map((p) => (
            <PlayerRow key={p.user_id} p={p} />
          ))}
          {players.length === 0 && (
            <p className="text-sm text-[var(--rf-ink-soft)]">No farms this season yet.</p>
          )}
        </div>
      </section>

      <section>
        <h3 className="pixel-heading mb-2 text-base">Time & events</h3>
        <TimeTools events={events} />
      </section>
    </div>
  );
}

function PlayerRow({ p }: { p: DebugInventoryRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [water, setWater] = useState(String(p.water));
  const [seeds, setSeeds] = useState(String(p.seeds));
  const [fert, setFert] = useState(String(p.fertilizer));
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  function run(fn: () => Promise<{ ok: boolean; message?: string }>, okMsg: string) {
    setMsg(null);
    startTransition(async () => {
      const r = await fn();
      setMsg(r.ok ? okMsg : (r.message ?? "Something went wrong."));
      setConfirmReset(false);
      if (r.ok) router.refresh();
    });
  }

  const numCls =
    "w-20 rounded border-2 border-[var(--rf-ink)] bg-white/80 px-1.5 py-1 text-sm";
  const btnCls = "pixel-btn pixel-btn--secondary text-[11px] disabled:opacity-50";

  return (
    <Panel className="!p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold">@{p.username}</span>
        <span className="text-[11px] text-[var(--rf-ink-soft)]">
          🍒 {p.fruit_total} fruits (read-only) · 🌳 {p.tree_count} trees
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-[11px] font-bold">
          💧 Water
          <input type="number" min={0} max={1000000} value={water} disabled={pending}
            onChange={(e) => setWater(e.target.value)} className={`${numCls} mt-0.5 block`} />
        </label>
        <label className="text-[11px] font-bold">
          🌰 Seeds
          <input type="number" min={0} max={1000000} value={seeds} disabled={pending}
            onChange={(e) => setSeeds(e.target.value)} className={`${numCls} mt-0.5 block`} />
        </label>
        <label className="text-[11px] font-bold">
          ✨ Fertilizer
          <input type="number" min={0} max={1000000} value={fert} disabled={pending}
            onChange={(e) => setFert(e.target.value)} className={`${numCls} mt-0.5 block`} />
        </label>
        <button type="button" disabled={pending} className="pixel-btn text-[11px] disabled:opacity-50"
          onClick={() =>
            run(
              () => debugSetInventory(p.user_id, Number(water) || 0, Number(seeds) || 0, Number(fert) || 0),
              "Inventory saved.",
            )
          }>
          Save
        </button>
        <button type="button" disabled={pending} className={btnCls}
          title="+25 water, +2 seeds, +2 fertilizer (server-side preset)"
          onClick={() => run(() => debugGiveBundle(p.user_id), "Bundle granted (+25💧 +2🌰 +2✨).")}>
          Give bundle
        </button>
        <button type="button" disabled={pending} className={btnCls}
          title="Set all growing trees to ready-to-harvest"
          onClick={() => run(() => debugRipenTrees(p.user_id), "Trees are ready to harvest.")}>
          Ripen trees
        </button>
        {confirmReset ? (
          <span className="flex items-center gap-1.5">
            <span className="text-[11px] font-bold">Zero out items?</span>
            <button type="button" disabled={pending} className="pixel-btn text-[11px]"
              style={{ background: "var(--rf-red)", color: "var(--rf-cream)" }}
              onClick={() => run(() => debugResetInventory(p.user_id), "Inventory reset to 0 / 0 / 0.")}>
              Yes, reset
            </button>
            <button type="button" disabled={pending} className={btnCls} onClick={() => setConfirmReset(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <button type="button" disabled={pending} className={btnCls} onClick={() => setConfirmReset(true)}>
            Reset to 0
          </button>
        )}
      </div>
      {msg && (
        <p role="status" className="mt-2 rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-2 py-1 text-[11px] font-bold">
          {msg}
        </p>
      )}
    </Panel>
  );
}

function TimeTools({ events }: { events: DebugEventStates | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [hours, setHours] = useState("4");
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState("");

  function run(fn: () => Promise<{ ok: boolean; message?: string }>, okMsg: string) {
    setMsg(null);
    startTransition(async () => {
      const r = await fn();
      setMsg(r.ok ? okMsg : (r.message ?? "Something went wrong."));
      setConfirmEnd("");
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="grid gap-2">
      <Panel className="!p-3">
        <h4 className="mb-1 text-xs font-extrabold uppercase tracking-wide">Advance time</h4>
        <p className="mb-2 text-[11px] text-[var(--rf-ink-soft)]">
          Pulls every pending timer closer by N hours: tree fruit timers, the
          Basket hold, Goose deadlines, and the season’s end date. Then run the
          game tick so expired timers resolve immediately.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select value={hours} onChange={(e) => setHours(e.target.value)} disabled={pending}
            className="rounded border-2 border-[var(--rf-ink)] bg-white/80 px-1.5 py-1 text-sm">
            <option value="1">1 hour</option>
            <option value="4">4 hours (fruit timer)</option>
            <option value="24">24 hours (a day)</option>
            <option value="48">48 hours (goose cycle)</option>
            <option value="168">168 hours (a week)</option>
          </select>
          <button type="button" disabled={pending} className="pixel-btn text-[11px] disabled:opacity-50"
            onClick={() => run(() => debugAdvanceTime(Number(hours)), `Advanced time by ${hours}h.`)}>
            Advance
          </button>
          <button type="button" disabled={pending} className="pixel-btn pixel-btn--secondary text-[11px] disabled:opacity-50"
            title="Runs season close + basket auto-advance + goose auto-close right now"
            onClick={() => run(() => debugRunGameTick(), "Game tick ran — timed events resolved.")}>
            Run game tick now
          </button>
        </div>
        <p className="mt-2 text-[11px] text-[var(--rf-ink-soft)]">
          TODO: “Simulate a new day / end of week” isn’t offered yet — daily
          mechanics (Seed of the day, basket days) key off the calendar DATE,
          not timestamps, so a clean version needs a game-clock offset the
          backend doesn’t have. Advancing hours + running the tick covers
          every timer-based event today.
        </p>
      </Panel>

      <Panel className="!p-3">
        <h4 className="mb-1 text-xs font-extrabold uppercase tracking-wide">End season now</h4>
        <p className="mb-2 text-[11px] text-[var(--rf-ink-soft)]">
          Ends the active season immediately and runs the full ceremony
          (medals, badges, fertilizer, next season in the cycle). This affects
          every player — type <b>END SEASON</b> to confirm.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input type="text" value={confirmEnd} disabled={pending}
            onChange={(e) => setConfirmEnd(e.target.value)} placeholder="Type END SEASON"
            className="rounded border-2 border-[var(--rf-ink)] bg-white/80 px-1.5 py-1 text-sm" />
          <button type="button" disabled={pending || confirmEnd !== "END SEASON"}
            className="pixel-btn text-[11px] disabled:opacity-50"
            style={{ background: "var(--rf-red)", color: "var(--rf-cream)" }}
            onClick={() => run(() => debugEndSeasonNow(), "Season ended — ceremony ran and the next season started.")}>
            End season + run ceremony
          </button>
        </div>
      </Panel>

      <Panel className="!p-3">
        <h4 className="mb-1 text-xs font-extrabold uppercase tracking-wide">Current event states</h4>
        {events ? (
          <div className="grid gap-1 text-[11px] font-bold">
            <p>
              🗓️ Season: {events.season
                ? `${events.season.name} · ends ${fmt(events.season.ends_at)}`
                : "none active"}
            </p>
            <p>
              🧺 Basket: {events.basket
                ? `${events.basket.status} · ${events.basket.basket_date} · holder ${events.basket.holder ?? "—"} · hold until ${fmt(events.basket.expires_at)}`
                : "no chains yet"}
            </p>
            <p>
              🪿 Goose: {events.goose
                ? `${events.goose.status} · ${events.goose.assigned_date} · keeper ${events.goose.keeper ?? "—"} · deadline ${fmt(events.goose.selection_deadline_at)}`
                : "no events yet"}
            </p>
            <p className="text-[var(--rf-ink-soft)]">
              Baskets and Geese start lazily on their scheduled days (or via the
              game tick). To force one today: Game settings → set the schedule
              to Specific with today enabled, then run the game tick.
            </p>
          </div>
        ) : (
          <p className="text-[11px] text-[var(--rf-ink-soft)]">Couldn’t load event states.</p>
        )}
      </Panel>

      {msg && (
        <p role="status" className="rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-2 py-1 text-[11px] font-bold">
          {msg}
        </p>
      )}
    </div>
  );
}
