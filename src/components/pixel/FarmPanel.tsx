"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  FarmScene,
  farmerPosForTree,
  farmerPosForObject,
  BASKET_POS,
  GOOSE_BOX_POS,
  FARMER_POS_FOR_GOOSE,
  MAX_TREES,
  type TreeView,
  type FarmerAnim,
  type FarmerPos,
  type SlotAction,
} from "./FarmScene";
import { FarmBasket, GoldenSubmissionBox } from "./FarmObjects";
import { Mailbox } from "@/components/game/Mailbox";
import { HarvestCinematic } from "./HarvestCinematic";
// `useFertilizer` is a server action, not a hook — aliased so the hooks
// linter doesn't mistake calls in loops for hook calls.
import {
  plantSeed,
  useFertilizer as applyFertilizer,
  waterOneTree,
  fertilizeOneTree,
  harvestOneTree,
} from "@/app/dashboard/actions";
import { playSfx } from "@/lib/sfx";
import { Fruit, PixelIcon } from "./Sprite";
import { GooseSprite } from "./GooseSprite";

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
  coins = 0,
  fruitTotal,
  house,
  notificationSlot,
  showGoose = false,
  avatarSrc,
  handleRef,
  onOpenGoose,
  onOpenBasket,
  basketOnFarm = false,
  submissionBoxRole = null,
  tutorialActive = false,
  tutorialTreeId = null,
  hasMail = false,
  onOpenMail,
  seasonSlot,
}: {
  trees: TreeView[];
  water: number;
  seeds: number;
  fertilizer: number;
  /** 🪙 Coins — spendable currency, shown read-only (no bulk action) */
  coins?: number;
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
  /** clicking the goose opens the Keeper's Golden Goose screen */
  onOpenGoose?: () => void;
  /** clicking the basket opens the Traveling Basket screen */
  onOpenBasket?: () => void;
  /** the Traveling Basket is sitting on this farm */
  basketOnFarm?: boolean;
  /** the Golden Goose box on this farm, and what tapping it does */
  submissionBoxRole?: "submit" | "review" | null;
  /** the first-time tutorial is running — item taps act on ONE tutorial tree
   *  (no "…all?" confirm) so cause/effect is crisp and predictable */
  tutorialActive?: boolean;
  /** the specific tree the tutorial's Water/Fertilizer taps should target */
  tutorialTreeId?: string | null;
  /** the mailbox has unread KudoSeeds (envelope + raised flag) */
  hasMail?: boolean;
  /** open the Mailbox window (received KudoSeeds + send one) */
  onOpenMail?: () => void;
  /** compact season date chip, pinned to the item bar's right end */
  seasonSlot?: React.ReactNode;
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
  /** the farmer is walking over to a tapped basket / goose box */
  const [walkingToObject, setWalkingToObject] = useState(false);
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

  /** the lucky-day popup shown the moment a tree turns into a cherry tree */
  const [cherryAlert, setCherryAlert] = useState(false);

  /** The cherry tree's moment: a sparkle ring + its own chime + the popup. */
  function celebrateCherry(index: number) {
    playSfx("cherry");
    setCherryPop(index);
    setCherryAlert(true);
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
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCherryAlert(true);
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

  const busy = running !== null || cinematic || pending || walkingToObject;
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

    // TUTORIAL: act on the single tutorial tree at once (no "…all?" confirm),
    // so each tap has one clear effect on the plant the coach mark points at.
    if (tutorialActive) {
      setMessage(null);
      if (kind === "seed") {
        if (seeds < 1 || trees.length >= MAX_TREES) return;
        void handlePlantOne();
        return;
      }
      const idx = tutorialTreeId ? trees.findIndex((t) => t.id === tutorialTreeId) : -1;
      const tree = idx >= 0 ? trees[idx] : null;
      if (tree?.id) {
        if (kind === "water") {
          if (water < WATER_PER_PLANT) {
            setMessage("Not enough water yet — attend a meeting to earn more. 💧");
          } else if (tree.stage >= 4) {
            setMessage("This plant is done growing — it doesn’t need more water.");
          } else {
            void handleWaterOne(idx, tree.id);
          }
          return;
        }
        if (kind === "fert") {
          const waiting = tree.stage === 4 && tree.readyAt && new Date(tree.readyAt).getTime() > now;
          if (fertilizer < 1) {
            setMessage("No fertilizer right now.");
          } else if (!waiting) {
            setMessage("Fertilizer works on a fully-watered tree that’s waiting to fruit.");
          } else {
            handleFertilizeOne(idx, tree.id);
          }
          return;
        }
      }
      // no valid tutorial tree yet — fall through to the normal flow
    }

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

  /**
   * Tapping an event object sends the farmer over to it first; the panel only
   * opens once he arrives. (Ignored while another action is animating.)
   */
  async function walkToAndOpen(pos: FarmerPos, open?: () => void) {
    if (busy || !open) return;
    setWalkingToObject(true);
    setFarmerAnim("walk");
    setFarmerPos(pos);
    await new Promise((r) => setTimeout(r, 640)); // matches the CSS transition
    setFarmerAnim("idle");
    setWalkingToObject(false);
    open();
  }

  /**
   * Bulk water (top bar / backpack). The farmer walks to each thirsty plant
   * in turn and waters it — and THAT plant grows immediately, before the
   * farmer moves on, rather than every tree popping at the end.
   *
   * Each step is a real `water_one_tree` call, so growth shown on screen is
   * always a server-confirmed result; the animation never invents one.
   */
  async function handleWater() {
    setMessage(null);
    setReadyBurst(null);
    resetSkip();
    setRunScope("bulk");
    setRunning("water");
    playSfx("click");

    const grown: TreeView[] = [...trees];
    let watered = 0;
    let ripened = 0;
    let waterLeft = water;
    let failure: string | null = null;

    for (const i of wateringTargets) {
      const treeId = trees[i].id;
      if (!treeId) continue;

      await walkTo(farmerPosForTree(i));
      if (!full.current) {
        setFarmerAnim("tilt");
        setActiveTree(i);
        playSfx("water");
        await iSleep(600);
      }
      setActiveTree(null);

      const result = await waterOneTree(treeId);
      if (!result.ok) {
        failure = result.message;
        break;
      }
      // this tree grows RIGHT NOW, before the farmer walks away
      grown[i] = {
        ...grown[i],
        stage: result.new_stage,
        readyAt:
          result.new_stage === 4
            ? // runs inside an async click handler, never during render
              // eslint-disable-next-line react-hooks/purity
              new Date(Date.now() + 4 * 3_600_000).toISOString()
            : grown[i].readyAt,
        isBlossom: result.became_blossom || grown[i].isBlossom,
      };
      setOverride([...grown]);
      waterLeft = result.water_left;
      watered += 1;
      if (result.new_stage === 4) {
        ripened += 1;
        burstSeq.current += 1;
        setReadyBurst({ id: burstSeq.current, indexes: [i] });
      }
      if (result.became_blossom) celebrateCherry(i);
    }

    void walkTo(null);
    setFarmerAnim("idle");
    setRunning(null);
    resetSkip();

    if (failure) {
      playSfx("error");
      setMessage(failure);
    } else if (watered > 0) {
      setMessage(
        ripened > 0
          ? `Watered ${watered} ${watered === 1 ? "plant" : "plants"}! ${ripened} fully watered — fruit in 4 hours. 💧 ${waterLeft} water left.`
          : `Watered ${watered} ${watered === 1 ? "plant" : "plants"}! 💧 ${waterLeft} water left.`,
      );
    } else {
      setMessage("Nothing to water right now.");
    }
    startTransition(() => router.refresh());
  }

  /**
   * Plant ONE seed from the contextual button over a hole (single scope, so
   * the button turns into ⏭ Skip while the farmer walks).
   *
   * TODO(selected-hole planting): the server's `plant_seed` always fills the
   * NEXT open plot, so a seed lands in the first free hole rather than the
   * exact hole you tapped. Honouring the tapped hole needs a `plant_seed(
   * p_slot)` RPC and a slot column on `trees` — a schema change we're not
   * making here. The farmer therefore walks to the plot the seed will really
   * land in, so the animation never lies about where it went.
   */
  async function handlePlantOne() {
    setRunScope("single");
    await handlePlantAll(1, "single");
  }

  /** Plant up to `count` seeds, walking to each new plot. */
  async function handlePlantAll(count: number, scope: "bulk" | "single" = "bulk") {
    setMessage(null);
    resetSkip();
    setRunScope(scope);
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
    setSelectedSlot(null);
    resetSkip();
    if (lastError) {
      playSfx("error");
      setMessage(lastError);
    } else if (planted > trees.length) {
      setMessage(`Planted! You now have ${planted} trees — a bigger harvest awaits. 🌱`);
    }
    startTransition(() => router.refresh());
  }

  /**
   * Ripen up to `count` waiting trees. The farmer walks to each plant first,
   * exactly like watering. Cherry blossoms are ripened FIRST — the server's
   * `use_fertilizer` picks blossom-first, so the walk order mirrors it.
   */
  async function handleFertilizeAll(count: number) {
    setMessage(null);
    resetSkip();
    setRunScope("bulk");
    setRunning("fert");

    const targets = [...waitingTargets]
      .sort((a, b) => Number(!!trees[b].isBlossom) - Number(!!trees[a].isBlossom))
      .slice(0, count);
    const next = [...trees];
    let used = 0;
    let left = fertilizer;

    for (const idx of targets) {
      await walkTo(farmerPosForTree(idx));
      if (!full.current) {
        setFarmerAnim("tilt");
        setActiveTree(idx);
        await iSleep(400);
      }
      setActiveTree(null);

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
      await iSleep(400);
    }

    void walkTo(null);
    setFarmerAnim("idle");
    setRunning(null);
    resetSkip();
    if (used > 0) {
      setMessage(
        `🧴 Fertilized ${used} ${used === 1 ? "tree" : "trees"} — harvest when you’re ready. ${left} fertilizer left.`,
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
            ? `🌸 Harvested the cherry blossom: ${result.fruits_earned} Fruits + 1 Seed + 1 Fertilizer! 🎉`
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
            ? `🌸 A cherry blossom! It pays 30 Fruits + 1 Seed + 1 Fertilizer when you harvest it. 💧 ${result.water_left} water left.`
            : result.new_stage === 4
              ? `Fully watered — fruit in 4 hours. 💧 ${result.water_left} water left.`
              : `Watered! 💧 ${result.water_left} water left.`,
        );
      }
      router.refresh();
    });
  }

  /** Fertilize ONE plant — the farmer walks over to it, just like watering. */
  async function handleFertilizeOne(index: number, treeId: string) {
    setMessage(null);
    resetSkip();
    setRunScope("single");
    setRunning("fert");

    await walkTo(farmerPosForTree(index));
    if (!full.current) {
      setFarmerAnim("tilt");
      await iSleep(400);
    }
    void walkTo(null);

    startTransition(async () => {
      const result = await fertilizeOneTree(treeId);
      setFarmerAnim("idle");
      setRunning(null);
      setSelectedSlot(null);
      resetSkip();
      if (!result.ok) {
        playSfx("error");
        setMessage(result.message);
      } else {
        playSfx("reveal");
        burstSeq.current += 1;
        setFertBurst({ id: burstSeq.current, index });
        setOverride(trees.map((t, i) => (i === index ? { ...t, stage: 5, readyAt: null } : t)));
        setMessage(
          `🧴 Fertilized! Harvest it when you’re ready. ${result.fertilizer_left} fertilizer left.`,
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
    // mid-action: the button turns into a Skip for THIS plant's animation
    // (it never applies the item to the rest of the plot)
    if (running !== null && runScope === "single" && selectedSlot === index) {
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
          onClick: () => void handlePlantOne(),
        });
      }
      return acts;
    }
    if (!tree.id) return acts; // pre-migration data: no single-tree actions

    if (tree.stage < 4 && water >= WATER_PER_PLANT) {
      acts.push({
        icon: <PixelIcon name="water" size={20} />,
        label: "Water this plant",
        onClick: () => void handleWaterOne(index, tree.id!),
      });
    }
    // Fertilizer only ripens a WAITING tree — never a harvest-ready one.
    const waiting = tree.stage === 4 && tree.readyAt && new Date(tree.readyAt).getTime() > now;
    if (waiting && fertilizer > 0) {
      acts.push({
        icon: <PixelIcon name="fertilizer" size={20} />,
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
    if (kind === "water") return <><PixelIcon name="water" size={17} /> {water}</>;
    if (kind === "fert") return <><PixelIcon name="fertilizer" size={17} /> {fertilizer}</>;
    return (
      <>
        <PixelIcon name="seed" size={16} /> {seeds}
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

  return (
    <div className="relative">
      {/* Inventory — tap once to see "… all?", tap again to do it all */}
      <div ref={itemBarRef} className="mb-2 flex flex-wrap items-center gap-2">
        <button type="button" data-tutorial="item-water" onClick={() => onItemClick("water")}
          disabled={itemDisabled("water", water < WATER_PER_PLANT)}
          className={itemBtn} style={itemStyle("water")}
          title="Water your thirsty plants (oldest first)">
          {itemLabel("water")}
        </button>
        <button type="button" data-tutorial="item-fert" onClick={() => onItemClick("fert")}
          disabled={itemDisabled("fert", fertilizer < 1)}
          className={itemBtn} style={itemStyle("fert")}
          title="Ripen waiting trees (pink blossoms first)">
          {itemLabel("fert")}
        </button>
        <button type="button" data-tutorial="item-seed" onClick={() => onItemClick("seed")}
          disabled={itemDisabled("seed", seeds < 1)}
          className={itemBtn} style={itemStyle("seed")}
          title="Plant seeds in the open plots">
          {itemLabel("seed")}
        </button>
        <InfoChip
          icon={<Fruit scale={1.7} />}
          count={fruitTotal}
          name="Fruits"
          blurb={`Your Season score — only harvesting trees makes Fruits. You have ${fruitTotal}.`}
        />
        <InfoChip
          icon={<PixelIcon name="coin" size={16} />}
          count={coins}
          name="Coins"
          blurb={`Spend at the store and lottery — Coins never affect the leaderboard. You have ${coins}.`}
        />
        <InfoChip
          icon={<span aria-hidden>🌳</span>}
          count={viewTrees.length}
          name="Trees"
          blurb={`More trees = a bigger harvest (max ${MAX_TREES}). You have ${viewTrees.length}.`}
        />
      </div>

      <div className="relative" data-tutorial="farm-scene">
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
          onGroundClick={(pos) => {
            if (busy) return;
            setFarmerAnim("walk");
            setFarmerPos(pos);
            window.setTimeout(() => setFarmerAnim("idle"), 620);
          }}
          basketObject={
            basketOnFarm && !cinematic ? (
              <FarmBasket
                onClick={() =>
                  void walkToAndOpen(farmerPosForObject(BASKET_POS.left), onOpenBasket)
                }
              />
            ) : null
          }
          gooseBoxObject={
            submissionBoxRole && !cinematic ? (
              <GoldenSubmissionBox
                role={submissionBoxRole}
                onClick={() =>
                  void walkToAndOpen(farmerPosForObject(GOOSE_BOX_POS.left), onOpenGoose)
                }
              />
            ) : null
          }
          mailboxObject={
            onOpenMail && !cinematic ? (
              <Mailbox hasMail={hasMail} onClick={onOpenMail} />
            ) : null
          }
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
            house={house}
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

        {/* Lucky-day popup — a tree just turned into a cherry blossom. */}
        {cherryAlert && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="A rare cherry blossom tree appeared"
            className="absolute inset-0 z-40 flex items-center justify-center p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              aria-label="Close"
              onClick={() => setCherryAlert(false)}
              className="absolute inset-0 bg-black/40"
            />
            <div
              className="relative w-full max-w-xs rounded-lg border-[3px] border-[var(--rf-ink)] bg-[var(--rf-cream)] p-4 text-center"
              style={{ boxShadow: "4px 4px 0 rgba(58,42,26,0.35)" }}
            >
              <span aria-hidden className="text-3xl leading-none">🌸</span>
              <h3 className="pixel-heading mt-1 text-base text-[var(--rf-ink)]">
                A Rare Cherry Blossom Tree!
              </h3>
              <p className="mt-2 text-xs leading-5 text-[var(--rf-ink-soft)]">
                This tree has a rare chance of growing and gives you 30 fruit,
                1 seed and 1 fertilizer. It’s your lucky day!
              </p>
              <button
                type="button"
                onClick={() => setCherryAlert(false)}
                className="pixel-btn mt-3 text-xs"
              >
                🌸 Lucky me!
              </button>
            </div>
          </div>
        )}

        {/* The Golden Goose hangs out on the Keeper's farm with a bouncing "!"
            — click it to open the Keeper's question screen. While the farmer
            is doing something it takes off, flapping faster and swooping
            around (rf-goose-fly animates left/top waypoints).
            It is HIDDEN during the harvest close-up. */}
        {showGoose && !cinematic && (
          // The wrapper spans the whole farm so the goose can swoop across it,
          // so it MUST stay click-through — otherwise it blankets the plot and
          // swallows every tap on a tree or on the grass. Only the goose
          // itself takes pointer events.
          <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
            <div
              className={`absolute -translate-x-1/2 ${busy ? "rf-goose-fly" : ""}`}
              style={{ left: "50%", top: "8%" }}
            >
              <button
                type="button"
                aria-label="Golden Goose — open the Keeper's question screen"
                onClick={(e) => {
                  e.stopPropagation();
                  // the farmer wanders under the goose first, then it opens
                  void walkToAndOpen(FARMER_POS_FOR_GOOSE, onOpenGoose);
                }}
                className="pointer-events-auto relative border-0 bg-transparent p-0"
                style={{ cursor: onOpenGoose ? "pointer" : "default" }}
              >
                <span className="rf-bang text-xl font-black" style={{ top: -22, color: "var(--rf-gold)", WebkitTextStroke: "1px var(--rf-ink)" }}>
                  !
                </span>
                {/* the only ANIMATED goose — the one living on the farm */}
                <GooseSprite animated flying={busy} scale={1.3} />
              </button>
            </div>
          </div>
        )}

        {/* Top-right HUD: "!" notifications on top, "?" guidebook below.
            (The floating Plant Seed and Map buttons were removed — planting
            happens on the tapped hole, and Map lives in the bottom menu.) */}
        <div className="absolute right-2 top-2 z-40 flex flex-col items-end gap-1.5">
          {notificationSlot}
        </div>

        {/* Season date — a tiny HUD chip floating at the top of the scene,
            so it never takes a layout row (and never causes scrolling).
            Tap for the days-left popup; clicks stay out of the walk logic. */}
        {seasonSlot && (
          <div
            className="absolute left-1/2 top-1.5 z-30 -translate-x-1/2"
            onClick={(e) => e.stopPropagation()}
          >
            {seasonSlot}
          </div>
        )}

      </div>

      {/* Item alert (watered / harvested / nothing to fertilize…). Pinned to
          the VIEWPORT just above the bottom menu — same shelf as the reward
          banner — so it's always visible without any scrolling, regardless of
          how tall the farm scene is. Tap it to dismiss. */}
      {message && (
        <button
          type="button"
          role="status"
          title="Tap to dismiss"
          onClick={(e) => {
            e.stopPropagation();
            setMessage(null);
          }}
          className="rf-fixed-game-w fixed z-[86] mx-auto flex justify-center px-4"
          style={{ bottom: "6.5rem", background: "transparent", border: "none", padding: 0 }}
        >
          <span
            className="max-w-[calc(100%-2rem)] rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-4 py-1.5 text-center text-xs font-extrabold"
            style={{ boxShadow: "0 2px 0 var(--rf-ink)" }}
          >
            {message}
          </span>
        </button>
      )}
    </div>
  );
}

/**
 * A passive stat chip (Fruits / Coins / Trees) with a small cozy popup on
 * hover, tap, or focus that says what the thing is and how many you have.
 */
function InfoChip({
  icon,
  count,
  name,
  blurb,
}: {
  icon: React.ReactNode;
  count: number;
  name: string;
  blurb: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // tap-away closes the popup (mirrors NotificationCenter behavior)
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div
      ref={ref}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={`${name}: ${count}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 border-0 bg-transparent p-0 text-sm font-extrabold"
      >
        {icon} {count}
      </button>
      {open && (
        <div
          role="tooltip"
          className="absolute left-1/2 top-full z-40 mt-1.5 w-48 -translate-x-1/2 rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-2.5 py-1.5 shadow-[0_2px_0_var(--rf-ink)]"
        >
          <p className="text-[11px] font-extrabold">{name}</p>
          <p className="text-[10px] leading-snug text-[var(--rf-ink-soft)]">{blurb}</p>
        </div>
      )}
    </div>
  );
}
