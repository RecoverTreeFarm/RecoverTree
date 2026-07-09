/**
 * Awards.
 *  - Medals use real sprites from AwardSpritesNEW (public/awards/medal_*.png).
 *  - Badges + fertilizer are still lightweight placeholders (badges show a
 *    meaningful emoji per definition; the sprite pack has no per-badge art).
 */

export type MedalTier = "gold" | "silver" | "bronze";

/** A pixel-art medal sprite (gold / silver / bronze) from the awards sheet. */
export function Medal({
  tier = "gold",
  size = 40,
  label,
}: {
  tier?: MedalTier;
  size?: number;
  label?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/awards/medal_${tier}.png`}
      alt={label ?? `${tier} medal`}
      title={label ?? `${tier} medal`}
      className="pixelated inline-block align-middle"
      style={{ height: size, width: "auto" }}
    />
  );
}

/** Placeholder badge — a pixel shield/emoji chip. */
export function Badge({
  icon = "🏅",
  label = "Badge",
  earned = true,
}: {
  icon?: string;
  label?: string;
  earned?: boolean;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-bold uppercase tracking-wide"
      style={{
        background: earned ? "var(--rf-cream)" : "#e7ddc9",
        border: "3px solid var(--rf-ink)",
        borderRadius: 4,
        opacity: earned ? 1 : 0.55,
        boxShadow: "2px 2px 0 rgba(58,42,26,0.25)",
      }}
      title={label}
    >
      <span aria-hidden>{icon}</span>
      {label}
    </span>
  );
}

/** Placeholder fertilizer bag — a small brown sack with an "F". */
export function FertilizerBag({
  size = 32,
  count,
}: {
  size?: number;
  count?: number;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        role="img"
        aria-label="fertilizer"
        title="fertilizer"
        className="inline-flex items-center justify-center"
        style={{
          width: size,
          height: size,
          background: "#8a5a34",
          border: "3px solid var(--rf-ink)",
          borderRadius: 3,
          color: "var(--rf-cream)",
          fontSize: size * 0.5,
          fontWeight: 800,
          boxShadow: "2px 2px 0 rgba(58,42,26,0.3)",
        }}
      >
        F
      </span>
      {typeof count === "number" && (
        <span className="text-sm font-bold">×{count}</span>
      )}
    </span>
  );
}
