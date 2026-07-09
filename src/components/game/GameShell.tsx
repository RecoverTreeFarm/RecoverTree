"use client";

import { useEffect, useRef, useState } from "react";
import { FarmPanel, type FarmPanelHandle, type FarmItemKind } from "@/components/pixel/FarmPanel";
import { SeedPanel, type SeedMember } from "@/components/pixel/SeedPanel";
import { BasketPanel, type BasketState } from "@/components/pixel/BasketPanel";
import { CodeForm } from "@/components/meeting/CodeForm";
import { Sprite } from "@/components/pixel/Sprite";
import type { TreeView } from "@/components/pixel/FarmScene";
import { ProfilePanel, type ProfileInfo } from "./ProfilePanel";
import { ChecklistPanel, LeaderboardPanel, InventoryPanel } from "./panels";
import type { ChecklistItem, LeaderboardRow } from "./panels";
import { NotificationCenter, type FarmNotification } from "./NotificationCenter";
import { WikiHelp } from "./WikiPanel";
import { GoosePanel } from "./GoosePanel";
import type { GooseState } from "@/lib/goose";
import { HOUSE_SPRITES, SPRITES, seasonEmoji } from "@/lib/sprites";

type PanelId =
  | "inventory"
  | "code"
  | "seed"
  | "basket"
  | "goose"
  | "checklist"
  | "leaderboard"
  | "profile";

export type GameShellProps = {
  greetName: string;
  /** random affirmation picked server-side (from the provided list) */
  affirmation: string;
  /** house key → display name (admin-renamable) */
  houseNames: Record<string, string>;
  avatarSrc: string;
  houseKey: string;
  trees: TreeView[];
  farm: {
    seasonName: string;
    fruitTotal: number;
    water: number;
    seeds: number;
    fertilizer: number;
    treeCount: number;
  };
  /** whole days until the current season ends (null if unknown) */
  seasonDaysLeft: number | null;
  /** 1..5 position in the season cycle — picks the header icon */
  seasonCyclePosition: number | null;
  members: SeedMember[];
  sentToday: boolean;
  sentToName: string | null;
  basket: BasketState | null;
  goose: GooseState | null;
  checklist: ChecklistItem[];
  leaderboard: LeaderboardRow[];
  profile: ProfileInfo;
};

/**
 * The dashboard as a cozy game screen: the farm is the canvas, a fixed
 * bottom menu opens everything else in small windows (bottom sheets on
 * mobile, centered windows on desktop).
 */
