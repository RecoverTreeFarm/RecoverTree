"use client";

import { useState } from "react";

/** The world map image (CozySpriteBundle/Map.png, copied verbatim). */
export const WORLD_MAP_SRC = "/sprites/map/world_map.png";

const btnCls =
  "ui-btn-plate flex items-center justify-center gap-2 rounded border-2 border-[var(--rf-ink)] px-3 py-2.5 text-xs font-extrabold uppercase tracking-wide";

/**
 * The Map window (opened from the bottom menu). The map art is the visual;
 * below it, the places you can go: the shared Community Garden, your own
 * farm, and the General Store — plus two boarded-up teasers. Full location
 * travel/pathfinding is still a later idea.
 */
export function MapModalBody({
  onOpenGarden,
  onOpenStore,
  onGoHome,
}: {
  /** open the Community Garden scene */
  onOpenGarden: () => void;
  /** open the General Store scene */
  onOpenStore: () => void;
  /** close the map and return to the player's own farm */
  onGoHome: () => void;
}) {
  const [construction, setConstruction] = useState<string | null>(null);

  return (
    <div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={WORLD_MAP_SRC}
        alt="A pixel-art map of the valley: farms, a village, a lighthouse, and mountains."
        className="pixelated mx-auto block h-auto w-full max-w-full rounded border-2 border-[var(--rf-ink)]"
      />
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button type="button" onClick={onOpenGarden} className={btnCls}>
          <span aria-hidden className="text-lg leading-none">🌳</span>
          Community Garden
        </button>
        <button type="button" onClick={onGoHome} className={btnCls}>
          <span aria-hidden className="text-lg leading-none">🏡</span>
          Your RecoverTree Farm
        </button>
        <button type="button" onClick={onOpenStore} className={btnCls}>
          <span aria-hidden className="text-lg leading-none">🏪</span>
          General Store
        </button>
        {/* boarded-up teasers — not travelable yet */}
        <button
          type="button"
          aria-disabled="true"
          title="Store under construction"
          onClick={() => setConstruction("The Furniture Store is under construction. 🔨")}
          className={`${btnCls} cursor-not-allowed opacity-50 grayscale`}
        >
          <span aria-hidden className="text-lg leading-none">🛋️</span>
          Furniture Store
        </button>
        <button
          type="button"
          aria-disabled="true"
          title="Store under construction"
          onClick={() => setConstruction("The Fishing Supply Store is under construction. 🎣")}
          className={`${btnCls} cursor-not-allowed opacity-50 grayscale`}
        >
          <span aria-hidden className="text-lg leading-none">🎣</span>
          Fishing Supply Store
        </button>
      </div>
      {construction && (
        <p
          role="status"
          className="mt-2 rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-3 py-2 text-center text-xs font-bold"
        >
          Store under construction — {construction}
        </p>
      )}
    </div>
  );
}
