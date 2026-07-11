"use client";

import { useEffect } from "react";
import { SPRITES } from "@/lib/sprites";
import { playSfx } from "@/lib/sfx";
import { playMusic, stopMusic } from "@/lib/music";
import { Butterflies } from "@/components/pixel/Butterflies";

const TRAVEL_MS = 2300;

/* Scatter tables — items are placed absolutely (left % of the half, bottom px
   off the ground) so they sit at varied spots and depths instead of one line.
   Fixed values (not random) so the two seamless-loop halves match exactly. */
const FAR_TREES: { left: number; bottom: number; scale: number }[] = [
  { left: 4, bottom: 6, scale: 2.8 },
  { left: 20, bottom: 22, scale: 2.1 },
  { left: 33, bottom: 2, scale: 3.1 },
  { left: 50, bottom: 16, scale: 2.3 },
  { left: 66, bottom: 26, scale: 1.9 },
  { left: 80, bottom: 4, scale: 2.9 },
  { left: 92, bottom: 18, scale: 2.2 },
];

const NEAR_DECOR: { e: string; left: number; bottom: number; size: number }[] = [
  { e: "🌼", left: 5, bottom: 8, size: 22 },
  { e: "🌷", left: 15, bottom: 46, size: 15 },
  { e: "🪨", left: 27, bottom: 4, size: 24 },
  { e: "🌻", left: 39, bottom: 62, size: 15 },
  { e: "🌿", left: 50, bottom: 24, size: 19 },
  { e: "🌼", left: 61, bottom: 52, size: 14 },
  { e: "🪨", left: 72, bottom: 14, size: 21 },
  { e: "🌷", left: 83, bottom: 38, size: 16 },
  { e: "🌼", left: 94, bottom: 6, size: 20 },
];

/** Half of the far tree line — scattered along/behind the horizon. */
function FarHalf() {
  return (
    <span className="relative block h-full w-1/2 shrink-0">
      {FAR_TREES.map((t, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={i}
          src={SPRITES.treeCommunity}
          alt=""
          aria-hidden
          className="pixelated absolute"
          style={{
            left: `${t.left}%`,
            bottom: t.bottom,
            width: 32 * t.scale,
            height: 32 * t.scale,
            imageRendering: "pixelated",
            transform: "translateX(-50%)",
          }}
        />
      ))}
    </span>
  );
}

/** Half of the near ground decor — flowers/rocks scattered across the plane. */
function NearHalf() {
  return (
    <span className="relative block h-full w-1/2 shrink-0 leading-none">
      {NEAR_DECOR.map((d, i) => (
        <span
          key={i}
          aria-hidden
          className="absolute"
          style={{
            left: `${d.left}%`,
            bottom: d.bottom,
            fontSize: d.size,
            transform: "translateX(-50%)",
          }}
        >
          {d.e}
        </span>
      ))}
    </span>
  );
}

/**
 * A quick full-screen travel cinematic: the farmer walks along a horizon
 * while trees (far, slow) and flowers (near, fast) scroll past, with a small
 * jingle. Calls onDone after ~2.3s so the caller can switch locations.
 */
export function TravelCinematic({
  farmerSrc,
  destinationLabel,
  onDone,
}: {
  farmerSrc: string;
  destinationLabel: string;
  onDone: () => void;
}) {
  useEffect(() => {
    playSfx("charge");
    // walking music for exactly as long as the walk lasts
    playMusic("walking");
    const t = setTimeout(onDone, TRAVEL_MS);
    return () => {
      clearTimeout(t);
      stopMusic();
    };
    // onDone is stable for the lifetime of one trip — re-running would cut it short
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      // Contained to the phone-width game frame (rf-fixed-game-w) — the
      // walking scene plays inside the game window, never stretched across a
      // desktop browser. All scenery inside is %-based, so it adapts.
      className="rf-cine-in rf-fixed-game-w fixed inset-y-0 z-[80] overflow-hidden"
      role="status"
      aria-label={`Traveling to ${destinationLabel}`}
      style={{ background: "linear-gradient(var(--rf-sky) 0%, var(--rf-sky-2) 62%, var(--rf-grass) 62%)" }}
    >
      {/* sun */}
      <span
        aria-hidden
        className="absolute rounded-full"
        style={{ right: "12%", top: "10%", width: 46, height: 46, background: "var(--rf-gold)", boxShadow: "0 0 24px var(--rf-gold)" }}
      />

      {/* far tree line (slow) — scattered along the horizon */}
      <div className="absolute inset-x-0" style={{ top: "calc(62% - 120px)", height: 120 }}>
        <div className="rf-travel-far flex w-[200%]" style={{ height: "100%" }}>
          <FarHalf />
          <FarHalf />
        </div>
      </div>

      {/* ground strip */}
      <div
        className="grass-tile absolute inset-x-0 bottom-0"
        style={{ top: "62%", borderTop: "4px solid var(--rf-grass-dark)" }}
      />

      {/* near flowers/rocks (fast) — scattered across the ground plane */}
      <div className="absolute inset-x-0 bottom-0" style={{ top: "calc(62% + 40px)" }}>
        <div className="rf-travel-near flex w-[200%]" style={{ height: "100%" }}>
          <NearHalf />
          <NearHalf />
        </div>
      </div>

      {/* butterflies keep the walker company */}
      <Butterflies count={3} />

      {/* the traveler */}
      <div className="absolute left-1/2 -translate-x-1/2" style={{ top: "calc(62% - 22px)" }}>
        <div className="rf-walk">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={farmerSrc} alt="" className="pixelated" style={{ width: 58, height: 58 }} />
        </div>
      </div>

      {/* destination banner */}
      <p
        className="absolute inset-x-0 bottom-8 mx-auto w-fit rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-4 py-1.5 text-center text-xs font-extrabold uppercase tracking-wide"
        style={{ boxShadow: "0 2px 0 var(--rf-ink)" }}
      >
        Heading to {destinationLabel}…
      </p>
    </div>
  );
}
