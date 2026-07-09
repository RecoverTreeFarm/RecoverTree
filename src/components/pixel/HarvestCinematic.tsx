"use client";

import { useEffect, useState } from "react";
import { SPRITES, CHERRY_FRUIT_INDEX } from "@/lib/sprites";
import { Sprite, Tree, Fruit } from "./Sprite";

/**
 * A short "cinematic" close-up: the farmer stands beside one bearing tree,
 * leans into it, the tree shakes, and its fruits fall off. Plays for
 * `duration` ms, then calls onDone (the parent runs the real harvest and
 * returns to the normal farm view). Purely decorative — transforms only.
 */
export function HarvestCinematic({
  duration = 2200,
  label = "🧺 Harvesting…",
  fruitIndex = 0,
  isBlossom = false,
  onDone,
}: {
  duration?: number;
  label?: string;
  /** the harvested tree's fruit — the falling fruit matches the tree */
  fruitIndex?: number;
  /** pink blossom tree: shows the pink sprite and drops cherries */
  isBlossom?: boolean;
  onDone: () => void;
}) {
  // The tree starts full of fruit; once the fruit begins falling it switches
  // to the empty-bush sprite so the fruit really looks like it came off.
  const [treeStage, setTreeStage] = useState(5);

  useEffect(() => {
    const empty = setTimeout(() => setTreeStage(4), 950);
    const done = setTimeout(onDone, duration);
    return () => {
      clearTimeout(empty);
      clearTimeout(done);
    };
  }, [duration, onDone]);

  // falling fruit positions (relative to the tree top)
  const drops = [
    { left: 10, delay: 0.6 },
    { left: 34, delay: 0.8 },
    { left: 58, delay: 0.7 },
    { left: 80, delay: 0.95 },
    { left: 46, delay: 1.05 },
  ];

  return (
    <div
      className="grass-tile rf-cine-in absolute inset-0 z-20 flex items-end justify-center overflow-hidden rounded-lg"
      style={{ border: "3px solid var(--rf-ink)" }}
    >
      {/* a patch of dirt the tree stands on */}
      <div
        className="soil-tile absolute bottom-0 left-0 right-0"
        style={{ height: "34%", borderTop: "2px solid rgba(58,42,26,0.35)" }}
      />

      {/* scene: farmer + big tree */}
      <div className="relative mb-[6%] flex items-end gap-2">
        {/* farmer leans toward the tree */}
        <div className="rf-lean">
          <Sprite src={SPRITES.farmer} size={[32, 32]} scale={7} alt="farmer" />
        </div>

        {/* the shaking tree, with fruit dropping off it */}
        <div className="relative">
          <div className="rf-shake">
            <Tree stage={treeStage} scale={4.5} fruitIndex={fruitIndex} isBlossom={isBlossom} />
          </div>
          {drops.map((d, i) => (
            <span
              key={i}
              className="rf-fruit-fall absolute"
              style={{ left: d.left, top: 24, animationDelay: `${d.delay}s` }}
            >
              <Fruit scale={2} index={isBlossom ? CHERRY_FRUIT_INDEX : fruitIndex} />
            </span>
          ))}
        </div>
      </div>

      <p className="absolute left-1/2 top-3 -translate-x-1/2 rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-3 py-1 text-xs font-bold uppercase tracking-wide">
        {label}
      </p>
    </div>
  );
}
