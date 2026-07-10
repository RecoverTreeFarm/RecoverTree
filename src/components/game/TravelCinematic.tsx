"use client";

import { useEffect } from "react";
import { SPRITES } from "@/lib/sprites";
import { playSfx } from "@/lib/sfx";

const TRAVEL_MS = 2300;

/** A roadside tree (the clean 32x32 community-tree crop). */
function StripTree({ scale }: { scale: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={SPRITES.treeCommunity}
      alt=""
      aria-hidden
      className="pixelated inline-block shrink-0"
      style={{ width: 32 * scale, height: 32 * scale, imageRendering: "pixelated" }}
    />
  );
}

/** Half of a seamless parallax loop — rendered twice back to back. */
function FarHalf() {
  return (
    <span className="flex w-1/2 shrink-0 items-end justify-around">
      <StripTree scale={2.8} />
      <StripTree scale={2.2} />
      <StripTree scale={3.1} />
      <StripTree scale={2} />
      <StripTree scale={2.5} />
    </span>
  );
}

function NearHalf() {
  return (
    <span className="flex w-1/2 shrink-0 items-end justify-around text-2xl leading-none">
      <span aria-hidden>🌼</span>
      <span aria-hidden>🌷</span>
      <span aria-hidden>🪨</span>
      <span aria-hidden>🌻</span>
      <span aria-hidden>🌼</span>
      <span aria-hidden>🌿</span>
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
    const t = setTimeout(onDone, TRAVEL_MS);
    return () => clearTimeout(t);
    // onDone is stable for the lifetime of one trip — re-running would cut it short
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="rf-cine-in fixed inset-0 z-[80] overflow-hidden"
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

      {/* far tree line (slow) — sits on the horizon */}
      <div className="absolute inset-x-0" style={{ top: "calc(62% - 110px)" }}>
        <div className="rf-travel-far flex w-[200%] items-end" style={{ height: 110 }}>
          <FarHalf />
          <FarHalf />
        </div>
      </div>

      {/* ground strip */}
      <div
        className="grass-tile absolute inset-x-0 bottom-0"
        style={{ top: "62%", borderTop: "4px solid var(--rf-grass-dark)" }}
      />

      {/* near flowers (fast) — in front of the farmer's feet */}
      <div className="absolute inset-x-0" style={{ top: "calc(62% + 66px)" }}>
        <div className="rf-travel-near flex w-[200%] items-end" style={{ height: 32 }}>
          <NearHalf />
          <NearHalf />
        </div>
      </div>

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
