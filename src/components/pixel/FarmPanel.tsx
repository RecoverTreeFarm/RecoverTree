"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  FarmScene,
  farmerPosForTree,
  MAX_TREES,
  type TreeView,
  type FarmerAnim,
  type FarmerPos,
  type SlotAction,
} from "./FarmScene";
import { HarvestCinematic } from "./HarvestCinematic";
import { waterTrees, harvestTrees, plantSeed, useFertilizer } from "@/app/dashboard/actions";
import { playSfx } from "@/lib/sfx";
import { Fruit } from "./Sprite";
import { GooseSprite } from "./GooseSprite";
import { SPRITES } from "@/lib/sprites";

const WATER_PER_PLANT = 10; // each plant drinks its own 10 water per stage

/**
 * Interactive farm — tap-to-play.
 *  - Tap a plant (or empty patch) to open a small contextual action menu:
 *    water / fertilize / harvest / plant, only when actually available.
 *  - Watering pours for the whole plot (each plant drinks its own 10 water,
 *    oldest first) — the DB farm loop is unchanged.
 *  - Timers are hidden until hover/selection (subtle ring only).
 */
export function FarmPanel({
  trees,
  water,
  seeds,
  fertilizer,
  fruitTotal,
  house,
  notificationSlot,
  showGoose = false,
}: {
  trees: TreeView[];
  water: number;
  seeds: number;
  fertilizer: number;
  fruitTotal: number;
  house?: { src: string; w: number; h: number };
  /** rendered bottom-left over the farm (the notification center) */
  notificationSlot?: React.ReactNode;
  /** the Golden Goose is hanging out on this farm (user is the Keeper) */
  showGoose?: boolean;
}) {
  const router = useRouter();
  const [farmerAnim, setFarmerAnim] = useState<FarmerAnim>("idle");
  const [farmerPos, setFarmerPos] = useState<FarmerPos | null>(null);
  const [activeTree, setActiveTree] = useState<number | null>(null);
  const [readyBurst, setReadyBurst] = useState<{ id: number; indexes: number[] } | null>(null);
  const [fertBurst, setFertBurst] = useState<{ id: number; index: number } | null>(null);
  const [popId, setPopId] = useState(0);
  const [running, setRunning] = useState<"water" | "plant" | null>(null);
  const [skipStage, setSkipStage] = useState(0); // 0 none, 1 fast (10x), 2 full
  const [cinematic, setCinematic] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  const speed = useRef(1);
  const full = useRef(false);
  const currentSkip = useRef<null | (() => void)>(null);
  const cinematicDone = useRef(false);

  function iSleep(ms: number) {
    if (full.current) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        currentSkip.current = null;
        resolve();
      }, ms / speed.current);
      currentSkip.current = () => {
        clearTimeout(t);
        resolve();
      };
    });
  }

  function triggerSkip() {
    if (speed.current === 1) {
      speed.current = 10; // first click: 10× speed
      setSkipStage(1);
    } else {
      full.current = true; // second click: skip everything
      setSkipStage(2);
    }
    currentSkip.current?.();
    currentSkip.current = null;
  }

  function resetSkip() {
    speed.current = 1;
    full.current = false;
    setSkipStage(0);
  }

  const busy = running !== null || cinematic || pending;
  const now = Date.now();
  const waterableIdx = trees.map((t, i) => (t.stage < 4 ? i : -1)).filter((i) => i >= 0);
  // each plant drinks its own 10 water; oldest plants drink first
  const affordable = Math.floor(water / WATER_PER_PLANT);
  const wateringTargets = waterableIdx.slice(0, affordable);
  const waitingIdx = trees.findIndex(
    (t) => t.stage === 4 && t.readyAt && new Date(t.readyAt).getTime() > now,
  );
  const bearingCount = trees.filter((t) => t.stage === 5).length;
  const canWater = wateringTargets.length > 0 && !busy;
  const canPlant = seeds > 0 && trees.length < MAX_TREES && !busy;

  /* -------------------------------------------------------------------------
   * Inventory item usage — clicking an item auto-applies it to a valid
   * target (never wasting an item when no target exists).
   *  - Water: waters the plot (each plant drinks 10, oldest first). A pink
   *    blossom tree can never be thirsty under current rules (the blossom is
   *    rolled when a tree FINISHES growing), so there is no cherry-priority
   *    case for water — documented fallback to normal logic.
   *  - Fertilizer: the server now ripens a waiting PINK BLOSSOM tree first
   *    (2x harvest), then the oldest waiting tree. Harvest-ready trees never
   *    accept fertilizer.
   *  - Seed: plants into the next open plot.
   * ---------------------------------------------------------------------- */
  function useWaterItem() {
    if (busy) return;
    if (water < WATER_PER_PLANT) {
      setMessage("Not enough water yet — attend a meeting to earn more. 💧");
      return;
    }
    if (wateringTargets.length === 0) {
      setMessage("No thirsty plants right now.");
      return;
    }
    void handleWater();
  }

  function useFertilizerItem() {
    if (busy || fertilizer < 1) return;
    if (waitingIdx < 0) {
      setMessage(
        bearingCount > 0
          ? "Harvest-ready plants don’t need fertilizer."
          : "No plant needs fertilizer right now.",
      );
      return;
    }
    handleFertilize();
  }

  function useSeedItem() {
    if (busy || seeds < 1) return;
    if (trees.length >= MAX_TREES) {
      setMessage("No empty plot right now.");
      return;
    }
    void handlePlant();
  }

  async function walkTo(pos: FarmerPos | null) {
    setFarmerAnim("walk");
    setFarmerPos(pos);
    await iSleep(600);
  }

  async function handleWater() {
    setMessage(null);
    setReadyBurst(null);
    resetSkip();
    setRunning("water");
    playSfx("click");

    const becomingReady = wateringTargets.filter((i) => trees[i].stage === 3);

    for (const i of wateringTargets) {
      await walkTo(farmerPosForTree(i));
      if (!full.current) {
        setFarmerAnim("tilt");
        setActiveTree(i);
        playSfx("water");
      }
      await iSleep(600);
      setActiveTree(null);
    }

    if (full.current) playSfx("water");
    void walkTo(null);
    startTransition(async () => {
      const result = await waterTrees();
      setFarmerAnim("idle");
      setRunning(null);
      resetSkip();
      if (!result.ok) {
        playSfx("error");
        setMessage("Couldn’t water just now — try again.");
      } else if (result.trees_advanced > 0) {
        if (becomingReady.length > 0) {
          setReadyBurst({ id: Date.now(), indexes: becomingReady });
          setMessage(
            `Watered ${result.trees_advanced} ${result.trees_advanced === 1 ? "plant" : "plants"}! ${becomingReady.length} fully watered — fruit in 4 hours. 💧 ${result.water_left} water left.`,
          );
        } else {
          setMessage(
            `Watered ${result.trees_advanced} ${result.trees_advanced === 1 ? "plant" : "plants"}! 💧 ${result.water_left} water left.`,
          );
        }
      } else {
        setMessage("Nothing to water right now.");
      }
      router.refresh();
    });
  }

  async function handlePlant() {
    setMessage(null);
    resetSkip();
    setRunning("plant");
    playSfx("click");

    await walkTo(farmerPosForTree(trees.length));
    if (!full.current) {
      setFarmerAnim("tilt");
      await iSleep(600);
    }

    void walkTo(null);
    startTransition(async () => {
      const result = await plantSeed();
      setFarmerAnim("idle");
      setRunning(null);
      resetSkip();
      if (!result.ok) {
        playSfx("error");
        setMessage(result.message);
      } else {
        playSfx("plant");
        setMessage(
          `Planted! You now have ${result.tree_count} trees — a bigger harvest awaits. 🌱`,
        );
      }
      router.refresh();
    });
  }

  function handleHarvest() {
    setMessage(null);
    cinematicDone.current = false;
    setCinematic(true);
    setTimeout(() => playSfx("harvest"), 550);
  }

  function finishCinematic() {
    if (cinematicDone.current) return;
    cinematicDone.current = true;
    setCinematic(false);
    startTransition(async () => {
      const result = await harvestTrees();
      if (!result.ok) {
        playSfx("error");
        setMessage("Couldn’t harvest just now — try again.");
      } else if (result.trees_harvested > 0) {
        setMessage(
          `Harvested ${result.trees_harvested} ${result.trees_harvested === 1 ? "tree" : "trees"} for ${result.fruits_earned} Fruits! 🎉`,
        );
      }
      router.refresh();
    });
  }

  function handleFertilize() {
    setMessage(null);
    const target = waitingIdx;
    startTransition(async () => {
      const result = await useFertilizer();
      if (!result.ok) {
        playSfx("error");
        setMessage(result.message);
      } else {
        playSfx("reveal");
        if (target >= 0) setFertBurst({ id: Date.now(), index: target });
        setMessage(
          `✨ Fertilized! The tree burst into fruit — harvest it when you’re ready. ${result.fertilizer_left} fertilizer left.`,
        );
      }
      router.refresh();
    });
  }

  /** Actions for the currently selected slot — only what's applicable now.
   *  (Watering/harvesting run the whole plot — same server logic as before;
   *  the plant menu is the entry point, not a per-tree rewrite.) */
  function actionsForSlot(index: number): SlotAction[] {
    if (busy) return [];
    const acts: SlotAction[] = [];
    const tree = index < trees.length ? trees[index] : null;

    if (!tree) {
      if (canPlant) {
        acts.push({
          icon: <span aria-hidden>🌱</span>,
          label: "Plant a seed here",
          onClick: () => {
            setSelectedSlot(null);
            void handlePlant();
          },
        });
      }
      return acts;
    }

    if (tree.stage < 4 && canWater) {
      acts.push({
        icon: <span aria-hidden>💧</span>,
        label: "Water your plants",
        onClick: () => {
          setSelectedSlot(null);
          void handleWater();
        },
      });
    }
    const waiting = tree.stage === 4 && tree.readyAt && new Date(tree.readyAt).getTime() > now;
    if (waiting && fertilizer > 0) {
      acts.push({
        icon: <span aria-hidden>✨</span>,
        label: "Use fertilizer (ripens the oldest waiting tree)",
        onClick: () => {
          setSelectedSlot(null);
          handleFertilize();
        },
      });
    }
    if (tree.stage === 5) {
      acts.push({
        icon: <span aria-hidden>🧺</span>,
        label: "Harvest ripe fruit",
        onClick: () => {
          setSelectedSlot(null);
          handleHarvest();
        },
      });
    }
    return acts;
  }

  const skipLabel = skipStage === 0 ? "⏭ Skip" : "⏭⏭ Skip all";

  const itemBtn =
    "flex items-center gap-1.5 rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-2 py-1 text-sm font-extrabold hover:bg-[var(--rf-gold)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45";

  return (
    <div className="relative">
      {/* Inventory — tap an item to use it on a valid target automatically */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={useWaterItem} disabled={busy || water < WATER_PER_PLANT}
          className={itemBtn} title="Use water — waters your thirsty plants (oldest first)">
          <span aria-hidden>💧</span> {water}
        </button>
        <button type="button" onClick={useFertilizerItem} disabled={busy || fertilizer < 1}
          className={itemBtn} title="Use fertilizer — ripens a waiting tree (pink blossoms first)">
          <span aria-hidden>✨</span> {fertilizer}
        </button>
        <button type="button" onClick={useSeedItem} disabled={busy || seeds < 1}
          className={itemBtn} title="Plant a seed in the next open plot">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={SPRITES.seedPacket} alt="" className="pixelated h-4 w-4" /> {seeds}
        </button>
        <span className="ml-1 inline-flex items-center gap-1 text-sm font-extrabold" title="Fruits this Season">
          <Fruit scale={1.7} /> {fruitTotal}
        </span>
        <span className="text-sm font-extrabold" title="Trees">
          🌳 {trees.length}
        </span>
      </div>

      <div className="relative">
        <FarmScene
          trees={trees}
          fruitTotal={fruitTotal}
          farmerAnim={farmerAnim}
          farmerPos={farmerPos}
          activeTree={activeTree}
          readyBurst={readyBurst}
          fertBurst={fertBurst}
          popId={popId}
          onTreeReady={() => setPopId((n) => n + 1)}
          house={house}
          selectedSlot={selectedSlot}
          onSlotClick={(i, isEmpty) => {
            if (busy) return;
            if (isEmpty && !canPlant) return;
            setSelectedSlot((cur) => (cur === i ? null : i));
          }}
          onDismiss={() => setSelectedSlot(null)}
          // The action closures only read animation refs when clicked, never
          // during render — safe despite the conservative lint trace.
          // eslint-disable-next-line react-hooks/refs
          slotActions={selectedSlot !== null ? actionsForSlot(selectedSlot) : []}
          canSelectEmpty={canPlant}
        />
        {cinematic &&
          (() => {
            // close-up shows the FIRST bearing tree's fruit (harvest processes
            // trees oldest-first, so this is the one being shaken)
            const firstBearing = trees.findIndex((t) => t.stage === 5);
            const target = firstBearing >= 0 ? trees[firstBearing] : null;
            return (
              <HarvestCinematic
                onDone={finishCinematic}
                fruitIndex={firstBearing >= 0 ? firstBearing : 0}
                isBlossom={target?.isBlossom ?? false}
              />
            );
          })()}

        {/* Skip control floats over the farm while an animation runs */}
        {(running !== null || cinematic) && (
          <button
            type="button"
            onClick={cinematic ? finishCinematic : triggerSkip}
            className="pixel-btn pixel-btn--secondary absolute bottom-2 left-1/2 z-30 -translate-x-1/2 text-xs"
          >
            {cinematic ? "⏭ Skip" : skipLabel}
          </button>
        )}

        {/* The Golden Goose hangs out on the Keeper's farm. While the farmer
            is doing something it takes off — full size, flapping, swooping
            around the play area (rf-goose-fly animates left/top waypoints). */}
        {showGoose && (
          <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
            <div
              className={`absolute -translate-x-1/2 ${busy ? "rf-goose-fly" : ""}`}
              style={{ left: "50%", top: "8%" }}
            >
              <GooseSprite flying={busy} scale={1.3} />
            </div>
          </div>
        )}

        {/* Bottom-left sidebar: "!" notifications on top, "?" wiki below */}
        <div className="absolute bottom-2 left-2 z-30 flex flex-col items-start gap-1.5">
          {notificationSlot}
        </div>

        {/* Plant Seed callout — bottom-right, only when Seeds are available */}
        {seeds > 0 && !cinematic && (
          <button
            type="button"
            onClick={useSeedItem}
            disabled={busy}
            className="absolute bottom-2 right-2 z-30 flex items-center gap-1.5 rounded-lg border-2 px-2.5 py-1.5 text-[11px] font-extrabold uppercase tracking-wide shadow-[2px_2px_0_rgba(58,42,26,0.25)] active:translate-y-px disabled:opacity-50"
            style={{ background: "var(--rf-cream)", borderColor: "var(--rf-ink)", color: "var(--rf-ink)" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={SPRITES.seedPacket} alt="" className="pixelated h-5 w-5" />
            Plant Seed{seeds > 1 ? ` ×${seeds}` : ""}
          </button>
        )}
      </div>

      {message && (
        <p
          role="status"
          className="mt-2 inline-block rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-3 py-1.5 text-xs font-bold"
        >
          {message}
        </p>
      )}
    </div>
  );
}
