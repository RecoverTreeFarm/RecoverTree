"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SPRITES } from "@/lib/sprites";
import { STORE_ITEMS, type StoreItemKey, type StoreState } from "@/lib/store";
import { purchaseStoreItem } from "@/app/dashboard/actions";
import { playSfx } from "@/lib/sfx";
import { playMusic, stopMusic } from "@/lib/music";
import { announceReward } from "./RewardBanner";
import {
  usePresence,
  useGreeting,
  useWalk,
  useWandering,
  NeighborSprite,
  PlayerFarmer,
  type Blocker,
  type Neighbor,
} from "./Neighbors";

/* ---------------------------------------------------------------------------
 * The General Store 🏪 — a cozy WALKABLE interior reached from the map.
 * Click the floor to walk; the counter is solid, so the farmer stops in front
 * of it instead of strolling through. Other shoppers idle by the shelves and
 * can be greeted, exactly like the Community Garden — presence and greeting
 * are shared (Neighbors.tsx), which is the standard for every location.
 *
 * The counter, register, shelves, and floor are drawn in CSS in the app's
 * pixel style (TODO(store-art): slice real furniture from
 * CozySpriteBundle/interior/ once coordinates are mapped). The shopkeeper
 * stands BEHIND the register. Tapping the register OR the shopkeeper (both
 * wear the bouncing "!") opens the purchase menu: a 3x3 shelf grid + today's
 * SALE shelf. Purchases spend Coins server-side — never Fruits.
 * ------------------------------------------------------------------------- */

/* Scene geometry (percent coords). The counter spans the middle of the room;
   its rectangle is a walk blocker. */
const COUNTER = { left: 22, right: 78, bottom: 26, top: 42 };
const COUNTER_BLOCKER: Blocker[] = [COUNTER];
/** The register sits on the counter; the shopkeeper stands right behind it. */
const REGISTER_POS = { left: 50, bottom: 42 };
const KEEPER_POS = { left: 50, bottom: 47 };
/** Where the farmer stands to be served — leaning on the counter. */
const FARMER_AT_COUNTER = { left: 50, bottom: 24.5 };
const FARMER_HOME = { left: 30, bottom: 12 };
const WALK_BOUNDS = { minLeft: 6, maxLeft: 92, minBottom: 6, maxBottom: 52 };

/** Shoppers browse near the shelves, clear of the counter and doorway. */
const SHOPPER_SPOTS = [
  { left: 12, bottom: 14 },
  { left: 84, bottom: 12 },
  { left: 18, bottom: 46 },
  { left: 86, bottom: 44 },
  { left: 70, bottom: 10 },
  { left: 34, bottom: 10 },
  { left: 8, bottom: 30 },
  { left: 90, bottom: 28 },
];

function Bang() {
  return (
    <span
      aria-hidden
      className="rf-bang text-lg font-black"
      style={{ top: -20, color: "var(--rf-gold)", WebkitTextStroke: "1px var(--rf-ink)" }}
    >
      !
    </span>
  );
}

/** A wall shelf holding a few goods (decor only). */
function WallShelf({ items, style }: { items: string; style?: React.CSSProperties }) {
  return (
    <div aria-hidden className="absolute flex flex-col items-center" style={style}>
      <span className="text-base leading-none">{items}</span>
      <span
        className="mt-0.5 block h-2 w-24 rounded-sm"
        style={{ background: "var(--rf-wood)", border: "2px solid var(--rf-ink)", boxShadow: "0 2px 0 rgba(0,0,0,0.25)" }}
      />
    </div>
  );
}

/** The cash register, drawn chunky in CSS. */
function Register() {
  return (
    <span aria-hidden className="relative block" style={{ width: 34, height: 30 }}>
      <span
        className="absolute bottom-0 left-0 right-0 rounded-sm"
        style={{ height: 20, background: "var(--rf-ink)", border: "2px solid var(--rf-ink)", boxShadow: "inset 2px 2px 0 rgba(255,255,255,0.18)" }}
      />
      <span
        className="absolute left-1 top-0 rounded-sm"
        style={{ width: 18, height: 12, background: "var(--rf-cream)", border: "2px solid var(--rf-ink)" }}
      />
      <span className="absolute bottom-1 right-1 text-[9px]" style={{ color: "var(--rf-gold)" }}>🪙</span>
    </span>
  );
}

