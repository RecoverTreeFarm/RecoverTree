import { SPRITES } from "@/lib/sprites";
import { Sprite, Tree, Fruit } from "./Sprite";
import { ParticleBurst } from "./ParticleBurst";
import { TreeTimer } from "./TreeTimer";

export type TreeView = {
  /** 1..4 growth; 5 = bearing fruit */
  stage: number;
  /** set while fully watered and waiting on the 4-hour fruit timer */
  readyAt?: string | null;
};

export type FarmerAnim = "idle" | "walk" | "tilt";
export type FarmerPos = { left: number; bottom: number };

/** Grid: 5 columns, 4 rows = 20 possible tree slots. */
export const GRID_COLS = 5;
export const GRID_ROWS = 4;
export const MAX_TREES = GRID_COLS * GRID_ROWS;

export const FARMER_HOME: FarmerPos = { left: 7, bottom: 40 };

// Plot geometry (scene %).
const PLOT_LEFT = 32;
const PLOT_WIDTH = 62;
const PLOT_BOTTOM = 12;
const PLOT_HEIGHT = 74;

/** Scene-% spot for the farmer to stand at slot `i` (0 = bottom-left). */
export function farmerPosForTree(i: number): FarmerPos {
  const col = i % GRID_COLS;
  const rowFromBottom = Math.floor(i / GRID_COLS);
  const x = PLOT_LEFT + PLOT_WIDTH * ((col + 0.5) / GRID_COLS) - 6;
  const bottom = PLOT_BOTTOM + PLOT_HEIGHT * (rowFromBottom / GRID_ROWS) + 2;
  return { left: Math.min(88, Math.max(30, x)), bottom: Math.min(72, bottom) };
}

/** A crate of harvested fruit beside the barn (1 per 40 Fruits). */
function Crate() {
  return (
    <span
      className="relative inline-block"
      style={{
        width: 22,
        height: 20,
        background: "#8a5a34",
        border: "2px solid var(--rf-ink)",
        boxShadow: "inset -2px -2px 0 rgba(0,0,0,0.25)",
      }}
    >
      <span className="absolute left-1 top-0.5 flex gap-0.5">
        <Fruit scale={1} />
      </span>
    </span>
  );
}

/**
 * The pixel-farm diorama: fixed 20-slot grid (dark circles mark empty
 * slots), the barn sprite with fruit crates (1 per 40 Fruits), and the
 * farmer walking to tended slots.
 */
