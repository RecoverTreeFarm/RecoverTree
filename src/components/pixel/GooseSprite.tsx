"use client";

import { useEffect, useState } from "react";
import { SPRITES } from "@/lib/sprites";

/**
 * The Golden Goose.
 *  - On the FARM (`animated`): the wing-down frame at half size, gently
 *    bobbing; while `flying` it grows to full size and the two flap frames
 *    alternate as the caller swoops it around (rf-goose-fly).
 *  - In UI (menus, panels, empty states): perfectly still. `animated` is off
 *    by default, so a goose dropped into a window never flaps or bobs.
 */
export function GooseSprite({
  flying = false,
  animated = false,
  scale = 1.4,
  className = "",
}: {
  flying?: boolean;
  /** animate wings + bob — only true for the goose living on the farm */
  animated?: boolean;
  scale?: number;
  className?: string;
}) {
  const [frame, setFrame] = useState(0);

  // Wings only move for the on-farm goose; faster while it's flying.
  useEffect(() => {
    if (!animated) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFrame(0);
      return;
    }
    const iv = setInterval(() => setFrame((f) => (f === 0 ? 1 : 0)), flying ? 130 : 420);
    return () => clearInterval(iv);
  }, [flying, animated]);

  const src = frame === 0 ? SPRITES.goose2 : SPRITES.goose1;
  return (
    <span className={`inline-block ${animated && !flying ? "rf-goose-bob" : ""} ${className}`}>
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
