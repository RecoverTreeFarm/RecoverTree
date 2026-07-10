/** The world map image (CozySpriteBundle/Map.png, copied verbatim). */
export const WORLD_MAP_SRC = "/sprites/map/world_map.png";

/**
 * The Map window (opened from the bottom menu). The map art is the visual;
 * below it, two destinations: the shared Community Garden and your own farm.
 * Full location travel/pathfinding is still a later idea — only these two
 * places are reachable for now.
 */
export function MapModalBody({
  onOpenGarden,
  onGoHome,
}: {
  /** open the Community Garden scene */
  onOpenGarden: () => void;
  /** close the map and return to the player's own farm */
  onGoHome: () => void;
}) {
  return (
    <div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={WORLD_MAP_SRC}
        alt="A pixel-art map of the valley: farms, a village, a lighthouse, and mountains."
        className="pixelated mx-auto block h-auto w-full max-w-full rounded border-2 border-[var(--rf-ink)]"
      />
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={onOpenGarden}
          className="ui-btn-plate flex items-center justify-center gap-2 rounded border-2 border-[var(--rf-ink)] px-3 py-2.5 text-xs font-extrabold uppercase tracking-wide"
        >
          <span aria-hidden className="text-lg leading-none">🌳</span>
          Community Garden
        </button>
        <button
          type="button"
          onClick={onGoHome}
          className="ui-btn-plate flex items-center justify-center gap-2 rounded border-2 border-[var(--rf-ink)] px-3 py-2.5 text-xs font-extrabold uppercase tracking-wide"
        >
          <span aria-hidden className="text-lg leading-none">🏡</span>
          Your RecoverTree Farm
        </button>
      </div>
    </div>
  );
}
