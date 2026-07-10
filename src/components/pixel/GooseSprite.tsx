"use client";

import { useEffect, useState } from "react";
import { SPRITES } from "@/lib/sprites";

/**
 * The Golden Goose.
 *  - Idle (on the ground): the wing-down frame at HALF size, gently bobbing —
 *    no wing flapping.
 *  - Flying (the farmer is doing something): grows to full size and the two
 *    flap frames alternate. The caller moves it around the farm (rf-goose-fly).
 * Static art + simple transforms only.
 */
export function GooseSprite({
  flying = false,
  scale = 1.4,
  className = "",
}: {
  flying?: boolean;
  scale?: number;
  className?: string;
}) {
  const [frame, setFrame] = useState(0);

  // The goose always flaps; it flaps FASTER while flying around the farm.
  useEffect(() => {
    const iv = setInterval(() => setFrame((f) => (f === 0 ? 1 : 0)), flying ? 130 : 420);
    return () => clearInterval(iv);
  }, [flying]);

  const src = frame === 0 ? SPRITES.goose2 : SPRITES.goose1;
  return (
    <span className={`inline-block ${flying ? "" : "rf-goose-bob"} ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Golden Goose"
        className="pixelated"
        style={{
          height: 44 * scale,
          width: "auto",
          // half size on the ground, full size in the air
          transform: `scale(${flying ? 1 : 0.5})`,
          transformOrigin: "bottom center",
          transition: "transform 0.35s ease-out",
        }}
      />
    </span>
  );
}
