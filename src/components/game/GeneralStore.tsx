"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SPRITES } from "@/lib/sprites";
import { PixelIcon } from "@/components/pixel/Sprite";
import { STORE_ITEMS, type StoreItemKey, type StoreState } from "@/lib/store";
import { purchaseStoreItem, greetStorePet } from "@/app/dashboard/actions";
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
  type Pos,
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

/* Scene geometry (percent coords), matched to the owner's painted interior
   (public/sprites/store/store_bg.png, 780x874) and its same-canvas table
   overlay (store_table.png — measured: x 20.6–77.8%, css-bottom 26–34.9%).
   The table sits just above the heart rug and is the service counter; its
   rectangle is a walk blocker. */
const COUNTER = { left: 20.6, right: 77.8, bottom: 26, top: 35 };
const COUNTER_BLOCKER: Blocker[] = [COUNTER];
/** The register sits on the table's top surface; the shopkeeper stands right
 *  behind it, low enough that the table (drawn later, higher z) hides his
 *  legs — otherwise he looks like he's floating above it. */
const REGISTER_POS = { left: 50, bottom: 34 };
/** Right behind the register, a shoulder to its left so both his head and his
 *  "!" stay readable — the table (higher z) still overlaps his lower body,
 *  so he reads as standing behind the counter rather than floating over it. */
const KEEPER_POS = { left: 44, bottom: 36 };
/** Where the farmer stands to be served — leaning on the table. */
const FARMER_AT_COUNTER = { left: 50, bottom: 20 };
const FARMER_HOME = { left: 30, bottom: 12 };
/**
 * Walkable region is the brick FLOOR in FRONT of the table only. maxBottom is
 * held below the table (bottom 26) so the farmer can never climb onto the
 * table or the back wall, and — because every walk is a straight line — can
 * never pass through the table to reach the far side either. The table
 * stays a blocker too, as a belt-and-suspenders end-position guard.
 */
const WALK_BOUNDS = { minLeft: 6, maxLeft: 92, minBottom: 6, maxBottom: 23 };

/** Shoppers browse the front floor, spread out and clear of the counter. */
const SHOPPER_SPOTS = [
  { left: 12, bottom: 12 },
  { left: 28, bottom: 18 },
  { left: 44, bottom: 10 },
  { left: 60, bottom: 17 },
  { left: 78, bottom: 11 },
  { left: 90, bottom: 19 },
  { left: 20, bottom: 22 },
  { left: 70, bottom: 22 },
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


/* ---------------------------------------------------------------------------
 * The shop pet — a little yorkie that wanders the store floor. Pat it (same
 * once-a-day +10 water as greeting a neighbor; server-enforced). Faces the way
 * it's walking. Purely a client-side stroll; the bonus is a server call.
 * ------------------------------------------------------------------------- */
const PET_SPOTS: Pos[] = [
  { left: 14, bottom: 8 },
  { left: 62, bottom: 9 },
  { left: 82, bottom: 15 },
  { left: 38, bottom: 6 },
  { left: 26, bottom: 18 },
  { left: 72, bottom: 20 },
];

const PET_MOVE_MS = 2000; // must match the CSS transition below

function StorePet({ heart, onPat }: { heart: boolean; onPat: (spot: Pos) => void }) {
  const [idx, setIdx] = useState(0);
  const [facing, setFacing] = useState<1 | -1>(1);
  // The yorkie only plays its WALK cycle while it's actually moving between
  // spots; the rest of the time it shows the calm "sit" idle. (Previously the
  // walk GIF ran non-stop, so the dog looked like it was forever running in
  // place.)
  const [moving, setMoving] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const local = timers.current;
    function step() {
      const wait = 4500 + Math.random() * 5000; // amble every ~5–10s
      const t = setTimeout(() => {
        setIdx((prev) => {
          let next = Math.floor(Math.random() * PET_SPOTS.length);
          if (next === prev) next = (next + 1) % PET_SPOTS.length;
          // face toward where it's heading (sprite is drawn facing right)
          setFacing(PET_SPOTS[next].left >= PET_SPOTS[prev].left ? 1 : -1);
          return next;
        });
        setMoving(true);
        const stop = setTimeout(() => setMoving(false), PET_MOVE_MS);
        local.push(stop);
        step();
      }, wait);
      local.push(t);
    }
    step();
    return () => {
      local.forEach(clearTimeout);
      local.length = 0;
    };
  }, []);

  const spot = PET_SPOTS[idx];
  const src = moving
    ? facing === 1
      ? SPRITES.yorkieWalkRight
      : SPRITES.yorkieWalkLeft
    : SPRITES.yorkieSit;
  return (
    <button
      type="button"
      aria-label="Pat the shop pup"
      title="Pat the shop pup"
      onClick={(e) => {
        e.stopPropagation();
        onPat(spot);
      }}
      className="absolute flex flex-col items-center border-0 bg-transparent p-0"
      style={{
        left: `${spot.left}%`,
        bottom: `${spot.bottom}%`,
        // stay a floor character: always below the wall sign (z30), the store
        // menu and the HUD (z70) so it can never render "over" a menu.
        zIndex: Math.min(24, Math.round(28 - spot.bottom)),
        transition: `left ${PET_MOVE_MS}ms linear, bottom ${PET_MOVE_MS}ms linear`,
      }}
    >
      {heart && <span aria-hidden className="rf-reward-pop absolute -top-4 text-base">💗</span>}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="pixelated" style={{ width: 40, height: 40 }} />
    </button>
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
      <span className="absolute bottom-1 right-1">
        <PixelIcon name="coin" size={9} />
      </span>
    </span>
  );
}

