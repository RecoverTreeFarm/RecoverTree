"use client";

import { useEffect, useState } from "react";
import { SPRITES } from "@/lib/sprites";

/**
 * The Golden Goose. Idle = a single frame gently bobbing (hanging out on the
 * farm). Flying = the two flap frames alternating to imply wing-flapping.
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

  useEffect(() => {
    if (!flying) return;
    const iv = setInterval(() => setFrame((f) => (f === 0 ? 1 : 0)), 240);
    return () => clearInterval(iv);
  }, [flying]);

  // Idle always shows the gliding frame; flying alternates the two frames.
  const src = !flying ? SPRITES.goose2 : frame === 0 ? SPRITES.goose2 : SPRITES.goose1;
  return (
    <span className={`inline-block ${flying ? "" : "rf-goose-bob"} ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Golden Goose"
        className="pixelated"
        style={{ height: 44 * scale, width: "auto" }}
      />
    </span>
  );
}
