"use client";

import { useEffect, useState } from "react";

/**
 * Drifting butterflies (CozySpriteBundle/nature/Butterfly.png — a 32x16 strip
 * of two 16x16 wing frames). Each one flaps on its own timer and floats along
 * a looping CSS path, so a handful never look synchronized.
 *
 * Decorative only: pointer-events-none, aria-hidden.
 */

const SRC = "/sprites/nature/butterfly.png";
const FRAME = 16;

function Butterfly({
  scale,
  flapMs,
  delay,
  duration,
  top,
  drift,
}: {
  scale: number;
  flapMs: number;
  delay: string;
  duration: string;
  top: string;
  /** vertical bob distance for this one's path */
  drift: string;
}) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setFrame((f) => (f === 0 ? 1 : 0)), flapMs);
    return () => clearInterval(iv);
  }, [flapMs]);

  return (
    <span
      aria-hidden
      className="rf-butterfly pointer-events-none absolute"
      style={
        {
          top,
          width: FRAME * scale,
          height: FRAME * scale,
          backgroundImage: `url(${SRC})`,
          backgroundSize: `${FRAME * 2 * scale}px ${FRAME * scale}px`,
          backgroundPosition: `-${frame * FRAME * scale}px 0px`,
          backgroundRepeat: "no-repeat",
          imageRendering: "pixelated",
          animationDelay: delay,
          animationDuration: duration,
          "--flutter": drift,
        } as unknown as React.CSSProperties
      }
    />
  );
}

/** A few butterflies drifting across the scene. */
export function Butterflies({ count = 3 }: { count?: number }) {
  const specs = [
    { scale: 1.6, flapMs: 190, delay: "0s", duration: "13s", top: "18%", drift: "22px" },
    { scale: 1.3, flapMs: 240, delay: "3.5s", duration: "17s", top: "42%", drift: "-16px" },
    { scale: 1.9, flapMs: 160, delay: "7s", duration: "11s", top: "30%", drift: "28px" },
    { scale: 1.2, flapMs: 220, delay: "5s", duration: "19s", top: "58%", drift: "-24px" },
  ];
  return (
    <>
      {specs.slice(0, count).map((s, i) => (
        <Butterfly key={i} {...s} />
      ))}
    </>
  );
}