export function StoreScene({
  state,
  avatarSrc,
  notificationSlot,
  onOpenLottery,
}: {
  state: StoreState | null;
  avatarSrc: string;
  notificationSlot?: React.ReactNode;
  /** the shelf's Lottery tile opens the Weekly Orchard Lottery window */
  onOpenLottery?: () => void;
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

  // Patting the yorkie: walk over, then the same +10 water bonus as a greeting.
  const router = useRouter();
  const [petHeart, setPetHeart] = useState(false);
  const petPending = useRef(false);

  if (!state) {
    return <p className="text-sm text-[var(--rf-ink-soft)]">The General Store isn’t set up yet.</p>;
  }

  function patPet(spot: Pos) {
    if (petPending.current) return;
    petPending.current = true;
    walkTo({ left: spot.left - 4, bottom: spot.bottom }, async () => {
      const r = await greetStorePet();
      petPending.current = false;
      if (!r.ok) {
        playSfx("error");
        announceReward(r.message);
        return;
      }
      playSfx("seed");
      setPetHeart(true);
      announceReward(
        `💧 +${r.water_earned} water · ✨ +${r.fertilizer_earned} fertilizer — the shop pup loves you!`,
      );
      setTimeout(() => setPetHeart(false), 2600);
      router.refresh();
    });
  }

  /** Tapping the register or the shopkeeper walks you up to the counter. */
  function approachCounter() {
    walkTo(FARMER_AT_COUNTER, () => setMenuOpen(true));
  }

  return (
    <div>
      <div
        className="relative overflow-hidden rounded border-[3px] border-[var(--rf-ink)]"
        style={{
          // the owner's painted interior IS the room — full-size aspect keeps
          // the %-geometry (table blocker, spots) aligned with the image
          aspectRatio: "780 / 874",
          backgroundImage: "url(/sprites/store/store_bg.png)",
          backgroundSize: "100% 100%",
          imageRendering: "pixelated",
        }}
        onClick={walkToClick}
      >
        {/* sign over the door */}
        <div
          className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-wood)] px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-[var(--rf-cream)]"
          style={{ boxShadow: "0 2px 0 var(--rf-ink)", zIndex: 30 }}
        >
          🏪 General Store
        </div>

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
            <img src={SPRITES.farmerVariants[4]} alt="" className="pixelated" style={{ width: 64, height: 64 }} />
          </span>
        </button>

        {/* the table (owner's sprite, same canvas as the background) — the
            service counter, just above the heart rug. Solid: its rectangle is
            a walk blocker; the farmer can't walk through it. Drawn over the
            keeper so his legs disappear behind it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/sprites/store/store_table.png"
          alt=""
          aria-hidden
          className="pixelated pointer-events-none absolute inset-0 h-full w-full"
          style={{ zIndex: 12 }}
        />

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

        {/* the shop yorkie — pat it for a little water (once a day) */}
        <StorePet heart={petHeart} onPat={patPet} />

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
      <p className="flex flex-wrap items-center gap-1 text-[11px] text-[var(--rf-ink-soft)]">
        {state.enabled ? (
          <>
            Tap the register (or the shopkeeper) to browse. You have
            <PixelIcon name="coin" size={13} /> {state.coins}.
          </>
        ) : (
          "The store is closed right now — check back soon."
        )}
      </p>

      {menuOpen && state.enabled && (
        <StoreMenu
          state={state}
          onClose={() => setMenuOpen(false)}
          onOpenLottery={
            onOpenLottery
              ? () => {
                  setMenuOpen(false);
                  onOpenLottery();
                }
              : undefined
          }
        />
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
];

function shelfCellCls(disabled: boolean) {
  return `relative flex h-[68px] flex-col items-center justify-end rounded border-2 border-[var(--rf-ink)] pb-1 ${
    disabled ? "bg-[var(--rf-cream)] opacity-60" : "bg-[var(--rf-cream)] hover:bg-[var(--rf-gold)]/30"
  }`;
}

function StoreMenu({
  state,
  onClose,
  onOpenLottery,
}: {
  state: StoreState;
  onClose: () => void;
  onOpenLottery?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<{ key: StoreItemKey; sale: boolean } | null>(null);
  const [qty, setQty] = useState(1);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function pick(key: StoreItemKey, sale: boolean) {
    setSelected({ key, sale });
    setQty(1); // fresh quantity every time an item is chosen
    setMsg(null);
  }

  // The Goose Entry is one-per-event; everything else can be bought in bulk.
  const canPickQty = selected ? selected.key !== "goose_entry" : false;

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

  function buy(key: StoreItemKey, sale: boolean, count: number) {
    setMsg(null);
    startTransition(async () => {
      const item = STORE_ITEMS[key];
      // Each purchase is its own atomic, re-priced server call. Loop for
      // quantity; if coins run out partway we stop and report what landed.
      let bought = 0;
      let unitsGranted = 0;
      let coinsLeft = state.coins;
      let lastError = "";
      for (let n = 0; n < count; n++) {
        const r = await purchaseStoreItem(key, sale);
        if (!r.ok) {
          lastError = r.message;
          break;
        }
        bought += 1;
        unitsGranted += r.quantity;
        coinsLeft = r.coins_left;
      }

      if (bought === 0) {
        playSfx("error");
        setMsg({ ok: false, text: lastError || "Couldn’t ring that up — try again." });
        return;
      }

      playSfx("harvest");
      if (key === "goose_entry") {
        setMsg({ ok: true, text: "Xtra Goose Entry ready. Find it under your Golden Goose answer. 🎟️" });
        announceReward("🎟️ Xtra Goose Entry — ready");
      } else {
        const label = `${item.icon} ${unitsGranted} ${item.name}`;
        const shortfall = bought < count ? " (Coins ran out.)" : "";
        setMsg({ ok: true, text: `Added to your inventory: ${label}. 🪙 ${coinsLeft} left.${shortfall}` });
        announceReward(`${label} — added to your inventory`);
      }
      setSelected(null);
      router.refresh();
    });
  }

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="General Store menu">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/50" />
      <div className="ui-frame absolute left-1/2 top-1/2 max-h-[92vh] w-[min(94vw,calc(var(--game-w)-1rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto bg-[var(--rf-cream)] p-3">
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
        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-[var(--rf-ink-soft)]">
          You have <PixelIcon name="coin" size={13} /> {state.coins}.
        </p>

        <div className="mt-2 flex flex-row gap-2">
          {/* item shelf */}
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
                // No lottery handler (or lottery off) → the old boarded tile.
                if (!onOpenLottery) {
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
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={onOpenLottery}
                    className={shelfCellCls(false)}
                    title="Weekly Orchard Lottery — buy tickets with Coins."
                  >
                    <PixelIcon name="ticket" size={26} />
                    <span className="text-[9px] font-extrabold uppercase leading-tight">Lottery</span>
                    <span className="rounded bg-[var(--rf-gold)] px-1 text-[8px] font-extrabold uppercase text-[var(--rf-ink)]">
                      Sunday draw
                    </span>
                  </button>
                );
              }
              const item = STORE_ITEMS[cell.key];
              const disabled = cell.key === "goose_entry" && !gooseBuyable;
              return (
                <button
                  key={i}
                  type="button"
                  disabled={disabled || pending}
                  onClick={() => pick(cell.key, false)}
                  className={shelfCellCls(disabled)}
                  title={item.blurb}
                >
                  <PixelIcon name={item.sprite} size={26} className={disabled ? "grayscale" : ""} />
                  <span className="text-[9px] font-extrabold uppercase leading-tight text-center">
                    {cell.key === "water"
                      ? `${state.water_amount} ${item.name}`
                      : (item.shelfName ?? item.name)}
                  </span>
                  <span className="flex items-center gap-0.5 text-[10px] font-bold">
                    <PixelIcon name="coin" size={11} /> {state.prices[cell.key]}
                  </span>
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
          <div className="w-[92px] shrink-0">
            <p className="mb-1 text-center text-[9px] font-extrabold uppercase tracking-widest">
              🏷️ Sale
            </p>
            {state.sale ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => pick(state.sale!.item_key, true)}
                className="relative flex h-[calc(2*68px+0.375rem)] w-full flex-col items-center justify-center gap-1 rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-gold)]/35 pb-2 hover:bg-[var(--rf-gold)]/60"
              >
                <span className="absolute -top-2 right-1 rotate-6 rounded border border-[var(--rf-ink)] bg-[var(--rf-red)] px-1 text-[9px] font-extrabold text-[var(--rf-cream)]">
                  −{state.sale.discount_percent}%
                </span>
                <PixelIcon name={STORE_ITEMS[state.sale.item_key].sprite} size={32} />
                <span className="text-[9px] font-extrabold uppercase leading-tight text-center">
                  {state.sale.item_key === "water"
                    ? `${state.water_amount} Water`
                    : (STORE_ITEMS[state.sale.item_key].shelfName ??
                      STORE_ITEMS[state.sale.item_key].name)}
                </span>
                <span className="flex items-center gap-0.5 text-[10px]">
                  <span className="inline-flex items-center gap-0.5 line-through opacity-60">
                    <PixelIcon name="coin" size={10} />
                    {state.sale.base_price}
                  </span>
                  <span className="inline-flex items-center gap-0.5 font-extrabold">
                    <PixelIcon name="coin" size={11} />
                    {state.sale.sale_price}
                  </span>
                </span>
              </button>
            ) : (
              <div className="flex h-[calc(2*68px+0.375rem)] w-full flex-col items-center justify-center rounded border-2 border-dashed border-[var(--rf-ink)]/40 text-center">
                <span className="px-2 text-[10px] text-[var(--rf-ink-soft)]">
                  Restocking soon.
                </span>
              </div>
            )}
          </div>
        </div>

        {/* confirm panel */}
        {selected && (
          <div className="mt-2 rounded border-2 border-[var(--rf-ink)] bg-white/60 p-2">
            <p className="flex items-center gap-1 text-xs font-bold">
              <PixelIcon name={STORE_ITEMS[selected.key].sprite} size={16} />
              {selected.key === "water" ? `${state.water_amount} Water` : STORE_ITEMS[selected.key].name}
              {selected.sale && state.sale && (
                <span className="ml-1.5 rounded bg-[var(--rf-red)] px-1 text-[9px] font-extrabold text-[var(--rf-cream)]">
                  SALE −{state.sale.discount_percent}%
                </span>
              )}
            </p>
            <p className="mt-0.5 text-[11px] text-[var(--rf-ink-soft)]">{STORE_ITEMS[selected.key].blurb}</p>

            {/* quantity picker (not the one-per-event Goose Entry) */}
            {canPickQty && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--rf-ink-soft)]">
                  Quantity
                </span>
                <button
                  type="button"
                  aria-label="Fewer"
                  disabled={pending || qty <= 1}
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  className="pixel-btn pixel-btn--secondary px-2 py-0.5 text-xs disabled:opacity-40"
                >
                  −
                </button>
                <span className="w-8 text-center text-sm font-extrabold tabular-nums">{qty}</span>
                <button
                  type="button"
                  aria-label="More"
                  disabled={pending || qty >= 99}
                  onClick={() => setQty((q) => Math.min(99, q + 1))}
                  className="pixel-btn pixel-btn--secondary px-2 py-0.5 text-xs disabled:opacity-40"
                >
                  +
                </button>
                {selected.key === "water" && (
                  <span className="flex items-center gap-0.5 text-[10px] text-[var(--rf-ink-soft)]">
                    = <PixelIcon name="water" size={13} /> {state.water_amount * qty}
                  </span>
                )}
              </div>
            )}

            {(() => {
              const unit = priceOf(selected.key, selected.sale);
              const total = unit * qty;
              const tooPoor = state.coins < total;
              return (
                <>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="flex items-center gap-0.5 text-[11px] font-bold">
                      {qty > 1 ? `Buy ${qty} for` : "Purchase for"}{" "}
                      <PixelIcon name="coin" size={12} /> {total}?
                    </span>
                    <button
                      type="button"
                      disabled={pending || tooPoor}
                      onClick={() => buy(selected.key, selected.sale, qty)}
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
                  {tooPoor && (
                    <p className="mt-1 text-[10px] font-bold text-[var(--rf-red)]">
                      Not enough Coins — the garden, goose, and ceremonies all pay them out. 🪙
                    </p>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {msg && (
          <p
            role={msg.ok ? "status" : "alert"}
            className={`mt-2 rounded border-2 border-[var(--rf-ink)] px-3 py-1.5 text-xs font-bold ${
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
