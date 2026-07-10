"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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
// `useFertilizer` is a server action, not a hook — aliased so the hooks
// linter doesn't mistake calls in loops for hook calls.
import {
  waterTrees,
  plantSeed,
  useFertilizer as applyFertilizer,
  waterOneTree,
  fertilizeOneTree,
  harvestOneTree,
} from "@/app/dashboard/actions";
import { playSfx } from "@/lib/sfx";
import { Fruit } from "./Sprite";
import { GooseSprite } from "./GooseSprite";
import { MapHud } from "@/components/game/MapPanel";
import { SPRITES } from "@/lib/sprites";

const WATER_PER_PLANT = 10; // each plant drinks its own 10 water per stage

export type FarmItemKind = "water" | "fert" | "seed";

/** Imperative handle so the backpack (Items window) can run a confirmed
 *  item action on the farm. */
export type FarmPanelHandle = { useItem: (kind: FarmItemKind) => void };

/**
 * Interactive farm — tap-to-play.
 *  - Inventory items use a TWO-STEP confirm: first tap shows "Water all?" /
 *    "Fertilize all?" / "Plant all?", second tap runs it — and the SAME
 *    button becomes the ⏭ skip control while its animation plays.
 *  - Tap a plant (or empty patch) for a small contextual action menu.
 *  - Tree changes render OPTIMISTICALLY after an action succeeds, so the
 *    farm never flashes the stale pre-action state while the server refresh
 *    is in flight.
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
  avatarSrc,
  handleRef,
}: {
  trees: TreeView[];
  water: number;
  seeds: number;
  fertilizer: number;
  fruitTotal: number;
  house?: { src: string; w: number; h: number };
  /** rendered top-right over the farm (notifications + guidebook) */
  notificationSlot?: React.ReactNode;
  /** the Golden Goose is hanging out on this farm (user is the Keeper) */
  showGoose?: boolean;
  /** the player's chosen farmer sprite */
  avatarSrc?: string;
  /** lets the backpack window trigger confirmed item actions */
  handleRef?: React.MutableRefObject<FarmPanelHandle | null>;
}) {
  const router = useRouter();
  const [farmerAnim, setFarmerAnim] = useState<FarmerAnim>("idle");
  const [farmerPos, setFarmerPos] = useState<FarmerPos | null>(null);
  const [activeTree, setActiveTree] = useState<number | null>(null);
  const [readyBurst, setReadyBurst] = useState<{ id: number; indexes: number[] } | null>(null);
  const [fertBurst, setFertBurst] = useState<{ id: number; index: number } | null>(null);
  const [popId, setPopId] = useState(0);
  const [running, setRunning] = useState<"water" | "plant" | "fert" | null>(null);
  /** "bulk" = an inventory item is applying to everything; "single" = one plant */
  const [runScope, setRunScope] = useState<"bulk" | "single">("bulk");
  const [skipStage, setSkipStage] = useState(0); // 0 none, 1 fast (10x), 2 full
  // the harvest close-up targets exactly one tree
  const [cinematicIndex, setCinematicIndex] = useState<number | null>(null);
  const [cinematicTree, setCinematicTree] = useState<string | null>(null);
  const cinematic = cinematicIndex !== null;
  /** slot index that just blossomed — drives the one-shot cherry sparkle */
  const [cherryPop, setCherryPop] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [confirmItem, setConfirmItem] = useState<FarmItemKind | null>(null);
  // Optimistic view of the trees after an action succeeds — cleared as soon
  // as fresh server data arrives, so the farm never shows the stale state.
  const [override, setOverride] = useState<TreeView[] | null>(null);
  const [pending, startTransition] = useTransition();

  const speed = useRef(1);
  const full = useRef(false);
  const currentSkip = useRef<null | (() => void)>(null);
  const cinematicDone = useRef(false);
  const itemBarRef = useRef<HTMLDivElement>(null);
  const calloutRef = useRef<HTMLButtonElement>(null);
  const burstSeq = useRef(0); // particle-burst keys (avoids Date.now in traced code)

  const viewTrees = override ?? trees;

  useEffect(() => {
    // fresh server data arrived — drop the optimistic override
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOverride(null);
  }, [trees]);

  /** The cherry tree's moment: a sparkle ring + its own chime. */
  function celebrateCherry(index: number) {
    playSfx("cherry");
    setCherryPop(index);
    setTimeout(() => setCherryPop(null), 800);
  }

  // A blossom can also appear via the BULK water path (which can't say which
  // tree rolled it). Notice new blossoms in the refreshed data and celebrate.
  const prevBlossoms = useRef<number | null>(null);
  useEffect(() => {
    const blossoms = trees.filter((t) => t.isBlossom).length;
    const prev = prevBlossoms.current;
    prevBlossoms.current = blossoms;
    if (prev !== null && blossoms > prev) {
      const idx = trees.findIndex((t) => t.isBlossom);
      playSfx("cherry");
      setCherryPop(idx >= 0 ? idx : null);
      const t = setTimeout(() => setCherryPop(null), 800);
      return () => clearTimeout(t);
    }
  }, [trees]);

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
  const waitingTargets = trees
    .map((t, i) => (t.stage === 4 && t.readyAt && new Date(t.readyAt).getTime() > now ? i : -1))
    .filter((i) => i >= 0);
  const bearingCount = trees.filter((t) => t.stage === 5).length;
  const fertCount = Math.min(fertilizer, waitingTargets.length);
  const plantable = Math.min(seeds, MAX_TREES - trees.length);
  const canPlant = seeds > 0 && trees.length < MAX_TREES && !busy;

  /* -------------------------------------------------------------------------
   * Inventory item flow: tap → "… all?" confirm → tap again → run everything
   * that item can do. While the action animates, the SAME button is the ⏭
   * skip control (first tap 10×, second tap skips all).
   * ---------------------------------------------------------------------- */
  function onItemClick(kind: FarmItemKind) {
    // In-place skip while this item's own action is running.
    if (running === "water" && kind === "water") return triggerSkip();
    if (running === "plant" && kind === "seed") return triggerSkip();
    if (running === "fert" && kind === "fert") return triggerSkip();
    if (busy) return;

    if (confirmItem === kind) {
      setConfirmItem(null);
      execItem(kind);
      return;
    }

    // First tap: validate, then arm the confirm prompt.
    setMessage(null);
    if (kind === "water") {
      if (water < WATER_PER_PLANT) {
        setMessage("Not enough water yet — attend a meeting to earn more. 💧");
        return;
      }
      if (wateringTargets.length === 0) {
        setMessage("No thirsty plants right now.");
        return;
      }
    }
    if (kind === "fert") {
      if (fertilizer < 1) return;
      if (waitingTargets.length === 0) {
        setMessage(
          bearingCount > 0
            ? "Harvest-ready plants don’t need fertilizer."
            : "No plant needs fertilizer right now.",
        );
        return;
      }
    }
    if (kind === "seed") {
      if (seeds < 1) return;
      if (trees.length >= MAX_TREES) {
        setMessage("No empty plot right now.");
        return;
      }
    }
    setConfirmItem(kind);
  }

  function execItem(kind: FarmItemKind) {
    if (kind === "water") void handleWater();
    if (kind === "fert") void handleFertilizeAll(fertCount);
    if (kind === "seed") void handlePlantAll(plantable);
  }

  // The backpack (Items window) confirms in its own UI, then calls this.
  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      useItem: (kind) => {
        if (busy) return;
        execItem(kind);
      },
    };
    return () => {
      handleRef.current = null;
    };
  });

  // An armed confirm relaxes after 5s or when tapping anywhere else.
  useEffect(() => {
    if (!confirmItem) return;
    const t = setTimeout(() => setConfirmItem(null), 5000);
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (itemBarRef.current?.contains(t) || calloutRef.current?.contains(t)) return;
      setConfirmItem(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => {
      clearTimeout(t);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [confirmItem]);

  async function walkTo(pos: FarmerPos | null) {
    setFarmerAnim("walk");
    setFarmerPos(pos);
    await iSleep(600);
  }

  async function handleWater() {
    setMessage(null);
    setReadyBurst(null);
    resetSkip();
    setRunScope("bulk");
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
        // optimistic: advance the watered plants so the farm doesn't flash
        // the pre-watering state while the refresh is in flight
        setOverride(
          trees.map((t, i) =>
            wateringTargets.includes(i)
              ? {
                  ...t,
                  stage: Math.min(t.stage + 1, 4),
                  readyAt:
                    t.stage === 3
                      ? new Date(Date.now() + 4 * 3_600_000).toISOString()
                      : t.readyAt,
                }
              : t,
          ),
        );
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

  /** Plant up to `count` seeds, walking to each new plot. */
  async function handlePlantAll(count: number) {
    setMessage(null);
    resetSkip();
    setRunScope("bulk");
    setRunning("plant");
    playSfx("click");

    let planted = trees.length;
    const grown: TreeView[] = [...trees];
    let lastError: string | null = null;

    for (let i = 0; i < count && planted < MAX_TREES; i++) {
      await walkTo(farmerPosForTree(planted));
      if (!full.current) {
        setFarmerAnim("tilt");
        await iSleep(600);
      }
      const result = await plantSeed();
      if (!result.ok) {
        lastError = result.message;
        break;
      }
      playSfx("plant");
      grown.push({ stage: 1 });
      setOverride([...grown]); // optimistic: the sprout appears immediately
      planted += 1;
    }

    void walkTo(null);
    setFarmerAnim("idle");
    setRunning(null);
    resetSkip();
    if (lastError) {
      playSfx("error");
      setMessage(lastError);
    } else if (planted > trees.length) {
      setMessage(`Planted! You now have ${planted} trees — a bigger harvest awaits. 🌱`);
    }
    startTransition(() => router.refresh());
  }

  /** Ripen up to `count` waiting trees (server picks blossoms first). */
  async function handleFertilizeAll(count: number) {
    setMessage(null);
    resetSkip();
    setRunScope("bulk");
    setRunning("fert");

    const targets = waitingTargets.slice(0, count);
    const next = [...trees];
    let used = 0;
    let left = fertilizer;

    for (const idx of targets) {
      const result = await applyFertilizer();
      if (!result.ok) {
        playSfx("error");
        setMessage(result.message);
        break;
      }
      playSfx("reveal");
      burstSeq.current += 1;
      setFertBurst({ id: burstSeq.current, index: idx });
      next[idx] = { ...next[idx], stage: 5, readyAt: null };
      setOverride([...next]); // optimistic: fruit appears immediately
      left = result.fertilizer_left;
      used += 1;
      await iSleep(500);
    }

    setRunning(null);
    resetSkip();
    if (used > 0) {
      setMessage(
        `✨ Fertilized ${used} ${used === 1 ? "tree" : "trees"} — harvest when you’re ready. ${left} fertilizer left.`,
      );
    }
    startTransition(() => router.refresh());
  }

  /** Runs when the harvest close-up ends: harvests the ONE tree it showed. */
  function finishCinematic() {
    if (cinematicDone.current) return;
    cinematicDone.current = true;
    const index = cinematicIndex;
    const treeId = cinematicTree;
    setCinematicIndex(null);
    setCinematicTree(null);
    setSelectedSlot(null);
    if (index === null || !treeId) return;

    // optimistic: that tree resets to a sprout right away — no flash of a
    // still-fruity tree while the refresh lands
    setOverride(
      trees.map((t, i) => (i === index ? { ...t, stage: 1, readyAt: null, isBlossom: false } : t)),
    );
    startTransition(async () => {
      const result = await harvestOneTree(treeId);
      if (!result.ok) {
        playSfx("error");
        setOverride(null); // roll the optimistic reset back
        setMessage(result.message);
      } else {
        setMessage(
          result.was_blossom
            ? `🌸 Harvested the cherry blossom for ${result.fruits_earned} Fruits — double! 🎉`
            : `Harvested for ${result.fruits_earned} Fruits! 🎉`,
        );
      }
      router.refresh();
    });
  }

  /* -------------------------------------------------------------------------
   * SINGLE-PLANT actions. Tapping a plant acts on THAT plant only — never on
   * the rest of the plot. While the action animates, the little action button
   * becomes a ⏭ Skip that just fast-forwards this one plant's animation.
   * ---------------------------------------------------------------------- */

  async function handleWaterOne(index: number, treeId: string) {
    setMessage(null);
    setReadyBurst(null);
    resetSkip();
    setRunScope("single");
    setRunning("water");
    playSfx("click");

    await walkTo(farmerPosForTree(index));
    if (!full.current) {
      setFarmerAnim("tilt");
      setActiveTree(index);
      playSfx("water");
    }
    await iSleep(600);
    setActiveTree(null);
    void walkTo(null);

    startTransition(async () => {
      const result = await waterOneTree(treeId);
      setFarmerAnim("idle");
      setRunning(null);
      setSelectedSlot(null);
      resetSkip();
      if (!result.ok) {
        playSfx("error");
        setMessage(result.message);
      } else {
        setOverride(
          trees.map((t, i) =>
            i === index
              ? {
                  ...t,
                  stage: result.new_stage,
                  readyAt:
                    result.new_stage === 4
                      ? new Date(Date.now() + 4 * 3_600_000).toISOString()
                      : t.readyAt,
                  isBlossom: result.became_blossom || t.isBlossom,
                }
              : t,
          ),
        );
        if (result.new_stage === 4) setReadyBurst({ id: Date.now(), indexes: [index] });
        if (result.became_blossom) celebrateCherry(index);
        setMessage(
          result.became_blossom
            ? `🌸 A cherry blossom! It pays double when you harvest it. 💧 ${result.water_left} water left.`
            : result.new_stage === 4
              ? `Fully watered — fruit in 4 hours. 💧 ${result.water_left} water left.`
              : `Watered! 💧 ${result.water_left} water left.`,
        );
      }
      router.refresh();
    });
  }

  function handleFertilizeOne(index: number, treeId: string) {
    setMessage(null);
    setRunScope("single");
    setRunning("fert");
    startTransition(async () => {
      const result = await fertilizeOneTree(treeId);
      setRunning(null);
      setSelectedSlot(null);
      if (!result.ok) {
        playSfx("error");
        setMessage(result.message);
      } else {
        playSfx("reveal");
        setFertBurst({ id: Date.now(), index });
        setOverride(trees.map((t, i) => (i === index ? { ...t, stage: 5, readyAt: null } : t)));
        setMessage(
          `✨ Fertilized! Harvest it when you’re ready. ${result.fertilizer_left} fertilizer left.`,
        );
      }
      router.refresh();
    });
  }

  function handleHarvestOne(index: number, treeId: string) {
    setMessage(null);
    cinematicDone.current = false;
    setCinematicIndex(index);
    setCinematicTree(treeId);
    setTimeout(() => playSfx("harvest"), 550);
  }

  /** Actions for the currently selected slot — only what's applicable now.
   *  Each acts on THIS plant alone. */
  function actionsForSlot(index: number): SlotAction[] {
    // mid-action: the button turns into a Skip for this plant's animation
    if (running === "water" && selectedSlot === index) {
      return [
        {
          icon: <span aria-hidden>{skipStage === 0 ? "⏭" : "⏭⏭"}</span>,
          label: "Skip this animation",
          onClick: triggerSkip,
        },
      ];
    }
    if (busy) return [];

    const acts: SlotAction[] = [];
    const tree = index < trees.length ? trees[index] : null;

    if (!tree) {
      if (canPlant) {
        acts.push({
          icon: <span aria-hidden>🌱</span>,
          label: "Plant a seed here",
          onClick: () => void handlePlantAll(1),
        });
      }
      return acts;
    }
    if (!tree.id) return acts; // pre-migration data: no single-tree actions

    if (tree.stage < 4 && water >= WATER_PER_PLANT) {
      acts.push({
        icon: <span aria-hidden>💧</span>,
        label: "Water this plant",
        onClick: () => void handleWaterOne(index, tree.id!),
      });
    }
    // Fertilizer only ripens a WAITING tree — never a harvest-ready one.
    const waiting = tree.stage === 4 && tree.readyAt && new Date(tree.readyAt).getTime() > now;
    if (waiting && fertilizer > 0) {
      acts.push({
        icon: <span aria-hidden>✨</span>,
        label: "Fertilize this plant (ripens it now)",
        onClick: () => handleFertilizeOne(index, tree.id!),
      });
    }
    if (tree.stage === 5) {
      acts.push({
        icon: <span aria-hidden>🧺</span>,
        label: "Harvest this tree",
        onClick: () => handleHarvestOne(index, tree.id!),
      });
    }
    return acts;
  }

  /* ---- item button rendering -------------------------------------------- */

  // Wooden plate from the UI sprite sheet; the confirm/skip states override
  // its tint via inline styles so the label stays legible in every state.
  const itemBtn =
    "ui-btn-plate flex items-center gap-1.5 px-2 py-1 text-sm font-extrabold disabled:cursor-not-allowed";

  function itemState(kind: FarmItemKind): "skip" | "confirm" | "idle" {
    // Only a BULK run turns the inventory button into its own skip control;
    // a single-plant action's skip lives on that plant's action button.
    if (
      runScope === "bulk" &&
      ((running === "water" && kind === "water") ||
        (running === "plant" && kind === "seed") ||
        (running === "fert" && kind === "fert"))
    ) {
      return "skip";
    }
    return confirmItem === kind ? "confirm" : "idle";
  }

  function itemDisabled(kind: FarmItemKind, empty: boolean): boolean {
    if (itemState(kind) === "skip") return false; // must stay tappable to skip
    return busy || empty;
  }

  function itemLabel(kind: FarmItemKind): React.ReactNode {
    const state = itemState(kind);
    if (state === "skip") return <span aria-hidden>{skipStage === 0 ? "⏭" : "⏭⏭"}</span>;
    if (state === "confirm") {
      if (kind === "water") return <>Water all? ({wateringTargets.length})</>;
      if (kind === "fert") return <>Fertilize all? ({fertCount})</>;
      return <>Plant all? ({plantable})</>;
    }
    if (kind === "water") return <><span aria-hidden>💧</span> {water}</>;
    if (kind === "fert") return <><span aria-hidden>✨</span> {fertilizer}</>;
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={SPRITES.seedPacket} alt="" className="pixelated h-4 w-4" /> {seeds}
      </>
    );
  }

  /** Tint the wooden plate per state — never swap its background, or the
   *  9-slice frame would be painted over. Text stays cream on all three. */
  function itemStyle(kind: FarmItemKind): React.CSSProperties {
    const state = itemState(kind);
    if (state === "confirm") {
      return { filter: "brightness(1.3) saturate(1.4)", outline: "2px solid var(--rf-gold)" };
    }
    if (state === "skip") return { filter: "brightness(0.62)" };
    return {};
  }

  const seedState = itemState("seed");

  return (
    <div className="relative">
      {/* Inventory — tap once to see "… all?", tap again to do it all */}
      <div ref={itemBarRef} className="mb-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => onItemClick("water")}
          disabled={itemDisabled("water", water < WATER_PER_PLANT)}
          className={itemBtn} style={itemStyle("water")}
          title="Water your thirsty plants (oldest first)">
          {itemLabel("water")}
        </button>
        <button type="button" onClick={() => onItemClick("fert")}
          disabled={itemDisabled("fert", fertilizer < 1)}
          className={itemBtn} style={itemStyle("fert")}
          title="Ripen waiting trees (pink blossoms first)">
          {itemLabel("fert")}
        </button>
        <button type="button" onClick={() => onItemClick("seed")}
          disabled={itemDisabled("seed", seeds < 1)}
          className={itemBtn} style={itemStyle("seed")}
          title="Plant seeds in the open plots">
          {itemLabel("seed")}
        </button>
        <span className="ml-1 inline-flex items-center gap-1 text-sm font-extrabold" title="Fruits this Season">
          <Fruit scale={1.7} /> {fruitTotal}
        </span>
        <span className="text-sm font-extrabold" title="Trees">
          🌳 {viewTrees.length}
        </span>
      </div>

      <div className="relative">
        <FarmScene
          trees={viewTrees}
          fruitTotal={fruitTotal}
          farmerAnim={farmerAnim}
          farmerPos={farmerPos}
          farmerSrc={avatarSrc}
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
          cherryPop={cherryPop}
        />
        {cinematicIndex !== null && (
          <HarvestCinematic
            onDone={finishCinematic}
            fruitIndex={cinematicIndex}
            isBlossom={trees[cinematicIndex]?.isBlossom ?? false}
            farmerSrc={avatarSrc}
          />
        )}

        {/* The harvest close-up covers the whole farm, so its skip lives on
            the cinematic itself (the menu button that started it is gone). */}
        {cinematic && (
          <button
            type="button"
            onClick={finishCinematic}
            className="pixel-btn pixel-btn--secondary absolute bottom-2 left-1/2 z-30 -translate-x-1/2 text-xs"
          >
            ⏭ Skip
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

        {/* Top-right HUD: "!" notifications on top, "?" guidebook below.
            z-40 keeps the guidebook/notification overlays ABOVE the Plant
            Seed callout (z-30) so nothing pokes through them. */}
        <div className="absolute right-2 top-2 z-40 flex flex-col items-end gap-1.5">
          {notificationSlot}
        </div>

        {/* Bottom-right HUD: the map button (always) with the Plant Seed
            callout stacked above it when Seeds are available.
            z-50 (above the z-40 notification HUD) because the map MODAL is
            rendered inside this wrapper's stacking context. */}
        <div className="absolute bottom-2 right-2 z-50 flex flex-col items-end gap-1.5">
          <MapHud />
        </div>

        {/* Plant Seed callout — above the map button.
            Mirrors the seed item button: confirm first, skip while running. */}
        {seeds > 0 && !cinematic && (
          <button
            type="button"
            ref={calloutRef}
            onClick={() => onItemClick("seed")}
            disabled={itemDisabled("seed", seeds < 1)}
            className="absolute bottom-12 right-2 z-30 flex items-center gap-1.5 rounded-lg border-2 px-2.5 py-1.5 text-[11px] font-extrabold uppercase tracking-wide shadow-[2px_2px_0_rgba(58,42,26,0.25)] active:translate-y-px disabled:opacity-50"
            style={{
              background:
                seedState === "confirm"
                  ? "var(--rf-gold)"
                  : seedState === "skip"
                    ? "var(--rf-ink)"
                    : "var(--rf-cream)",
              borderColor: "var(--rf-ink)",
              color: seedState === "skip" ? "var(--rf-cream)" : "var(--rf-ink)",
            }}
          >
            {seedState === "skip" ? (
              <span aria-hidden>{skipStage === 0 ? "⏭" : "⏭⏭"}</span>
            ) : seedState === "confirm" ? (
              <>Plant all? ({plantable})</>
            ) : (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={SPRITES.seedPacket} alt="" className="pixelated h-5 w-5" />
                Plant Seed{seeds > 1 ? ` ×${seeds}` : ""}
              </>
            )}
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
