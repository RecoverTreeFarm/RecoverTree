/** The world map image (CozySpriteBundle/Map.png, copied verbatim). */
export const WORLD_MAP_SRC = "/sprites/map/world_map.png";

/**
 * Placeholder map viewer — the contents of the Map window opened from the
 * bottom menu. No travel or interactive locations yet; the image just scales
 * to fit on desktop and mobile, staying crisp.
 */
export function MapModalBody() {
  return (
    <div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={WORLD_MAP_SRC}
        alt="A pixel-art map of the valley: farms, a village, a lighthouse, and mountains."
        className="pixelated mx-auto block h-auto w-full max-w-full rounded border-2 border-[var(--rf-ink)]"
      />
      <p className="mt-2 text-[10px] text-[var(--rf-ink-soft)]">
        A place to wander later — locations aren’t travelable yet.
      </p>
    </div>
  );
}
