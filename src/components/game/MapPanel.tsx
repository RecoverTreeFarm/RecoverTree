"use client";

import { useState } from "react";

/** The world map image (CozySpriteBundle/Map.png, copied verbatim). */
export const WORLD_MAP_SRC = "/sprites/map/world_map.png";

/**
 * A tappable pin sitting ON the map artwork, anchored at a percent position
 * over the building it represents. Disabled pins gray out (construction /
 * admin-only teasers).
 */
function MapPin({
  left,
  top,
  label,
  onClick,
  disabled = false,
  title,
}: {
  left: number;
  top: number;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-disabled={disabled}
      title={title ?? label}
      onClick={onClick}
      className={`absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)]/95 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-[var(--rf-ink)] ${
        disabled ? "cursor-not-allowed opacity-60 grayscale" : "hover:bg-[var(--rf-gold)]"
      }`}
      style={{ left: `${left}%`, top: `${top}%`, boxShadow: "0 2px 0 rgba(58,42,26,0.4)" }}
    >
      {label}
    </button>
  );
}

/**
 * The Map window (opened from the bottom menu). Location buttons sit ON the
 * map artwork over the buildings they represent — no list below, no dead
 * space, nothing to scroll. The Weekly Orchard Lottery is deliberately NOT a
 * map destination: it's run from the General Store.
 */
export function MapModalBody({
  onOpenGarden,
  onOpenStore,
  onOpenLake,
  onGoHome,
  canFish = false,
}: {
  /** open the Community Garden scene */
  onOpenGarden: () => void;
  /** open the General Store scene */
  onOpenStore: () => void;
  /** open the Fishing Lake scene (admin-only for now) */
  onOpenLake?: () => void;
  /** close the map and return to the player's own farm */
  onGoHome: () => void;
  /** fishing unlocked for this player (admins while it's in preview) */
  canFish?: boolean;
}) {
  const [note, setNote] = useState<string | null>(null);

  return (
    <div className="relative">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={WORLD_MAP_SRC}
        alt="A pixel-art map of the valley: farms, a village, a lighthouse, and mountains."
        className="pixelated block h-auto w-full max-w-full rounded border-2 border-[var(--rf-ink)]"
      />

      {/* pins sit over their buildings (percent coords on the 1402x1122 art) */}
      <MapPin left={16} top={43} label="Your Farm" onClick={onGoHome} />
      <MapPin left={40} top={46} label="Garden" onClick={onOpenGarden} />
      <MapPin left={58.5} top={53} label="General Store" onClick={onOpenStore} />
      <MapPin
        left={55.5}
        top={28}
       
        label="Fishing Lake"
        disabled={!canFish || !onOpenLake}
        title={canFish ? "Fishing Lake" : "The lake isn't open just yet. 🎣"}
        onClick={
          canFish && onOpenLake
            ? onOpenLake
            : () => setNote("The lake isn't open just yet. 🎣")
        }
      />
      <MapPin
        left={80}
        top={60}
       
        label="Furniture"
        disabled
        title="Store under construction"
        onClick={() => setNote("The Furniture Store is under construction. 🔨")}
      />

      {note && (
        <button
          type="button"
          onClick={() => setNote(null)}
          className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-3 py-1 text-xs font-bold"
          style={{ boxShadow: "0 2px 0 var(--rf-ink)" }}
        >
          {note} ✕
        </button>
      )}
    </div>
  );
}