export function FarmScene({
  trees = [{ stage: 1 }],
  fruitTotal = 0,
  compact = false,
  farmerAnim = "idle",
  farmerPos = null,
  activeTree = null,
  readyBurst = null,
  fertBurst = null,
  popId = 0,
  onTreeReady,
}: {
  trees?: TreeView[];
  fruitTotal?: number;
  compact?: boolean;
  farmerAnim?: FarmerAnim;
  farmerPos?: FarmerPos | null;
  activeTree?: number | null;
  readyBurst?: { id: number; indexes: number[] } | null;
  fertBurst?: { id: number; index: number } | null;
  popId?: number;
  onTreeReady?: () => void;
}) {
  const treeList = (trees.length > 0 ? trees : [{ stage: 1 }]).slice(0, MAX_TREES);
  const treeCount = treeList.length;
  const fence = compact ? 16 : 22;
  const treeScale = compact ? 1.5 : 2;
  const pos = farmerPos ?? FARMER_HOME;

  const innerAnim =
    farmerAnim === "tilt" ? "rf-water-tilt" : farmerAnim === "walk" ? "rf-walk" : "rf-idle";

  const crates = Math.min(8, Math.floor(fruitTotal / 40)); // 1 box per 40 Fruits

  const fenceStrip = (style: React.CSSProperties) => (
    <div
      aria-hidden
      className="pointer-events-none absolute"
      style={{
        backgroundImage: `url(${SPRITES.fence})`,
        backgroundRepeat: "repeat",
        backgroundSize: `${fence}px ${fence}px`,
        imageRendering: "pixelated",
        ...style,
      }}
    />
  );

  const cells = Array.from({ length: MAX_TREES }, (_, cellIdx) => {
    const rowFromTop = Math.floor(cellIdx / GRID_COLS);
    const col = cellIdx % GRID_COLS;
    return (GRID_ROWS - 1 - rowFromTop) * GRID_COLS + col;
  });

  return (
    <div
      className="grass-tile relative w-full overflow-hidden rounded-lg"
      style={{
        border: "3px solid var(--rf-ink)",
        boxShadow: "4px 4px 0 rgba(58,42,26,0.25)",
        height: compact ? 230 : 360,
      }}
    >
      {/* Barn + collected fruit crates */}
      <div className="absolute left-3 top-3">
        <Sprite src={SPRITES.barn} size={[96, 88]} scale={compact ? 0.7 : 1} alt="barn" />
        {crates > 0 && (
          <div className="mt-1 flex flex-wrap gap-1" style={{ width: compact ? 66 : 96 }}>
            {Array.from({ length: crates }).map((_, i) => (
              <Crate key={i} />
            ))}
          </div>
        )}
      </div>

      {/* Farmer */}
      <div
        className="absolute z-10"
        style={{
          left: `${pos.left}%`,
          bottom: `${pos.bottom}%`,
          transition: "left 0.6s linear, bottom 0.6s linear",
        }}
      >
        <div className={innerAnim}>
          <Sprite src={SPRITES.farmer} size={[16, 16]} scale={compact ? 2.5 : 3.5} alt="farmer" />
        </div>
      </div>

      {/* Fenced dirt plot */}
      <div
        className="soil-tile absolute"
        style={{
          right: "6%",
          bottom: `${PLOT_BOTTOM}%`,
          width: `${PLOT_WIDTH}%`,
          height: `${PLOT_HEIGHT}%`,
          border: "2px solid rgba(58,42,26,0.35)",
        }}
      >
        {fenceStrip({ left: -fence / 2, right: -fence / 2, top: -fence, height: fence })}
        {fenceStrip({ left: -fence / 2, right: -fence / 2, bottom: -fence / 2, height: fence })}
        {fenceStrip({ right: -fence / 2, top: -fence / 2, bottom: 0, width: fence })}
        {fenceStrip({ left: -fence / 2, top: -fence / 2, height: "22%", width: fence })}
        {fenceStrip({ left: -fence / 2, bottom: 0, height: "30%", width: fence })}

        <div
          className="grid h-full gap-x-1 gap-y-1 px-2 py-2"
          style={{
            gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`,
            gridTemplateRows: `repeat(${GRID_ROWS}, 1fr)`,
            justifyItems: "center",
            alignItems: "end",
          }}
        >
          {cells.map((bottomIndex, cellIdx) => {
            const tree = bottomIndex < treeCount ? treeList[bottomIndex] : null;
            if (!tree) {
              // empty plantable slot: a dark circle of turned soil
              const d = compact ? 14 : 18;
              return (
                <span
                  key={cellIdx}
                  aria-hidden
                  className="rounded-full"
                  style={{
                    width: d,
                    height: d,
                    background: "rgba(58,42,26,0.4)",
                    boxShadow: "inset 0 2px 2px rgba(0,0,0,0.3)",
                  }}
                />
              );
            }
            const waiting = tree.stage === 4 && !!tree.readyAt;
            return (
              <div key={cellIdx} className="relative flex items-end justify-center">
                {waiting && tree.readyAt && (
                  <TreeTimer readyAt={tree.readyAt} size={compact ? 26 : 30} onReady={onTreeReady} />
                )}
                <div className={waiting ? "rf-pulse" : undefined}>
                  <Tree stage={tree.stage} scale={treeScale} fruitIndex={bottomIndex} />
                </div>

                {/* big droplet while this tree is being watered */}
                {activeTree === bottomIndex && farmerAnim === "tilt" && (
                  <span
                    aria-hidden
                    className="rf-droplet absolute left-1/2 -translate-x-1/2"
                    style={{
                      top: -10,
                      width: 9,
                      height: 13,
                      background: "var(--rf-blue)",
                      borderRadius: "50% 50% 55% 55% / 30% 30% 70% 70%",
                      border: "1.5px solid var(--rf-ink)",
                    }}
                  />
                )}

                {readyBurst && readyBurst.indexes.includes(bottomIndex) && (
                  <ParticleBurst
                    key={`ready-${readyBurst.id}-${bottomIndex}`}
                    kind="ready"
                    size={compact ? 40 : 52}
                    style={{ left: "50%", top: "40%", transform: "translate(-50%,-50%)" }}
                  />
                )}
                {fertBurst && fertBurst.index === bottomIndex && (
                  <ParticleBurst
                    key={`fert-${fertBurst.id}`}
                    kind="harvest"
                    size={compact ? 56 : 72}
                    style={{ left: "50%", top: "40%", transform: "translate(-50%,-50%)" }}
                  />
                )}
                {popId > 0 && tree.stage === 5 && (
                  <ParticleBurst
                    key={`pop-${popId}-${bottomIndex}`}
                    kind="pop"
                    size={compact ? 40 : 50}
                    style={{ left: "50%", top: "40%", transform: "translate(-50%,-50%)" }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
