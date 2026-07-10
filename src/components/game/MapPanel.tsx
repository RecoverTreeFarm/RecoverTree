"use client";

import { useState } from "react";

/** The world map image (CozySpriteBundle/Map.png, copied verbatim). */
export const WORLD_MAP_SRC = "/sprites/map/world_map.png";

/**
 * Bottom-right HUD map button + a cozy placeholder map viewer. No travel or
 * location navigation yet — this just shows the world map, crisply scaled and
 * fitted to the viewport on both desktop and mobile.
 */
export function MapHud() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-label="Open the map"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="ui-btn-plate flex items-center gap-1 px-1.5 py-1 text-[10px] font-extrabold uppercase tracking-wide"
      >
        <span aria-hidden className="text-sm leading-none">🗺️</span>
        Map
      </button>
      {open && <MapModal onClose={() => setOpen(false)} />}
    </>
  );
}

function MapModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="World map">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />
      <div className="ui-frame absolute inset-x-2 top-1/2 mx-auto flex max-h-[88vh] w-auto max-w-3xl -translate-y-1/2 flex-col bg-[var(--rf-cream)] sm:inset-x-auto sm:left-1/2 sm:w-[min(92vw,52rem)] sm:-translate-x-1/2">
        <div
          className="flex items-center justify-between px-3 py-2"
          style={{ borderBottom: "2px solid var(--rf-ink)" }}
        >
          <h2 className="pixel-heading text-base">🗺️ World map</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the map"
            className="rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-2 py-0.5 text-xs font-extrabold hover:bg-[var(--rf-gold)]"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={WORLD_MAP_SRC}
            alt="A pixel-art map of the valley: farms, a village, a lighthouse, and mountains."
            className="pixelated mx-auto block h-auto w-full max-w-full"
          />
        </div>
        <p className="px-3 pb-2 text-[10px] text-[var(--rf-ink-soft)]">
          A place to wander later — locations aren’t travelable yet.
        </p>
      </div>
    </div>
  );
}
