"use client";

import { useRef } from "react";
import { SPRITES } from "@/lib/sprites";
import { Sprite, Tree, Fruit } from "./Sprite";
import { ParticleBurst } from "./ParticleBurst";
import { TreeTimer } from "./TreeTimer";

export type TreeView = {
  /** database id — lets the player act on this ONE tree */
  id?: string;
  /** 1..4 growth; 5 = bearing fruit */
  stage: number;
  /** set while fully watered and waiting on the 4-hour fruit timer */
  readyAt?: string | null;
  /** a bearing tree that rolled the rare cherry blossom (2x fruit on harvest) */
  isBlossom?: boolean;
};

export type FarmerAnim = "idle" | "walk" | "tilt";
export type FarmerPos = { left: number; bottom: number };

/** One entry in the tap-a-plant contextual menu. */
export type SlotAction = {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
};

/** Grid: 4 columns, 4 rows = 16 possible tree slots. */
export const GRID_COLS = 4;
export const GRID_ROWS = 4;
export const MAX_TREES = GRID_COLS * GRID_ROWS;

/** The farmer idles ABOVE the plot, roughly centered. */
export const FARMER_HOME: FarmerPos = { left: 45, bottom: 66 };

// Plot geometry (scene %): a wide dirt band across the bottom-middle.
const PLOT_LEFT = 6;
const PLOT_WIDTH = 88;
const PLOT_BOTTOM = 5;
const PLOT_HEIGHT = 48;

/** Event objects stand ON the top edge of the dirt, left of centre. */
export const PLOT_TOP_EDGE = PLOT_BOTTOM + PLOT_HEIGHT; // 53%
/** Roughly how tall an event object is, in scene % (used for depth sorting). */
const OBJECT_HEIGHT_PCT = 11;
/** The farmer is BEHIND an object once his feet pass its upper half. */
const OBJECT_MIDLINE = PLOT_TOP_EDGE + OBJECT_HEIGHT_PCT / 2;

/** Where the Traveling Basket and the Golden Goose box sit (scene %). */
export const BASKET_POS = { left: 10, bottom: PLOT_TOP_EDGE };
export const GOOSE_BOX_POS = { left: 26, bottom: PLOT_TOP_EDGE };

/** Where the farmer stands to use an object — right up against its side. */
export function farmerPosForObject(objLeft: number): FarmerPos {
  return { left: Math.min(88, objLeft + 3), bottom: PLOT_TOP_EDGE + 1 };
}

/** Where the farmer stands to reach the goose (it hovers up near the top). */
export const FARMER_POS_FOR_GOOSE: FarmerPos = { left: 49, bottom: 73 };

/**
 * 2D-game depth sorting: an object is drawn IN FRONT of the farmer only when
 * the farmer is standing further "up" the screen than the object's midline —
 * i.e. he has walked behind its upper half. Otherwise he's in front of it.
 */
export function objectZIndex(farmerBottom: number): number {
  return farmerBottom > OBJECT_MIDLINE ? 20 : 5;
}

/** Scene-% spot for the farmer to stand at slot `i` (0 = bottom-left). */
export function farmerPosForTree(i: number): FarmerPos {
  const col = i % GRID_COLS;
  const rowFromBottom = Math.floor(i / GRID_COLS);
  // stand almost on top of the plant, not a tile away from it
  const x = PLOT_LEFT + PLOT_WIDTH * ((col + 0.5) / GRID_COLS) - 2.5;
  const bottom = PLOT_BOTTOM + PLOT_HEIGHT * (rowFromBottom / GRID_ROWS) + 2;
  return { left: Math.min(86, Math.max(6, x)), bottom: Math.min(58, bottom) };
}

/**
 * Drifting cherry-blossom petals — the cherry tree's signature effect. Pure
 * CSS (see .rf-petal in globals.css); no dependency, no sprite sheet.
 */
function CherryPetals({ compact = false }: { compact?: boolean }) {
  const petals = [
    { left: "18%", delay: "0s", drift: "10px" },
    { left: "38%", delay: "0.7s", drift: "-8px" },
    { left: "58%", delay: "1.4s", drift: "12px" },
    { left: "72%", delay: "0.35s", drift: "-6px" },
    { left: "48%", delay: "2.1s", drift: "6px" },
  ];
  return (
    <span aria-hidden className="pointer-events-none absolute inset-x-0" style={{ top: compact ? 2 : 6 }}>
      {petals.map((p, i) => (
        <span
          key={i}
          className="rf-petal"
          style={
            {
              left: p.left,
              animationDelay: p.delay,
              "--drift": p.drift,
            } as React.CSSProperties & Record<string, string>
          }
        />
      ))}
    </span>
  );
}