export function GameShell(props: GameShellProps) {
  const [open, setOpen] = useState<PanelId | null>(null);
  const house = HOUSE_SPRITES[props.houseKey] ?? HOUSE_SPRITES.house_1;
  const farmRef = useRef<FarmPanelHandle | null>(null);

  // Seed notification cadence: once per day — dismissed stays dismissed —
  // UNLESS seeds ran all the way to 0 and came back, which starts a new
  // "cycle" so the notification returns. Tracked per-browser.
  const [seedNotifId, setSeedNotifId] = useState("seeds-pending");
  useEffect(() => {
    let cycle = 0;
    try {
      const prevRaw = window.localStorage.getItem("rf-prev-seeds");
      const prev = prevRaw === null ? null : Number(prevRaw);
      cycle = Number(window.localStorage.getItem("rf-seed-cycle") ?? "0") || 0;
      if (prev === 0 && props.farm.seeds > 0) {
        cycle += 1;
        window.localStorage.setItem("rf-seed-cycle", String(cycle));
      }
      window.localStorage.setItem("rf-prev-seeds", String(props.farm.seeds));
    } catch {
      /* private mode etc. — falls back to the daily id */
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSeedNotifId(`seeds-${new Date().toISOString().slice(0, 10)}-c${cycle}`);
  }, [props.farm.seeds]);

  // Backpack item click → close the window and run the confirmed action on
  // the farm (which then shows its in-place skip control).
  function useItemFromBackpack(kind: FarmItemKind) {
    setOpen(null);
    farmRef.current?.useItem(kind);
  }

  const menu: {
    id: PanelId | "home";
    label: string;
    icon: React.ReactNode;
  }[] = [
    {
      id: "home",
      label: "Farm",
      icon: (
        <img src={house.src} alt="" className="pixelated h-7 w-auto" />
      ),
    },
    { id: "inventory", label: "Items", icon: <span aria-hidden className="text-xl">🎒</span> },
    { id: "code", label: "Code", icon: <span aria-hidden className="text-xl">🔢</span> },
    {
      id: "seed",
      label: "Seed",
      icon: <img src={SPRITES.seedPacket} alt="" className="pixelated h-7 w-7" />,
    },
    { id: "basket", label: "Basket", icon: <span aria-hidden className="text-xl">🧺</span> },
    {
      id: "goose",
      label: "Goose",
      icon: <img src={SPRITES.goose2} alt="" className="pixelated h-6 w-auto" />,
    },
    { id: "checklist", label: "Goals", icon: <span aria-hidden className="text-xl">📋</span> },
    {
      id: "leaderboard",
      label: "Leaders",
      icon: <img src="/awards/medal_gold.png" alt="" className="pixelated h-7 w-auto" />,
    },
    {
      id: "profile",
      label: "Profile",
      icon: <img src={props.avatarSrc} alt="" className="pixelated h-8 w-8" />,
    },
  ];

  const windowTitle: Record<PanelId, string> = {
    inventory: "Your items",
    code: "Enter meeting code",
    seed: "Today’s Seed",
    basket: "Traveling Basket",
    goose: "Golden Goose",
    checklist: "Monthly checklist",
    leaderboard: "Leaderboard",
    profile: "Your farmer",
  };

  return (
    <div className="pb-24">
      {/* Tiny greeting: a quiet affirmation from the provided list */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Sprite src={props.avatarSrc} size={[32, 32]} scale={2.5} alt="" />
          <span className="truncate text-sm font-bold text-[var(--rf-ink-soft)]">
            {props.affirmation}
          </span>
        </div>
        {/* Season chip: emoji + days-left countdown, top-right */}
        <span className="flex shrink-0 items-center gap-1.5">
          {seasonEmoji(props.seasonCyclePosition) && (
            <span aria-hidden className="text-lg leading-none">
              {seasonEmoji(props.seasonCyclePosition)}
            </span>
          )}
          <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--rf-ink-soft)]">
            {props.seasonDaysLeft !== null
              ? `${props.seasonDaysLeft} ${props.seasonDaysLeft === 1 ? "day" : "days"} left in ${props.farm.seasonName}`
              : props.farm.seasonName}
          </span>
        </span>
      </div>

      {/* THE FARM — the main canvas (inventory bar + overlays live inside) */}
      <div className="relative">
        <FarmPanel
          trees={props.trees}
          water={props.farm.water}
          seeds={props.farm.seeds}
          fertilizer={props.farm.fertilizer}
          fruitTotal={props.farm.fruitTotal}
          house={{ src: house.src, w: house.w, h: house.h }}
          avatarSrc={props.avatarSrc}
          handleRef={farmRef}
          showGoose={
            !!props.goose &&
            props.goose.has_event &&
            props.goose.i_am_keeper &&
            (props.goose.status === "answer_collection" || props.goose.status === "selection_open")
          }
          notificationSlot={
            <>
              <NotificationCenter notifications={buildNotifications(props, seedNotifId)} />
              <WikiHelp />
            </>
          }
        />
      </div>

      {/* Window over the farm */}
      {open && (
        <GameWindow title={windowTitle[open]} onClose={() => setOpen(null)}>
          {open === "inventory" && (
            <InventoryPanel farm={props.farm} onUseItem={useItemFromBackpack} />
          )}
          {open === "code" && <CodeForm />}
          {open === "seed" && (
            <SeedPanel
              members={props.members}
              sentToday={props.sentToday}
              sentToName={props.sentToName}
            />
          )}
          {open === "basket" &&
            (props.basket ? (
              <BasketPanel
                state={props.basket}
                myWater={props.farm.water}
                mySeeds={props.farm.seeds}
                myFertilizer={props.farm.fertilizer}
              />
            ) : (
              <p className="text-sm text-[var(--rf-ink-soft)]">
                The Traveling Basket isn’t set up yet.
              </p>
            ))}
          {open === "goose" &&
            (props.goose ? (
              <GoosePanel state={props.goose} />
            ) : (
              <p className="text-sm text-[var(--rf-ink-soft)]">
                The Golden Goose isn’t set up yet.
              </p>
            ))}
          {open === "checklist" && <ChecklistPanel checklist={props.checklist} />}
          {open === "leaderboard" && <LeaderboardPanel rows={props.leaderboard} />}
          {open === "profile" && (
            <ProfilePanel
              profile={props.profile}
              houseKey={props.houseKey}
              houseNames={props.houseNames}
            />
          )}
        </GameWindow>
      )}

      {/* Fixed bottom game menu */}
      {/* z-[60] keeps the menu tappable above an open window's backdrop, so
          tapping another icon switches panels directly (mobile-game feel). */}
      <nav
        aria-label="Game menu"
        className="fixed inset-x-0 bottom-0 z-[60]"
        style={{ background: "var(--rf-grass)", borderTop: "3px solid var(--rf-ink)" }}
      >
        <div className="mx-auto flex max-w-3xl items-stretch justify-around px-1 py-1.5">
          {menu.map((m) => {
            const active = m.id !== "home" && open === m.id;
            return (
              <button
                key={m.id}
                type="button"
                aria-label={m.label}
                aria-pressed={active}
                onClick={() => setOpen(m.id === "home" ? null : active ? null : (m.id as PanelId))}
                className={`flex min-w-0 flex-1 flex-col items-center justify-end gap-0.5 rounded border-2 px-0.5 py-1 ${
                  active
                    ? "border-[var(--rf-ink)] bg-[var(--rf-gold)]"
                    : "border-transparent hover:border-[var(--rf-ink)] hover:bg-[var(--rf-cream)]"
                }`}
              >
                <span className="flex h-8 items-end justify-center">{m.icon}</span>
                <span className="text-[9px] font-extrabold uppercase tracking-wide text-[var(--rf-ink)]">
                  {m.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

/**
 * Derive notifications from current app state (MVP — no notification table).
 * Ids embed the relevant counts/ids so a dismissed notification resurfaces
 * only when the underlying state actually changes.
 */
function buildNotifications(props: GameShellProps, seedNotifId: string): FarmNotification[] {
  const out: FarmNotification[] = [];

  if (props.farm.seeds > 0) {
    out.push({
      // Daily id (+ a 0→positive "cycle" bump) — dismissing it holds for the
      // whole day and count changes don't resurface it.
      id: seedNotifId,
      text:
        props.farm.seeds === 1
          ? "You received a Seed — it’s ready to plant. 🌰"
          : `You have ${props.farm.seeds} Seeds ready to plant. 🌰`,
    });
  }

  const ready = props.trees.filter((t) => t.stage === 5).length;
  if (ready > 0) {
    out.push({
      id: `ready-${ready}`,
      text:
        ready === 1
          ? "A tree is ready to harvest. 🧺"
          : `${ready} trees are ready to harvest. 🧺`,
    });
  }

  for (const goal of props.checklist) {
    if (goal.completed) {
      out.push({
        id: `goal-${goal.key}`,
        text: `Goal reached: ${goal.name}. Your farm got a little boost. ✨`,
      });
    }
  }

  const b = props.basket;
  if (b?.has_chain && b.status === "active") {
    if (b.i_hold_it) {
      out.push({
        id: `basket-held-${b.chain_id}`,
        text: "The Traveling Basket is in your hands! Keep it or pass it along.",
      });
    } else if (!b.i_touched_it) {
      out.push({
        id: `basket-today-${b.chain_id}`,
        text: "The Traveling Basket is traveling today — it may come your way.",
      });
    }
  }
  if (b?.my_rewards && b.my_rewards.length > 0) {
    out.push({
      id: `basket-reward-${b.chain_id}`,
      text: "The Traveling Basket brought you a little gift. 🧺",
    });
  }

  // Golden Goose
  const g = props.goose;
  if (g?.has_event) {
    if (g.my_rewards.some((r) => r.reason.startsWith("golden_goose_egg"))) {
      out.push({
        id: `goose-egg-${g.assignment_id}`,
        text: "Your answer won the Golden Goose Egg — 1 seed, 1 fertilizer, and 10 water! 🥚",
      });
    }
    if (g.i_am_keeper && g.status === "answer_collection") {
      out.push({
        id: `goose-keeper-${g.assignment_id}`,
        text: "You’re the Golden Goose Keeper! Ask your question in the chat — answers are open.",
      });
    }
    if (g.i_am_keeper && g.status === "selection_open") {
      out.push({
        id: `goose-pick-${g.assignment_id}`,
        text: "It’s time to pick your favorite Golden Goose answer before the goose flies away.",
      });
    }
    if (!g.i_am_keeper && g.status === "answer_collection" && !g.i_submitted) {
      out.push({
        id: `goose-open-${g.assignment_id}`,
        text: "A Golden Goose Request is open — check the chat, then submit your answer.",
      });
    }
  }

  return out;
}

/** Small game window: bottom sheet on mobile, centered window on desktop. */
function GameWindow({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div
        className="pixel-panel absolute inset-x-0 bottom-16 mx-auto flex max-h-[72vh] w-full flex-col rounded-t-xl border-b-0 p-0 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[80vh] sm:w-[min(92vw,30rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:border-b-[3px]"
      >
        <div
          className="flex items-center justify-between px-4 py-2"
          style={{ borderBottom: "2px solid var(--rf-ink)" }}
        >
          <h2 className="pixel-heading text-base">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close window"
            className="rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-2 py-0.5 text-xs font-extrabold hover:bg-[var(--rf-gold)]"
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

