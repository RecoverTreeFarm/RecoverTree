"use client";

import { useEffect, useState } from "react";

/**
 * Drifting butterflies (CozySpriteBundle/nature/Butterfly.png — a 32x16 strip
 * of two 16x16 wing frames). Each one flaps on its own timer and floats along
 * a looping CSS path.
 *
 * They start at RANDOM points along their path (via a negative animation
 * delay) and at random heights, so a handful never look clustered or
 * synchronized. Randomization happens after mount to avoid an SSR/CSR
 * hydration mismatch.
 *
 * Decorative only: pointer-events-none, aria-hidden.
 */

const SRC = "/sprites/nature/butterfly.png";
const FRAME = 16;

type Spec = {
  scale: number;
  flapMs: number;
  /** negative → the loop is already partway through when it mounts */
  delay: string;
  duration: string;
  top: string;
  drift: string;
};

function Butterfly({ scale, flapMs, delay, duration, top, drift }: Spec) {
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

const rand = (min: number, max: number) => min + Math.random() * (max - min);

function makeSpecs(count: number): Spec[] {
  return Array.from({ length: count }, () => {
    const duration = rand(11, 20);
    // 40% smaller than before (old scales were ~1.2–1.9 → now ~0.7–1.15)
    return {
      scale: rand(0.7, 1.15),
      flapMs: Math.round(rand(160, 250)),
      // negative, up to a full loop: scatters them across the path at t=0
      delay: `-${(Math.random() * duration).toFixed(1)}s`,
      duration: `${duration.toFixed(1)}s`,
      top: `${Math.round(rand(10, 62))}%`,
      drift: `${Math.round(rand(12, 30)) * (Math.random() < 0.5 ? -1 : 1)}px`,
    };
  });
}

/** A few butterflies drifting across the scene from random spots. */
export function Butterflies({ count = 3 }: { count?: number }) {
  // Empty on the server + first paint; real (random) specs after mount, so the
  // randomness can't cause a hydration mismatch.
  const [specs, setSpecs] = useState<Spec[]>([]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSpecs(makeSpecs(count));
  }, [count]);

  return (
    <>
      {specs.map((s, i) => (
        <Butterfly key={i} {...s} />
      ))}
    </>
  );
}