/** A crate of harvested fruit beside the house (1 per 40 Fruits). Each crate
 *  shows a different fruit so a full barn reads as a varied harvest. */
function Crate({ index = 0, scale = 1 }: { index?: number; scale?: number }) {
  return (
    <span
      className="relative inline-block"
      style={{
        width: 22 * scale,
        height: 20 * scale,
        background: "#8a5a34",
        border: "2px solid var(--rf-ink)",
        boxShadow: "inset -2px -2px 0 rgba(0,0,0,0.25)",
      }}
    >
      <span className="absolute" style={{ left: 4 * scale, top: 2 * scale }}>
        <Fruit scale={scale} index={index} orchard />
      </span>
    </span>
  );
}

/**
 * The farm diorama — the main "game screen".
 *  - The player's chosen house (profiles.avatar_config.house) sits by the plot,
 *    with fruit crates (1 per 40 Fruits).
 *  - Fixed 20-slot grid; tapping a plant (or empty patch) selects it and shows
 *    a small contextual action menu (actions computed by FarmPanel).
 *  - Timers are HIDDEN by default; a subtle progress ring fades in on
 *    hover/selection only.
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
  house,
  selectedSlot = null,
  onSlotClick,
  onDismiss,
  slotActions = [],
  canSelectEmpty = false,
  farmerSrc = SPRITES.farmer,
  cherryPop = null,
  onGroundClick,
  basketObject,
  gooseBoxObject,
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
  /** the player's chosen house sprite */
  house?: { src: string; w: number; h: number };
  /** currently selected slot (bottom-index) — shows the action menu */
  selectedSlot?: number | null;
  onSlotClick?: (bottomIndex: number, isEmpty: boolean) => void;
  onDismiss?: () => void;
  /** actions for the selected slot (empty array = no menu) */
  slotActions?: SlotAction[];
  /** whether empty patches are tappable (a seed is available) */
  canSelectEmpty?: boolean;
  /** the player's chosen farmer sprite (defaults to the stock farmer) */
  farmerSrc?: string;
  /** slot index that just blossomed — plays the one-shot cherry sparkle */
  cherryPop?: number | null;
  /** clicking bare grass sends the farmer to that spot */
  onGroundClick?: (pos: FarmerPos) => void;
  /** the Traveling Basket, when it's sitting on this farm */
  basketObject?: React.ReactNode;
  /** the Golden Goose submission box, when this farm has one */
  gooseBoxObject?: React.ReactNode;
}) {
  const treeList = (trees.length > 0 ? trees : [{ stage: 1 }]).slice(0, MAX_TREES);
  const treeCount = treeList.length;
  const treeScale = compact ? 0.85 : 1.2;
  const pos = farmerPos ?? FARMER_HOME;

  const innerAnim =
    farmerAnim === "tilt" ? "rf-water-tilt" : farmerAnim === "walk" ? "rf-walk" : "rf-idle";

  const crates = Math.min(8, Math.floor(fruitTotal / 40)); // 1 box per 40 Fruits

  const cells = Array.from({ length: MAX_TREES }, (_, cellIdx) => {
    const rowFromTop = Math.floor(cellIdx / GRID_COLS);
    const col = cellIdx % GRID_COLS;
    return (GRID_ROWS - 1 - rowFromTop) * GRID_COLS + col;
  });

  // The homestead reads as a real building without dominating the farm.
  const houseScale = compact ? 1 : 1.35;
  const crateScale = compact ? 1.1 : 1.35;

  const houseRef = useRef<HTMLDivElement>(null);

  // depth sort: in front of the farmer only once he's behind their upper half
  const objZ = objectZIndex(pos.bottom);

  /** A click on bare grass walks the farmer there (and clears any selection).
   *  Plants, HUD, and event objects stopPropagation, so they never trigger it.
   *  The farmer can never end up standing ON the house: a click inside the
   *  homestead walks him to the grass just below it instead. */
  function handleSceneClick(e: React.MouseEvent<HTMLDivElement>) {
    onDismiss?.();
    if (!onGroundClick) return;
    const r = e.currentTarget.getBoundingClientRect();
    let clientY = e.clientY;
    let clientX = e.clientX;

    const h = houseRef.current?.getBoundingClientRect();
    if (h && clientX >= h.left && clientX <= h.right && clientY >= h.top && clientY <= h.bottom) {
      // stepped onto the house — stand just below its front wall instead
      clientY = h.bottom + 6;
      clientX = Math.min(clientX, h.right - 4);
    }

    const left = ((clientX - r.left) / r.width) * 100;
    const bottom = ((r.bottom - clientY) / r.height) * 100;
    // keep the farmer inside the scene and out of the very bottom rail
    onGroundClick({
      left: Math.min(90, Math.max(4, left)),
      bottom: Math.min(78, Math.max(6, bottom)),
    });
  }

  return (
    <div
      className="grass-tile relative w-full overflow-hidden rounded-lg"
      style={{
        border: "3px solid var(--rf-ink)",
        boxShadow: "4px 4px 0 rgba(58,42,26,0.25)",
        height: compact ? 230 : "clamp(360px, 60vh, 640px)",
        cursor: onGroundClick ? "pointer" : undefined,
      }}
      onClick={handleSceneClick}
    >
      {/* Player house + collected fruit crates. The farmer can't stand here. */}
      <div ref={houseRef} className="absolute left-3 top-3">
        {house && (
          <Sprite src={house.src} size={[house.w, house.h]} scale={houseScale} alt="your house" />
        )}
        {crates > 0 && (
          <div className="mt-1 flex flex-wrap gap-1" style={{ width: compact ? 76 : 120 }}>
            {Array.from({ length: crates }).map((_, i) => (
              <Crate key={i} index={i} scale={crateScale} />
            ))}
          </div>
        )}
      </div>

      {/* Event objects stand ON the top edge of the dirt, clear of the house.
          Their z-index is depth-sorted against the farmer (see objectZIndex),
          so he passes in front of them normally and behind them only once he
          walks past their upper half. They stop click propagation, so tapping
          one never doubles as a walk-to-this-spot click. */}
      {basketObject && (
        <div
          className="absolute"
          style={{ left: `${BASKET_POS.left}%`, bottom: `${BASKET_POS.bottom}%`, zIndex: objZ }}
          onClick={(e) => e.stopPropagation()}
        >
          {basketObject}
        </div>
      )}
      {gooseBoxObject && (
        <div
          className="absolute"
          style={{ left: `${GOOSE_BOX_POS.left}%`, bottom: `${GOOSE_BOX_POS.bottom}%`, zIndex: objZ }}
          onClick={(e) => e.stopPropagation()}
        >
          {gooseBoxObject}
        </div>
      )}

      {/* Farmer */}
      <div
        className="pointer-events-none absolute z-10"
        style={{
          left: `${pos.left}%`,
          bottom: `${pos.bottom}%`,
          transition: "left 0.6s linear, bottom 0.6s linear",
        }}
      >
        <div className={innerAnim}>
          {/* 20% smaller than the original 2.6/3.6 (user request) */}
          <Sprite src={farmerSrc} size={[32, 32]} scale={compact ? 2.1 : 2.9} alt="farmer" />
        </div>
      </div>

      {/* Raised-bed dirt plot */}
      <div
        className="soil-tile absolute"
        style={{
          left: `${PLOT_LEFT}%`,
          bottom: `${PLOT_BOTTOM}%`,
          width: `${PLOT_WIDTH}%`,
          height: `${PLOT_HEIGHT}%`,
          border: `${compact ? 4 : 6}px solid var(--rf-wood)`,
          borderRadius: 6,
          boxShadow:
            "inset 0 0 0 2px var(--rf-soil-dark), 0 3px 0 rgba(58,42,26,0.3)",
        }}
      >
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
            const isSelected = selectedSlot === bottomIndex;
            const menuBelow = bottomIndex >= GRID_COLS * (GRID_ROWS - 1); // top row → open downward

            if (!tree) {
              // empty plantable patch
              const d = compact ? 14 : 18;
              const tappable = canSelectEmpty && !!onSlotClick;
              return (
                <div key={cellIdx} className="relative flex items-end justify-center">
                  <button
                    type="button"
                    aria-label={tappable ? "empty patch — plant a seed" : "empty patch"}
                    disabled={!tappable}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSlotClick?.(bottomIndex, true);
                    }}
                    className={`rounded-full ${tappable ? "cursor-pointer hover:ring-2 hover:ring-[var(--rf-gold)]" : "cursor-default"}`}
                    style={{
                      width: d,
                      height: d,
                      background: "rgba(58,42,26,0.4)",
                      boxShadow: "inset 0 2px 2px rgba(0,0,0,0.3)",
                      border: "none",
                      padding: 0,
                    }}
                  />
                  {isSelected && slotActions.length > 0 && (
                    <ActionMenu actions={slotActions} below={menuBelow} />
                  )}
                </div>
              );
            }

            const waiting = tree.stage === 4 && !!tree.readyAt;
            return (
              <div key={cellIdx} className="group relative flex items-end justify-center">
                {/* Subtle ring timer — hidden until hover/selection */}
                {waiting && tree.readyAt && (
                  <span
                    className={`transition-opacity duration-200 ${
                      isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    }`}
                  >
                    <TreeTimer readyAt={tree.readyAt} size={compact ? 24 : 26} onReady={onTreeReady} />
                  </span>
                )}
                {/* ripening halo + floating spark — always visible so it's
                    obvious which trees are waiting on fruit */}
                {waiting && (
                  <>
                    <span
                      aria-hidden
                      className="rf-ripe-glow absolute bottom-0 left-1/2"
                      style={{ width: compact ? 34 : 46, height: compact ? 34 : 46 }}
                    />
                    {/* the sparkle sits ON the canopy, not floating above it */}
                    <span
                      aria-hidden
                      className="rf-ripe-spark absolute left-1/2 text-[13px] leading-none"
                      style={{ top: compact ? "18%" : "22%" }}
                    >
                      ✨
                    </span>
                  </>
                )}
                <button
                  type="button"
                  aria-label={
                    tree.stage === 5 && tree.isBlossom
                      ? "cherry blossom tree ready to harvest"
                      : tree.stage === 5
                        ? "tree ready to harvest"
                        : waiting
                          ? "tree ripening"
                          : "growing tree"
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    onSlotClick?.(bottomIndex, false);
                  }}
                  className={`relative border-0 bg-transparent p-0 ${waiting ? "rf-ripening" : ""} ${
                    isSelected ? "brightness-110 drop-shadow-[0_0_4px_rgba(221,181,110,0.9)]" : ""
                  }`}
                  style={{ cursor: onSlotClick ? "pointer" : "default" }}
                >
                  <Tree
                    stage={tree.stage}
                    scale={treeScale}
                    fruitIndex={bottomIndex}
                    isBlossom={tree.isBlossom}
                  />
                  {/* the cherry tree's signature drifting petals */}
                  {tree.stage === 5 && tree.isBlossom && <CherryPetals compact={compact} />}
                </button>

                {/* one-shot sparkle ring the moment a cherry tree blossoms */}
                {cherryPop === bottomIndex && (
                  <span
                    aria-hidden
                    className="rf-cherry-pop"
                    style={{ left: "50%", top: "45%", width: compact ? 40 : 56, height: compact ? 40 : 56 }}
                  />
                )}

                {isSelected && slotActions.length > 0 && (
                  <ActionMenu actions={slotActions} below={menuBelow} />
                )}

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

/** Small game-like contextual menu next to a selected plant/patch. */
function ActionMenu({ actions, below }: { actions: SlotAction[]; below: boolean }) {
  return (
    <div
      className={`absolute left-1/2 z-30 flex -translate-x-1/2 gap-1 rounded-lg border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] p-1 shadow-[2px_2px_0_rgba(58,42,26,0.35)] ${
        below ? "top-full mt-1" : "bottom-full mb-1"
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      {actions.map((a) => (
        <button
          key={a.label}
          type="button"
          title={a.label}
          aria-label={a.label}
          onClick={a.onClick}
          className="flex h-10 w-10 items-center justify-center rounded border-2 border-[var(--rf-ink)] bg-white text-lg hover:bg-[var(--rf-gold)] active:translate-y-px"
        >
          {a.icon}
        </button>
      ))}
    </div>
  );
}
