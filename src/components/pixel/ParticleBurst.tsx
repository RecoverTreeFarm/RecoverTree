/**
 * A one-shot particle burst that plays a horizontal sprite strip from the
 * Particle FX pack via a CSS steps() animation, then holds its (blank) last
 * frame. Remount with a changing `key` to replay.
 *
 *  - "harvest": golden bloom (13 frames) — celebratory
 *  - "pop":     leaf scatter (8 frames), tinted blue for the blueberry pop
 */
const FX = {
  pop: {
    src: "/fx/pop.png",
    frames: 8,
    cls: "rf-fx-pop",
    filter: "hue-rotate(160deg) saturate(1.8) brightness(1.05)",
  },
  harvest: {
    src: "/fx/harvest.png",
    frames: 13,
    cls: "rf-fx-harvest",
    filter: undefined as string | undefined,
  },
  // "fully watered — now it rests" sparkle: golden-green tint of the scatter
  ready: {
    src: "/fx/pop.png",
    frames: 8,
    cls: "rf-fx-pop",
    filter: "hue-rotate(55deg) saturate(2.2) brightness(1.25)",
  },
} as const;

export type BurstKind = keyof typeof FX;

export function ParticleBurst({
  kind,
  size = 96,
  className = "",
  style,
}: {
  kind: BurstKind;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const fx = FX[kind];
  return (
    <span
      aria-hidden
      className={`pointer-events-none ${fx.cls} ${className}`}
      style={
        {
          position: "absolute",
          width: size,
          height: size,
          backgroundImage: `url(${fx.src})`,
          backgroundRepeat: "no-repeat",
          backgroundSize: `${fx.frames * size}px ${size}px`,
          imageRendering: "pixelated",
          filter: fx.filter,
          "--fx-end": `-${fx.frames * size}px`,
          ...style,
        } as React.CSSProperties & Record<string, string>
      }
    />
  );
}
