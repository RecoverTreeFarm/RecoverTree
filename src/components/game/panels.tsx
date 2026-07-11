"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Fruit, PixelIcon } from "@/components/pixel/Sprite";
import { SPRITES } from "@/lib/sprites";
import type { FarmItemKind } from "@/components/pixel/FarmPanel";
import { ICON } from "@/lib/icons";

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
  /** 🪙 coins granted when the goal completes */
  coin_reward: number;
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
  onUseItem,
}: {
  farm: {
    seasonName: string;
    fruitTotal: number;
    water: number;
    seeds: number;
    fertilizer: number;
    coins: number;
    treeCount: number;
  };
  /** confirmed backpack item use — the shell closes this window and runs it */
  onUseItem?: (kind: FarmItemKind) => void;
}) {
  // Same two-step confirm as the farm's item bar: first tap arms "… all?",
  // second tap hands off to the farm (which then shows the skip control).
  const [confirm, setConfirm] = useState<FarmItemKind | null>(null);
  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(null), 5000);
    return () => clearTimeout(t);
  }, [confirm]);

  const rows: {
    icon: React.ReactNode;
    label: string;
    value: number;
    hint: string;
    kind?: FarmItemKind;
    confirmLabel?: string;
  }[] = [
    { icon: <PixelIcon name="water" size={20} />, label: "Water", value: farm.water, hint: "Earn by attending or hosting meetings and giving Seeds. Each plant drinks 10 per growth stage.", kind: "water", confirmLabel: "Water all?" },
    { icon: <Fruit scale={1.7} />, label: "Fruits", value: farm.fruitTotal, hint: "Your Season score — only harvesting trees makes Fruits." },
    { icon: <PixelIcon name="fertilizer" size={20} />, label: "Fertilizer", value: farm.fertilizer, hint: "Win medals, badges, and goals. Instantly ripens a waiting tree.", kind: "fert", confirmLabel: "Fertilize all?" },
    { icon: <img src={SPRITES.seedPacket} alt="" className="pixelated h-5 w-5" />, label: "Seeds to plant", value: farm.seeds, hint: "Received from other farmers — plant one to grow an extra tree.", kind: "seed", confirmLabel: "Plant all?" },
    { icon: <PixelIcon name="coin" size={20} />, label: "Coins", value: farm.coins, hint: "Earned alongside Seed and Fertilizer rewards. For future shop goodies — Coins never affect the leaderboard." },
    { icon: <span aria-hidden>🌳</span>, label: "Trees", value: farm.treeCount, hint: "More trees = a bigger harvest (max 20)." },
  ];

  return (
    <div>
      <p className="mb-3 text-[11px] uppercase tracking-wide text-[var(--rf-ink-soft)]">
        {farm.seasonName}
      </p>
      <ul className="space-y-3">
        {rows.map((r) => {
          const usable = !!onUseItem && !!r.kind && r.value > 0;
          const armed = usable && confirm === r.kind;
          const body = (
            <>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded border-2 border-[var(--rf-ink)] bg-white text-lg">
                {r.icon}
              </span>
              <div className="min-w-0 text-left">
                <p className="text-sm font-extrabold">
                  {armed ? (
                    <span className="rounded bg-[var(--rf-gold)] px-1.5">{r.confirmLabel}</span>
                  ) : (
                    <>
                      {r.value} <span className="font-bold">{r.label}</span>
                    </>
                  )}
                </p>
                <p className="text-[11px] text-[var(--rf-ink-soft)]">
                  {armed ? "Tap again to use everything you can." : r.hint}
                </p>
              </div>
            </>
          );
          return (
            <li key={r.label}>
              {usable ? (
                <button
                  type="button"
                  className="flex w-full items-start gap-3 rounded border-2 border-transparent p-1 hover:border-[var(--rf-ink)] hover:bg-[var(--rf-cream)]"
                  onClick={() => {
                    if (armed) {
                      setConfirm(null);
                      onUseItem?.(r.kind!);
                    } else {
                      setConfirm(r.kind!);
                    }
                  }}
                >
                  {body}
                </button>
              ) : (
                <div className="flex items-start gap-3 p-1">{body}</div>
              )}
            </li>
          );
        })}
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
        one automatically earns {ICON.water} water, {ICON.fertilizer} fertilizer,
        and {ICON.coin} coins.
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
                  {c.water_reward > 0 && <span>{ICON.water}{c.water_reward}</span>}
                  {c.fertilizer_reward > 0 && <span>{ICON.fertilizer}{c.fertilizer_reward}</span>}
                  {c.coin_reward > 0 && <span>{ICON.coin}{c.coin_reward}</span>}
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

/* ---------------------------------------------------------------------------
 * Mailbox — the KudoSeed inbox (opened from the mailbox beside the house).
 * Lists KudoSeeds received recently and offers to send one back, disabled
 * once today's KudoSeed has been sent. Extensible: only seeds arrive here for
 * now, but the "mail" framing leaves room for future kinds.
 * ------------------------------------------------------------------------- */
const fmtMailDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function MailPanel({
  kudoseeds,
  sentToday,
  onSend,
}: {
  kudoseeds: { from: string; message: string | null; given_on_date: string }[];
  sentToday: boolean;
  onSend: () => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--rf-ink-soft)]">
        Your mailbox. Right now you get KudoSeeds here — more kinds of mail are
        coming in a future update. 🌱
      </p>

      {kudoseeds.length === 0 ? (
        <p className="rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-3 py-4 text-center text-sm text-[var(--rf-ink-soft)]">
          📭 No mail yet. When a neighbor sends you a KudoSeed, it’ll arrive here.
        </p>
      ) : (
        <ul className="space-y-2">
          {kudoseeds.map((k, i) => (
            <li
              key={i}
              className="rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] p-2.5"
            >
              <div className="flex items-center gap-2">
                <PixelIcon name="seed" size={18} />
                <span className="text-sm font-extrabold">
                  {k.from} sent you a KudoSeed
                </span>
              </div>
              {k.message && (
                <p className="mt-1 text-xs italic text-[var(--rf-ink-soft)]">
                  “{k.message}”
                </p>
              )}
              <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-[var(--rf-ink-soft)]">
                {fmtMailDate(k.given_on_date)}
              </p>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={onSend}
        disabled={sentToday}
        title={
          sentToday
            ? "You already sent today’s KudoSeed"
            : "Send a KudoSeed to a neighbor"
        }
        className="w-full rounded border-2 border-[var(--rf-ink)] px-3 py-2 text-sm font-extrabold uppercase tracking-wide text-[var(--rf-ink)] disabled:cursor-not-allowed disabled:opacity-50"
        style={{ background: sentToday ? "var(--rf-cream)" : "var(--rf-gold)" }}
      >
        {sentToday ? "✅ KudoSeed sent today" : "🌱 Send a KudoSeed"}
      </button>
    </div>
  );
}
