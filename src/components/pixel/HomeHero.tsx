import { Sprite, Tree } from "./Sprite";
import { SPRITES } from "@/lib/sprites";

/**
 * Compact homepage vignette: an idle farmer bobbing beside a cherry blossom
 * tree, petals drifting down. Replaces the tall FarmScene preview so the
 * notice board sits closer to the top of the page.
 */
export function HomeHero() {
  const petals = [
    { left: "22%", delay: "0s", drift: "12px" },
    { left: "40%", delay: "0.6s", drift: "-9px" },
    { left: "58%", delay: "1.3s", drift: "14px" },
    { left: "70%", delay: "0.3s", drift: "-5px" },
    { left: "50%", delay: "2s", drift: "7px" },
  ];

  return (
    <div
      className="grass-tile relative flex items-end justify-center gap-3 overflow-hidden rounded-lg px-4 pb-3 pt-6"
      style={{
        border: "3px solid var(--rf-ink)",
        boxShadow: "4px 4px 0 rgba(58,42,26,0.25)",
        minHeight: 160,
      }}
    >
      {/* drifting cherry-blossom petals over the whole vignette */}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-2">
        {petals.map((p, i) => (
          <span
            key={i}
            className="rf-petal"
            style={
              { left: p.left, animationDelay: p.delay, "--drift": p.drift } as React.CSSProperties &
                Record<string, string>
            }
          />
        ))}
      </span>

      {/* the farmer, gently bobbing */}
      <div className="rf-idle">
        <Sprite src={SPRITES.farmer} size={[32, 32]} scale={3} alt="a farmer" />
      </div>

      {/* the cherry blossom tree, bearing its cherries */}
      <Tree stage={5} isBlossom scale={2.6} />
    </div>
  );
}
