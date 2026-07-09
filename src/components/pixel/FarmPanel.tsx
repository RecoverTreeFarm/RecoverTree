"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  FarmScene,
  farmerPosForTree,
  type TreeView,
  type FarmerAnim,
  type FarmerPos,
} from "./FarmScene";
import { HarvestCinematic } from "./HarvestCinematic";
import { waterTrees, harvestTrees, plantSeed, useFertilizer } from "@/app/dashboard/actions";
import { playSfx } from "@/lib/sfx";

const WATER_PER_PLANT = 10; // each plant drinks its own 10 water per stage

/**
 * Interactive farm.
 *  - Watering: every plant drinks its own 10 water per stage (5 plants =
 *    50 water). If water runs short, the oldest plants drink first.
 *  - Farmer walks to each watered slot and tilts. Skip: first click = 10×
 *    speed, second click = skip everything.
 *  - Fertilizer RIPENS one waiting tree (fx + sound); the player still
 *    clicks Harvest for the payoff. Harvest plays the close-up cinematic.
 */
export function FarmPanel({
  trees,
  water,
  seeds,
  fertilizer,
  fruitTotal,
}: {
  trees: TreeView[];
  water: number;
  seeds: number;
  fertilizer: number;
  fruitTotal: number;
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
  const bearingCount = trees.filter((t) => t.stage === 5).length;
  const waitingIdx = trees.findIndex(
    (t) => t.stage === 4 && t.readyAt && new Date(t.readyAt).getTime() > now,
  );
  const canWater = wateringTargets.length > 0 && !busy;

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

  const skipLabel = skipStage === 0 ? "⏭ Skip" : "⏭⏭ Skip all";
  const skipBtn = "pixel-btn pixel-btn--secondary";

  return (
    <div>
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
        />
        {cinematic && <HarvestCinematic onDone={finishCinematic} />}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {running === "water" ? (
          <button type="button" onClick={triggerSkip} className={skipBtn}>
            {skipLabel}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleWater}
            disabled={!canWater}
            className="pixel-btn pixel-btn--blue disabled:cursor-not-allowed disabled:opacity-50"
            title={
              waterableIdx.length === 0
                ? "All trees are fully watered — waiting on fruit or ready to harvest!"
                : water < WATER_PER_PLANT
                  ? `You need at least ${WATER_PER_PLANT} water to water a plant`
                  : "Each plant drinks 10 water — oldest first"
            }
          >
            💧 Water plants
          </button>
        )}

        {bearingCount > 0 &&
          (cinematic ? (
            <button type="button" onClick={finishCinematic} className={skipBtn}>
              ⏭ Skip
            </button>
          ) : (
            <button
              type="button"
              onClick={handleHarvest}
              disabled={busy}
              className="pixel-btn disabled:cursor-not-allowed disabled:opacity-50"
            >
              🧺 Harvest fruit
            </button>
          ))}

        {fertilizer > 0 && (
          <button
            type="button"
            onClick={handleFertilize}
            disabled={busy || waitingIdx < 0}
            className="pixel-btn disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: "var(--rf-grass)" }}
            title={
              waitingIdx < 0
                ? "Fertilizer only works on a fully-watered tree waiting to fruit"
                : "Skip the wait: instantly ripen one waiting tree"
            }
          >
            ✨ Use fertilizer ({fertilizer})
          </button>
        )}

        {seeds > 0 &&
          (running === "plant" ? (
            <button type="button" onClick={triggerSkip} className={skipBtn}>
              {skipLabel}
            </button>
          ) : (
            <button
              type="button"
              onClick={handlePlant}
              disabled={busy}
              className="pixel-btn pixel-btn--secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              🌱 Plant seed ({seeds})
            </button>
          ))}
      </div>

      {message && (
        <p
          role="status"
          className="mt-2 inline-block rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-3 py-1.5 text-xs font-bold"
        >
          {message}
        </p>
      )}
      <p className="mt-2 text-[11px] text-[var(--rf-ink-soft)]">
        Every plant drinks its own {WATER_PER_PLANT} water per stage (5 plants
        = 50 water) — if water runs short, the oldest plants drink first. A
        fully-watered tree bears fruit after 4 real hours — or instantly with
        ✨ fertilizer, then harvest it. 🌱
      </p>
    </div>
  );
}
