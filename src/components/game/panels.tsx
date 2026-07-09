"use client";

import Link from "next/link";
import { Fruit } from "@/components/pixel/Sprite";
import { SPRITES } from "@/lib/sprites";

/* ---------------------------------------------------------------------------
 * Small presentational windows opened from the bottom game menu. These were
 * the always-visible dashboard cards; content is unchanged, just relocated.
 * ------------------------------------------------------------------------- */

export type ChecklistItem = {
  key: string;
  name: string;
  description: string | null;
  progress: number;
  target: number;
  completed: boolean;
  water_reward: number;
  fertilizer_reward: number;
};

export type LeaderboardRow = {
  rank: number;
  username: string | null;
  display_name: string | null;
  fruit_total: number;
  visibility: "public" | "anonymous" | "hidden";
  is_self: boolean;
};

export function InventoryPanel({
  farm,
}: {
  farm: {
    seasonName: string;
    fruitTotal: number;
    water: number;
    seeds: number;
    fertilizer: number;
    treeCount: number;
  };
}) {
  const rows: { icon: React.ReactNode; label: string; value: number; hint: string }[] = [
    { icon: <span aria-hidden>💧</span>, label: "Water", value: farm.water, hint: "Earn by attending or hosting meetings and giving Seeds. Each plant drinks 10 per growth stage." },
    { icon: <Fruit scale={1.7} />, label: "Fruits", value: farm.fruitTotal, hint: "Your Season score — only harvesting trees makes Fruits." },
    { icon: <span aria-hidden>✨</span>, label: "Fertilizer", value: farm.fertilizer, hint: "Win medals, badges, and goals. Instantly ripens a waiting tree." },
    { icon: <img src={SPRITES.seedPacket} alt="" className="pixelated h-5 w-5" />, label: "Seeds to plant", value: farm.seeds, hint: "Received from other farmers — plant one to grow an extra tree." },
    { icon: <span aria-hidden>🌳</span>, label: "Trees", value: farm.treeCount, hint: "More trees = a bigger harvest (max 20)." },
  ];
  return (
    <div>
      <p className="mb-3 text-[11px] uppercase tracking-wide text-[var(--rf-ink-soft)]">
        {farm.seasonName}
      </p>
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.label} className="flex items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded border-2 border-[var(--rf-ink)] bg-white text-lg">
              {r.icon}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-extrabold">
                {r.value} <span className="font-bold">{r.label}</span>
              </p>
              <p className="text-[11px] text-[var(--rf-ink-soft)]">{r.hint}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ChecklistPanel({ checklist }: { checklist: ChecklistItem[] }) {
  const done = checklist.filter((c) => c.completed).length;
  return (
    <div>
      <p className="mb-3 text-[11px] font-bold text-[var(--rf-ink-soft)]">
        {done}/{checklist.length} done — goals reshuffle each month. Completing
        one automatically earns 💧 water + ✨ fertilizer.
      </p>
      <ul className="space-y-2.5">
        {checklist.map((c) => {
          const pct = Math.min(100, Math.round((c.progress / c.target) * 100));
          return (
            <li key={c.key}>
              <div className="flex items-center gap-2 text-sm">
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center border-2 border-[var(--rf-ink)] text-xs"
                  style={{ background: c.completed ? "var(--rf-grass)" : "var(--rf-cream)" }}
                >
                  {c.completed ? "✓" : ""}
                </span>
                <span className={`flex-1 ${c.completed ? "line-through opacity-70" : ""}`}>
                  {c.name}
                </span>
                <span className="flex shrink-0 items-center gap-1 text-[11px] font-bold text-[var(--rf-ink-soft)]">
                  💧{c.water_reward}
                  {c.fertilizer_reward > 0 && <span>✨{c.fertilizer_reward}</span>}
                </span>
              </div>
              {c.target > 1 && (
                <div className="ml-7 mt-1 flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)]">
                    <div
                      className="h-full"
                      style={{ width: `${pct}%`, background: "var(--rf-gold)" }}
                    />
                  </div>
                  <span className="text-[10px] font-bold text-[var(--rf-ink-soft)]">
                    {Math.min(c.progress, c.target)}/{c.target}
                  </span>
                </div>
              )}
            </li>
          );
        })}
        {checklist.length === 0 && (
          <p className="text-sm text-[var(--rf-ink-soft)]">No goals yet this Season.</p>
        )}
      </ul>
    </div>
  );
}

export function LeaderboardPanel({ rows }: { rows: LeaderboardRow[] }) {
  return (
    <div>
      {rows.length === 0 ? (
        <p className="text-xs text-[var(--rf-ink-soft)]">
          No Fruits yet this Season — be the first to grow some! 🌱
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r, i) => {
            const anon = r.visibility === "anonymous";
            const name = anon
              ? "Anonymous Farmer"
              : r.display_name || (r.username ? `@${r.username}` : "Farmer");
            return (
              <li
                key={`${r.rank}-${i}`}
                className="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm"
                style={{ background: r.is_self ? "rgba(242,193,78,0.35)" : "transparent" }}
              >
                <span className="flex items-center gap-2 truncate">
                  <span className="w-5 font-extrabold">{r.rank}</span>
                  {r.visibility === "public" && r.username ? (
                    <Link href={`/profile/${r.username}`} className="truncate font-bold underline">
                      {name}
                    </Link>
                  ) : (
                    <span className="truncate font-bold">{name}</span>
                  )}
                  {r.is_self && (
                    <span className="rounded border border-[var(--rf-ink)] bg-[var(--rf-gold)] px-1 text-[9px] font-extrabold uppercase">
                      you
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-1 font-bold">
                  <Fruit scale={1} /> {r.fruit_total}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <Link href="/leaderboard" className="mt-3 inline-block text-[11px] font-bold underline">
        See the full leaderboard
      </Link>
    </div>
  );
}