export function StoreScene({
  state,
  avatarSrc,
  notificationSlot,
}: {
  state: StoreState | null;
  avatarSrc: string;
  notificationSlot?: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  // Store music plays while this scene is mounted and stops the moment the
  // player leaves (unmount) — same contract in every location.
  useEffect(() => {
    playMusic("store");
    return () => stopMusic();
  }, []);

  const others: Neighbor[] = [];
  const visitors = usePresence("store", others);
  const wanderTargets = useWandering(visitors.length, SHOPPER_SPOTS);
  
  const { pos, walking, walkMs, walkTo, walkToClick } = useWalk(
    FARMER_HOME,
    WALK_BOUNDS,
    COUNTER_BLOCKER,
  );
  const { greet, heartFor, myHeart } = useGreeting(walkTo);

  if (!state) {
    return <p className="text-sm text-[var(--rf-ink-soft)]">The General Store isn’t set up yet.</p>;
  }

  /** Tapping the register or the shopkeeper walks you up to the counter. */
  function approachCounter() {
    walkTo(FARMER_AT_COUNTER, () => setMenuOpen(true));
  }

  return (
    <div>
      <div
        className="relative overflow-hidden rounded border-[3px] border-[var(--rf-ink)]"
        style={{ height: "clamp(340px, 52vh, 560px)" }}
        onClick={walkToClick}
      >
        {/* wall */}
        <div className="pointer-events-none absolute inset-x-0 top-0" style={{ height: "56%", background: "#c9a889" }} />
        <div
          className="pointer-events-none absolute inset-x-0"
          style={{ top: "54%", height: 6, background: "var(--rf-soil-dark)", borderTop: "2px solid var(--rf-ink)" }}
        />
        {/* wooden floor */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0"
          style={{
            top: "56%",
            background:
              "repeating-linear-gradient(0deg, var(--rf-wood) 0 22px, var(--rf-soil) 22px 24px)",
          }}
        />

        {/* sign + window + shelves on the wall */}
        <div
          className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-wood)] px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-[var(--rf-cream)]"
          style={{ boxShadow: "0 2px 0 var(--rf-ink)", zIndex: 30 }}
        >
          🏪 General Store
        </div>
        <span
          aria-hidden
          className="pointer-events-none absolute rounded"
          style={{ left: "8%", top: "10%", width: 52, height: 40, background: "var(--rf-sky)", border: "3px solid var(--rf-ink)", boxShadow: "inset 0 0 0 2px var(--rf-cream)" }}
        />
        <WallShelf items="🫙 🍯 🧺" style={{ right: "8%", top: "10%" }} />
        <WallShelf items="🌰 💧 ✨" style={{ right: "30%", top: "18%" }} />
        <WallShelf items="🪴 📦 🧴" style={{ left: "22%", top: "20%" }} />

        {/* floor decor */}
        <span aria-hidden className="pointer-events-none absolute text-xl" style={{ left: "4%", bottom: "6%" }}>🪴</span>
        <span aria-hidden className="pointer-events-none absolute text-lg" style={{ right: "4%", bottom: "5%" }}>📦</span>
        <span aria-hidden className="pointer-events-none absolute text-lg" style={{ right: "10%", bottom: "18%" }}>🧺</span>
        {/* rug */}
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-[50%]"
          style={{ bottom: "4%", width: 150, height: 30, background: "var(--rf-red)", opacity: 0.55, border: "2px solid var(--rf-ink)" }}
        />

        {/* the shopkeeper stands BEHIND the register (drawn first = behind) */}
        <button
          type="button"
          aria-label="Shopkeeper — open the store menu"
          title="Pick something for the farm"
          onClick={(e) => {
            e.stopPropagation();
            approachCounter();
          }}
          className="absolute -translate-x-1/2 border-0 bg-transparent p-0"
          style={{ left: `${KEEPER_POS.left}%`, bottom: `${KEEPER_POS.bottom}%`, zIndex: 8 }}
        >
          <Bang />
          <span className="rf-idle block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={SPRITES.farmerVariants[7]} alt="" className="pixelated" style={{ width: 58, height: 58 }} />
          </span>
        </button>

        {/* the counter — solid: the farmer can't walk through it */}
        <div
          className="pointer-events-none absolute -translate-x-1/2"
          style={{
            left: "50%",
            bottom: `${COUNTER.bottom}%`,
            width: `${COUNTER.right - COUNTER.left}%`,
            height: `${COUNTER.top - COUNTER.bottom}%`,
            zIndex: 12,
          }}
        >
          <div
            className="h-full w-full"
            style={{
              background: "repeating-linear-gradient(90deg, var(--rf-wood) 0 26px, var(--rf-soil) 26px 30px)",
              border: "3px solid var(--rf-ink)",
              borderRadius: 4,
              boxShadow: "0 4px 0 rgba(0,0,0,0.25), inset 0 6px 0 rgba(255,255,255,0.15)",
            }}
          />
        </div>

        {/* the register sits ON the counter, in front of the shopkeeper */}
        <button
          type="button"
          aria-label="Cash register — open the store menu"
          title="Welcome to the General Store"
          onClick={(e) => {
            e.stopPropagation();
            approachCounter();
          }}
          className="absolute -translate-x-1/2 border-0 bg-transparent p-0"
          style={{ left: `${REGISTER_POS.left}%`, bottom: `${REGISTER_POS.bottom}%`, zIndex: 14 }}
        >
          <Bang />
          <span className="rf-farm-object block">
            <Register />
          </span>
        </button>

        {/* other shoppers — tap one to say hi */}
        {visitors.map((v, i) => (
          <NeighborSprite
            key={v.key}
            v={v}
            spot={SHOPPER_SPOTS[wanderTargets[i] ?? i % SHOPPER_SPOTS.length]}
            heart={heartFor === v.key}
            onGreet={() => void greet(v, SHOPPER_SPOTS[wanderTargets[i] ?? i % SHOPPER_SPOTS.length])}
          />
        ))}

        {/* my farmer */}
        <PlayerFarmer src={avatarSrc} pos={pos} walking={walking} walkMs={walkMs} heart={myHeart} />

        {/* HUD overlay */}
        {notificationSlot && (
          <div
            className="absolute right-2 top-2 flex flex-col items-end gap-1.5"
            style={{ zIndex: 70 }}
            onClick={(e) => e.stopPropagation()}
          >
            {notificationSlot}
          </div>
        )}
      </div>

      <p className="mt-2 text-xs font-bold">Welcome to the General Store.</p>
      <p className="text-[11px] text-[var(--rf-ink-soft)]">
        {state.enabled
          ? `Tap the register (or the shopkeeper) to browse. You have 🪙 ${state.coins}.`
          : "The store is closed right now — check back soon."}
      </p>

      {menuOpen && state.enabled && (
        <StoreMenu state={state} onClose={() => setMenuOpen(false)} />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * The purchase menu: a 3x3 shelf grid + today's SALE shelf.
 * ------------------------------------------------------------------------- */
type ShelfEntry =
  | { kind: "item"; key: StoreItemKey }
  | { kind: "lottery" }
  | { kind: "empty" };

const SHELF_GRID: ShelfEntry[] = [
  { kind: "item", key: "water" },
  { kind: "item", key: "fertilizer" },
  { kind: "item", key: "seed" },
  { kind: "item", key: "goose_entry" },
  { kind: "lottery" },
  { kind: "empty" },
  { kind: "empty" },
  { kind: "empty" },
  { kind: "empty" },
];

function shelfCellCls(disabled: boolean) {
  return `relative flex h-20 flex-col items-center justify-end rounded border-2 border-[var(--rf-ink)] pb-1 ${
    disabled ? "bg-[var(--rf-cream)] opacity-60" : "bg-[var(--rf-cream)] hover:bg-[var(--rf-gold)]/30"
  }`;
}

function StoreMenu({ state, onClose }: { state: StoreState; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<{ key: StoreItemKey; sale: boolean } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const gooseBuyable = state.goose_entry_status === "available_to_buy";
  const gooseNote =
    state.goose_entry_status === "no_event"
      ? "No goose visit right now"
      : state.goose_entry_status === "keeper"
        ? "You're the Keeper this time"
        : state.goose_entry_status === "owned"
          ? "Xtra Goose Entry ready."
          : state.goose_entry_status === "used"
            ? "Already used this visit"
            : null;

  function priceOf(key: StoreItemKey, sale: boolean): number {
    if (sale && state.sale?.item_key === key) return state.sale.sale_price;
    return state.prices[key];
  }

  function buy(key: StoreItemKey, sale: boolean) {
    setMsg(null);
    startTransition(async () => {
      const r = await purchaseStoreItem(key, sale);
      if (!r.ok) {
        playSfx("error");
        setMsg({ ok: false, text: r.message });
        return;
      }
      playSfx("harvest");
      const item = STORE_ITEMS[key];
      setMsg({
        ok: true,
        text:
          key === "goose_entry"
            ? "Xtra Goose Entry ready. Find it under your Golden Goose answer. 🎟️"
            : `Added to your inventory: ${item.icon} ${r.quantity > 1 ? `${r.quantity} ` : ""}${item.name}. 🪙 ${r.coins_left} left.`,
      });
      // the same "you got something" banner every reward uses
      announceReward(
        `${item.icon} ${r.quantity > 1 ? `${r.quantity} ` : ""}${item.name} — added to your inventory`,
      );
      setSelected(null);
      router.refresh();
    });
  }

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="General Store menu">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/50" />
      <div className="ui-frame absolute left-1/2 top-1/2 max-h-[86vh] w-[min(94vw,30rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto bg-[var(--rf-cream)] p-4">
        <div className="flex items-center justify-between">
          <h2 className="pixel-heading text-base">Pick something for the farm 🏪</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close store menu"
            className="rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-2 py-0.5 text-xs font-extrabold hover:bg-[var(--rf-gold)]"
          >
            ✕
          </button>
        </div>
        <p className="mt-0.5 text-[11px] text-[var(--rf-ink-soft)]">You have 🪙 {state.coins}.</p>

        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          {/* main 3x3 shelf */}
          <div className="grid flex-1 grid-cols-3 gap-1.5">
            {SHELF_GRID.map((cell, i) => {
              if (cell.kind === "empty") {
                return (
                  <div key={i} className={shelfCellCls(true)} aria-hidden>
                    <span className="text-[9px] font-bold uppercase text-[var(--rf-ink-soft)]/50">— —</span>
                  </div>
                );
              }
              if (cell.kind === "lottery") {
                return (
                  <div key={i} className={shelfCellCls(true)} title="Coming soon.">
                    <span aria-hidden className="text-xl grayscale">🎫</span>
                    <span className="text-[9px] font-extrabold uppercase leading-tight">Lottery</span>
                    <span className="rounded bg-[var(--rf-ink)] px-1 text-[8px] font-extrabold uppercase text-[var(--rf-cream)]">
                      Out of stock
                    </span>
                  </div>
                );
              }
              const item = STORE_ITEMS[cell.key];
              const disabled = cell.key === "goose_entry" && !gooseBuyable;
              return (
                <button
                  key={i}
                  type="button"
                  disabled={disabled || pending}
                  onClick={() => setSelected({ key: cell.key, sale: false })}
                  className={shelfCellCls(disabled)}
                  title={item.blurb}
                >
                  <span aria-hidden className={`text-xl ${disabled ? "grayscale" : ""}`}>{item.icon}</span>
                  <span className="text-[9px] font-extrabold uppercase leading-tight text-center">
                    {cell.key === "water"
                      ? `${state.water_amount} ${item.name}`
                      : (item.shelfName ?? item.name)}
                  </span>
                  <span className="text-[10px] font-bold">🪙 {state.prices[cell.key]}</span>
                  {disabled && gooseNote && (
                    <span
                      className="absolute inset-x-0 -bottom-0.5 truncate px-0.5 text-center text-[7px] font-bold uppercase text-[var(--rf-ink-soft)]"
                      title={gooseNote}
                    >
                      {gooseNote}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* SALE shelf */}
          <div className="sm:w-32">
            <p className="mb-1 text-center text-[10px] font-extrabold uppercase tracking-widest">
              🏷️ Today’s Sale
            </p>
            {state.sale ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => setSelected({ key: state.sale!.item_key, sale: true })}
                className="relative flex h-28 w-full flex-col items-center justify-end rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-gold)]/35 pb-2 hover:bg-[var(--rf-gold)]/60"
              >
                <span className="absolute -top-2 right-1 rotate-6 rounded border border-[var(--rf-ink)] bg-[var(--rf-red)] px-1 text-[9px] font-extrabold text-[var(--rf-cream)]">
                  −{state.sale.discount_percent}%
                </span>
                <span aria-hidden className="text-2xl">{STORE_ITEMS[state.sale.item_key].icon}</span>
                <span className="text-[9px] font-extrabold uppercase leading-tight text-center">
                  {state.sale.item_key === "water"
                    ? `${state.water_amount} Water`
                    : (STORE_ITEMS[state.sale.item_key].shelfName ??
                      STORE_ITEMS[state.sale.item_key].name)}
                </span>
                <span className="text-[10px]">
                  <span className="line-through opacity-60">🪙{state.sale.base_price}</span>{" "}
                  <span className="font-extrabold">🪙{state.sale.sale_price}</span>
                </span>
              </button>
            ) : (
              <div className="flex h-28 w-full flex-col items-center justify-center rounded border-2 border-dashed border-[var(--rf-ink)]/40 text-center">
                <span className="px-2 text-[10px] text-[var(--rf-ink-soft)]">
                  The sale shelf is being restocked.
                </span>
              </div>
            )}
          </div>
        </div>

        {/* confirm panel */}
        {selected && (
          <div className="mt-3 rounded border-2 border-[var(--rf-ink)] bg-white/60 p-3">
            <p className="text-xs font-bold">
              {STORE_ITEMS[selected.key].icon}{" "}
              {selected.key === "water" ? `${state.water_amount} Water` : STORE_ITEMS[selected.key].name}
              {selected.sale && state.sale && (
                <span className="ml-1.5 rounded bg-[var(--rf-red)] px-1 text-[9px] font-extrabold text-[var(--rf-cream)]">
                  SALE −{state.sale.discount_percent}%
                </span>
              )}
            </p>
            <p className="mt-0.5 text-[11px] text-[var(--rf-ink-soft)]">{STORE_ITEMS[selected.key].blurb}</p>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[11px] font-bold">
                Purchase for 🪙 {priceOf(selected.key, selected.sale)}?
              </span>
              <button
                type="button"
                disabled={pending || state.coins < priceOf(selected.key, selected.sale)}
                onClick={() => buy(selected.key, selected.sale)}
                className="pixel-btn text-[11px] disabled:opacity-50"
              >
                {pending ? "Ringing up…" : "Yes, buy it"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setSelected(null)}
                className="pixel-btn pixel-btn--secondary text-[11px]"
              >
                Not now
              </button>
            </div>
            {state.coins < priceOf(selected.key, selected.sale) && (
              <p className="mt-1 text-[10px] font-bold text-[var(--rf-red)]">
                Not enough Coins — the garden, goose, and ceremonies all pay them out. 🪙
              </p>
            )}
          </div>
        )}

        {msg && (
          <p
            role={msg.ok ? "status" : "alert"}
            className={`mt-3 rounded border-2 border-[var(--rf-ink)] px-3 py-2 text-xs font-bold ${
              msg.ok ? "bg-[var(--rf-grass)]" : "bg-[var(--rf-red)] text-[var(--rf-cream)]"
            }`}
          >
            {msg.text}
          </p>
        )}
      </div>
    </div>
  );
}
