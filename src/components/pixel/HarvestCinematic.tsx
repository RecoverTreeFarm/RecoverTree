"use client";

import { useEffect, useState } from "react";
import { SPRITES } from "@/lib/sprites";
import { Sprite, Tree, Fruit, CherryFruit } from "./Sprite";

/** The first fruit leaves the tree at this delay (seconds). */
const FIRST_DROP_DELAY = 0.45;

/**
 * A short "cinematic" close-up: blue sky over brown ground, the player's own
 * house sitting on the horizon behind the action, and the farmer leaning into
 * one bearing tree. The tree shakes, its fruit vanishes the instant the fruit
 * starts falling, and the drops tumble from mid-canopy. Plays for `duration`
 * ms, then calls onDone (the parent runs the real harvest).
 * Purely decorative — transforms only. The Golden Goose is never shown here.
 */
export function HarvestCinematic({
  duration = 2200,
  label = "🧺 Harvesting…",
  fruitIndex = 0,
  isBlossom = false,
  farmerSrc = SPRITES.farmer,
  house,
  onDone,
}: {
  duration?: number;
  label?: string;
  /** the harvested tree's fruit — the falling fruit matches the tree */
  fruitIndex?: number;
  /** cherry blossom tree: shows the cherry sprite and drops cherries */
  isBlossom?: boolean;
  /** the player's chosen farmer sprite */
  farmerSrc?: string;
  /** the player's chosen house — sits on the horizon behind the action */
  house?: { src: string; w: number; h: number };
  onDone: () => void;
}) {
  // The tree starts full of fruit; the moment the first fruit begins falling
  // it switches to the empty-canopy sprite, so the fruit really looks like it
  // came off (rather than duplicating on and below the tree).
  const [treeStage, setTreeStage] = useState(5);

  useEffect(() => {
    const empty = setTimeout(() => setTreeStage(4), FIRST_DROP_DELAY * 1000);
    const done = setTimeout(onDone, duration);
    return () => {
      clearTimeout(empty);
      clearTimeout(done);
    };
  }, [duration, onDone]);

  // Falling fruit: starts around the MIDDLE of the canopy, not above it.
  const drops = [
    { left: 10, delay: FIRST_DROP_DELAY },
    { left: 34, delay: FIRST_DROP_DELAY + 0.18 },
    { left: 58, delay: FIRST_DROP_DELAY + 0.1 },
    { left: 80, delay: FIRST_DROP_DELAY + 0.32 },
    { left: 46, delay: FIRST_DROP_DELAY + 0.44 },
  ];

  return (
    <div
      className="rf-cine-in absolute inset-0 z-20 flex items-end justify-center overflow-hidden rounded-lg"
      style={{
        border: "3px solid var(--rf-ink)",
        // blue sky
        background: "linear-gradient(#8fc4e3 0%, #b9d9ec 62%)",
      }}
    >
      {/* the ground: brown soil across the bottom */}
      <div
        className="soil-tile absolute bottom-0 left-0 right-0"
        style={{ height: "34%", borderTop: "2px solid rgba(58,42,26,0.35)" }}
      />

      {/* the player's house on the horizon — standing ON the ground, behind
          the action (z-0, and the scene below sits at z-10) */}
      {house && (
        <div className="pointer-events-none absolute z-0" style={{ right: "8%", bottom: "32%" }}>
          <Sprite src={house.src} size={[house.w, house.h]} scale={0.8} alt="" />
        </div>
      )}

      {/* scene: farmer + big tree */}
      <div className="relative z-10 mb-[6%] flex items-end gap-2">
        <div className="rf-lean">
          <Sprite src={farmerSrc} size={[32, 32]} scale={7} alt="farmer" />
        </div>

        <div className="relative">
          <div className="rf-shake">
            <Tree stage={treeStage} scale={4.5} fruitIndex={fruitIndex} isBlossom={isBlossom} />
          </div>
          {/* Falling fruit matches the tree: cherries only from the cherry
              blossom tree, otherwise this tree's own (cherry-free) fruit. */}
          {drops.map((d, i) => (
            <span
              key={i}
              className="rf-fruit-fall absolute"
              style={{ left: d.left, top: 90, animationDelay: `${d.delay}s` }}
            >
              {isBlossom ? <CherryFruit scale={2} /> : <Fruit scale={2} index={fruitIndex} orchard />}
            </span>
          ))}
        </div>
      </div>

      <p className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-3 py-1 text-xs font-bold uppercase tracking-wide">
        {label}
      </p>
    </div>
  );
}
