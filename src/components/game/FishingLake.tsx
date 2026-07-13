"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { castLine, recordCatch, sellFish } from "@/app/fishing/actions";
import {
  FISH,
  RARITY_BEHAVIOR,
  RARITY_COLOR,
  RARITY_LABEL,
  type FishRarity,
  type FishStack,
  type HookedFish,
} from "@/lib/fish";
import { playSfx } from "@/lib/sfx";
import { playMusic, stopMusic } from "@/lib/music";
import { announceReward } from "./RewardBanner";
import { useWalk, PlayerFarmer, type Blocker, type Pos } from "./Neighbors";

const LAKE_SRC = "/sprites/fishing/lake_scene.png";

/* Scene geometry (percent, bottom-up) matched to lake_scene.png (840x1120):
   water fills the upper 2/3, a walkable grass shore is the bottom third, the
   dock juts from the shore up into the water at centre, and the hut sits on
   the right shore. The player walks the shore + up the dock, but the water is
   two blocker rectangles (with a gap for the dock), so they can't swim. */
const FISH_HOME: Pos = { left: 32, bottom: 12 };
const WALK_BOUNDS = { minLeft: 6, maxLeft: 92, minBottom: 4, maxBottom: 58 };
const WATER_BLOCKERS: Blocker[] = [
  { left: 6, right: 44, bottom: 38, top: 92 }, // water left of the dock
  { left: 56, right: 92, bottom: 38, top: 92 }, // water right of the dock
];
const DOCK_END: Pos = { left: 50, bottom: 55 }; // stand here to cast
const HUT_SPOT: Pos = { left: 74, bottom: 15 }; // stand here to enter the hut
/** true when the farmer is out on the end of the dock (over the water). */
const onDock = (p: Pos) => p.bottom >= 46 && Math.abs(p.left - 50) <= 10;

/* ===========================================================================
 * The Fishing Lake — Phase 1. Admin-only preview: walk the shore, step onto
 * the dock to cast → wait → "!" → tap → the catch minigame → the fish lands
 * in a separate fish inventory. Walk to the hut to sell fish for Coins.
 * ========================================================================= */

type Phase = "idle" | "waiting" | "bite" | "playing" | "result";

export function FishingScene({
  avatarSrc,
  fishInventory,
  fishDifficultyPercent = 100,
  notificationSlot,
}: {
  avatarSrc: string;
  fishInventory: FishStack[];
  /** admin "Fish Catch Difficulty Multiplier" (100 = normal) */
  fishDifficultyPercent?: number;
  notificationSlot?: React.ReactNode;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [hooked, setHooked] = useState<HookedFish | null>(null);
  const [result, setResult] = useState<{ won: boolean; fish: HookedFish } | null>(null);
  const [hutOpen, setHutOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const { pos, walking, walkMs, walkTo, walkToClick } = useWalk(
    FISH_HOME,
    WALK_BOUNDS,
    WATER_BLOCKERS,
  );
  const atDock = onDock(pos) && !walking;

  useEffect(() => {
    playMusic("garden"); // reuse the calm garden loop until a lake track exists
    return () => {
      stopMusic();
      timers.current.forEach(clearTimeout);
    };
  }, []);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  async function cast() {
    if (busy || phase !== "idle") return;
    setBusy(true);
    setResult(null);
    playSfx("water"); // placeholder "cast/splash"
    const r = await castLine();
    setBusy(false);
    if (!r.ok) {
      announceReward(r.message);
      return;
    }
    setHooked(r.fish);
    setPhase("waiting");
    const wait = 1400 + Math.random() * 2600;
    const t1 = setTimeout(() => {
      setPhase("bite");
      playSfx("click"); // placeholder "nibble"
      const t2 = setTimeout(() => {
        setPhase((p) => {
          if (p === "bite") {
            announceReward("It got away — cast again! 🎣");
            return "idle";
          }
          return p;
        });
      }, 1400);
      timers.current.push(t2);
    }, wait);
    timers.current.push(t1);
  }

  function strike() {
    if (phase !== "bite") return;
    clearTimers();
    setPhase("playing");
  }

  /** Tapping the dock walks the farmer out to its end. */
  function goToDock() {
    if (phase !== "idle") return;
    walkTo(DOCK_END);
  }

  /** Tapping the hut walks the farmer over, THEN opens the sell menu. */
  function goToHut() {
    walkTo(HUT_SPOT, () => setHutOpen(true));
  }

  const onMinigameDone = useCallback(
    async (won: boolean) => {
      const fish = hooked;
      if (!fish) return;
      setResult({ won, fish });
      setPhase("result");
      if (won) {
        playSfx("harvest"); // placeholder "catch"
        const r = await recordCatch(fish.species_id);
        if (r.ok) {
          const article = /^[aeiou]/i.test(fish.name) ? "an" : "a";
          announceReward(
            fish.rarity === "legendary"
              ? `🎣 LEGENDARY! You caught the ${fish.name}!`
              : `🎣 You caught ${article} ${fish.name}!`,
          );
          router.refresh();
        } else {
          announceReward(r.message);
        }
      } else {
        playSfx("error"); // placeholder "escape"
        announceReward(`The ${fish.name} slipped away… 🎣`);
      }
    },
    [hooked, router],
  );

  const totalFish = fishInventory.reduce((s, f) => s + f.quantity, 0);

  return (
    <div>
      <div
        className="relative overflow-hidden rounded border-[3px] border-[var(--rf-ink)]"
        style={{
          aspectRatio: "840 / 1120",
          backgroundImage: `url(${LAKE_SRC})`,
          backgroundSize: "100% 100%",
          imageRendering: "pixelated",
          cursor: "pointer",
        }}
        onClick={walkToClick}
      >
        {/* sign */}
        <div
          className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-wood)] px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-[var(--rf-cream)]"
          style={{ boxShadow: "0 2px 0 var(--rf-ink)", zIndex: 30 }}
        >
          🎣 Fishing Lake
        </div>

        {/* ambient shoal — catchable species drifting UNDER the surface. The
            container is clipped to the water rectangle (matched to the lake
            art) so fish never swim onto the shore/dock. Heavy blue tint +
            low opacity reads as "underwater". */}
        <SwimmingFish />

        {/* dock hotspot: a bobbing "!" over the dock end. Tap it (or walk onto
            the dock) to head out to the casting spot. */}
        {phase === "idle" && !atDock && (
          <button
            type="button"
            aria-label="Go to the dock to cast"
            title="Fish from the dock"
            onClick={(e) => {
              e.stopPropagation();
              goToDock();
            }}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: "50%", top: "42%", zIndex: 22 }}
          >
            <span
              className="rf-throb block text-xl font-black leading-none"
              style={{ color: "var(--rf-gold)", WebkitTextStroke: "1.5px var(--rf-ink)" }}
            >
              !
            </span>
          </button>
        )}

        {/* the hut — tap it; the farmer walks over, then the sell menu opens */}
        <button
          type="button"
          aria-label="Fishing hut — sell your fish"
          title="Sell your fish"
          onClick={(e) => {
            e.stopPropagation();
            goToHut();
          }}
          className="absolute"
          style={{ left: "68%", top: "72%", width: "30%", height: "18%", zIndex: 12 }}
        >
          <span
            className="rf-bang absolute left-1/2 top-0 -translate-x-1/2 text-lg font-black"
            style={{ color: "var(--rf-gold)", WebkitTextStroke: "1px var(--rf-ink)" }}
          >
            !
          </span>
        </button>

        {/* the player */}
        <PlayerFarmer src={avatarSrc} pos={pos} walking={walking} walkMs={walkMs} heart={false} size={46} />

        {/* the bite "!" pops up HIGH over the water — out where the line is,
            not over the player's head. Visual only; reel with the button. */}
        {phase === "bite" && (
          <span
            aria-hidden
            className="pointer-events-none absolute left-1/2 -translate-x-1/2 rf-throb text-4xl font-black"
            style={{
              bottom: "74%",
              color: "var(--rf-red)",
              WebkitTextStroke: "2px var(--rf-ink)",
              zIndex: 40,
            }}
          >
            !
          </span>
        )}

        {/* ONE bottom button that transforms in place, so it's always obvious
            where to tap: Cast Line (gold) → Waiting… → Reel In! (red). */}
        {(phase === "waiting" || phase === "bite" || (phase === "idle" && atDock)) && (
          <button
            type="button"
            disabled={busy || phase === "waiting"}
            onClick={(e) => {
              e.stopPropagation();
              if (phase === "idle") cast();
              else if (phase === "bite") strike();
            }}
            className={`pixel-btn absolute bottom-3 left-1/2 -translate-x-1/2 text-xs disabled:opacity-60 ${
              phase === "bite" ? "animate-pulse" : ""
            }`}
            style={
              phase === "bite"
                ? { zIndex: 24, background: "var(--rf-red)", color: "var(--rf-cream)", borderColor: "var(--rf-ink)" }
                : { zIndex: 24 }
            }
          >
            {phase === "idle" ? "🎣 Cast Line" : phase === "waiting" ? "Waiting for a bite…" : "🎣 Reel In!"}
          </button>
        )}
        {phase === "idle" && !atDock && (
          <span
            className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)]/90 px-2.5 py-0.5 text-[11px] font-bold"
            style={{ zIndex: 20 }}
          >
            Walk onto the dock to cast · 🐟 {totalFish}
          </span>
        )}

        {/* HUD (notifications / guidebook), top-right */}
        {notificationSlot && (
          <div className="absolute right-2 top-2 z-40 flex flex-col items-end gap-1.5" onClick={(e) => e.stopPropagation()}>
            {notificationSlot}
          </div>
        )}
      </div>

      <p className="mt-2 text-xs font-bold">The old fishing lake. 🎣</p>
      <p className="text-[11px] text-[var(--rf-ink-soft)]">
        Tap the water to walk the shore. Step onto the dock to cast, reel when you feel a bite, and keep the fish in the green bar. Tap the hut to sell your catch for Coins.
      </p>

      {phase === "playing" && hooked && (
        <FishMinigame
          fish={hooked}
          difficultyPercent={fishDifficultyPercent}
          onDone={onMinigameDone}
        />
      )}

      {phase === "result" && result && (
        <ResultCard result={result} onClose={() => setPhase("idle")} />
      )}

      {hutOpen && (
        <HutSell
          inventory={fishInventory}
          onClose={() => setHutOpen(false)}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * The catch minigame — a vertical track. Hold to raise the green bar; release
 * and it falls. Keep the fish inside the bar to fill the meter; lose ground
 * while it's outside. Works with mouse AND touch (pointer events).
 * ------------------------------------------------------------------------- */
function FishMinigame({
  fish,
  difficultyPercent,
  onDone,
}: {
  fish: HookedFish;
  difficultyPercent: number;
  onDone: (won: boolean) => void;
}) {
  const beh = RARITY_BEHAVIOR[fish.rarity as FishRarity];
  const diff = Math.max(0.4, difficultyPercent / 100);

  // track is 0 (bottom) .. 100 (top). bar spans BAR_H; fish is a point.
  // BASE_WINDOW is intentionally small — future fishing poles will INCREASE
  // this (a per-pole multiplier grows the catch window as you upgrade). Harder
  // fish shave a little off. Floor keeps even the hardest catch playable.
  const BASE_WINDOW = 16;
  const BAR_H = Math.max(
    9,
    BASE_WINDOW - (fish.rarity === "legendary" ? 6 : fish.rarity === "rare" ? 3 : 0),
  );

  // DOM refs — the loop writes styles DIRECTLY every frame (no React re-render
  // per frame, no CSS transitions), so the bar/fish/meter animate smoothly at
  // 60fps. Fixes the meter "only changing colour, not moving" bug.
  const barEl = useRef<HTMLDivElement>(null);
  const fishEl = useRef<HTMLImageElement>(null);
  const meterEl = useRef<HTMLDivElement>(null);

  const holding = useRef(false);
  const barPos = useRef(50 - BAR_H / 2);
  const vel = useRef(0);
  const fishY = useRef(50);
  const fishTarget = useRef(50);
  const meterV = useRef(45);
  const raf = useRef(0);
  const last = useRef(0);
  const done = useRef(false);

  useEffect(() => {
    function frame(now: number) {
      if (done.current) return;
      const dt = Math.min(0.05, last.current ? (now - last.current) / 1000 : 0.016);
      last.current = now;

      // green bar physics: hold = thrust up, release = gravity down
      const accel = holding.current ? 190 : -150;
      vel.current = Math.max(-95, Math.min(95, vel.current + accel * dt));
      barPos.current += vel.current * dt;
      if (barPos.current <= 0) { barPos.current = 0; vel.current *= -0.35; }
      if (barPos.current + BAR_H >= 100) { barPos.current = 100 - BAR_H; vel.current *= -0.35; }

      // fish movement: darts, pauses, drifts toward a target
      if (Math.random() < beh.dartChance) fishTarget.current = Math.random() * 100;
      else if (Math.random() < beh.pause) fishTarget.current = fishY.current;
      fishY.current = Math.max(0, Math.min(100,
        fishY.current + Math.sign(fishTarget.current - fishY.current) * beh.speed * dt));

      // meter: fill inside the bar, drain outside
      const inside = fishY.current >= barPos.current && fishY.current <= barPos.current + BAR_H;
      meterV.current = Math.max(0, Math.min(100,
        meterV.current + (inside ? beh.catchRate : -beh.escapeRate * diff) * dt));

      // write styles directly
      if (barEl.current) barEl.current.style.bottom = `${barPos.current}%`;
      if (fishEl.current) fishEl.current.style.bottom = `${fishY.current}%`;
      if (meterEl.current) {
        meterEl.current.style.height = `${meterV.current}%`;
        meterEl.current.style.background =
          meterV.current > 66 ? "#5f8a6b" : meterV.current > 33 ? "var(--rf-gold)" : "var(--rf-red)";
      }

      if (meterV.current >= 100) { done.current = true; onDone(true); return; }
      if (meterV.current <= 0) { done.current = true; onDone(false); return; }
      raf.current = requestAnimationFrame(frame);
    }
    raf.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hold = () => (holding.current = true);
  const letGo = () => (holding.current = false);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Fishing minigame">
      <div className="absolute inset-0 bg-black/50" />
      <div className="ui-frame relative flex w-[min(92vw,320px)] flex-col items-center gap-2 bg-[var(--rf-cream)] p-4">
        <p className="pixel-heading text-sm">Reel it in! 🎣</p>
        <p className="text-[11px] font-bold" style={{ color: RARITY_COLOR[fish.rarity as FishRarity] }}>
          {RARITY_LABEL[fish.rarity as FishRarity]} · {fish.name}
        </p>

        <div className="flex items-stretch gap-3" style={{ height: 260 }}>
          {/* the vertical track + green bar + fish — DISPLAY ONLY (not
              interactive, so touch never tries to select/highlight it). */}
          <div
            aria-hidden
            className="pointer-events-none relative w-16 select-none rounded border-2 border-[var(--rf-ink)]"
            style={{ background: "linear-gradient(var(--rf-sky), var(--rf-sky-2))" }}
          >
            {/* green catch bar */}
            <div
              ref={barEl}
              className="absolute inset-x-1 rounded"
              style={{
                bottom: `${50 - BAR_H / 2}%`,
                height: `${BAR_H}%`,
                background: "rgba(95,138,107,0.55)",
                border: "2px solid #5f8a6b",
              }}
            />
            {/* the fish */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={fishEl}
              src={FISH[fish.species_id]?.sprite}
              alt=""
              className="pixelated absolute left-1/2 -translate-x-1/2 translate-y-1/2"
              style={{ bottom: "50%", width: 26, height: 26 }}
            />
          </div>

          {/* catch meter — height driven directly by the loop (no transition) */}
          <div className="pointer-events-none relative w-4 select-none overflow-hidden rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)]">
            <div
              ref={meterEl}
              className="absolute inset-x-0 bottom-0"
              style={{ height: "45%", background: "var(--rf-gold)" }}
            />
          </div>
        </div>

        {/* the ONLY control: a big HOLD button below the game. Press-and-hold
            (mouse or touch) raises the bar; release drops it. Kept off the
            track itself so a long-press never triggers text selection / the
            iOS callout. */}
        <button
          type="button"
          aria-label="Hold to raise the bar"
          onPointerDown={(e) => { e.preventDefault(); hold(); }}
          onPointerUp={letGo}
          onPointerLeave={letGo}
          onPointerCancel={letGo}
          onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") hold(); }}
          onKeyUp={letGo}
          onContextMenu={(e) => e.preventDefault()}
          className="pixel-btn mt-1 w-full justify-center py-3 text-sm"
          style={{
            touchAction: "none",
            userSelect: "none",
            WebkitUserSelect: "none",
            WebkitTouchCallout: "none",
          }}
        >
          ⬆ HOLD TO RAISE
        </button>
        <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--rf-ink-soft)]">
          Hold the button to rise · release to fall
        </p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Ambient shoal — catchable species drift under the lake surface. Positioned
 * inside a container clipped to the water rectangle (matched to lake_scene.png:
 * left 10%, top 12.5%, 80% x 45% of the scene), so they never swim onto the
 * shore or dock. A heavy blue wash (sepia + hue-rotate toward blue, dimmed and
 * semi-transparent) makes them read as submerged.
 * ------------------------------------------------------------------------- */
const SHOAL: { sp: string; left: number; top: number; lane: "a" | "b"; delay: number; size: number }[] = [
  { sp: "bluegill", left: 16, top: 30, lane: "a", delay: 0, size: 22 },
  { sp: "sunset_perch", left: 30, top: 60, lane: "b", delay: 2.2, size: 20 },
  { sp: "mossy_carp", left: 22, top: 13, lane: "a", delay: 5, size: 20 },
  { sp: "crystal_trout", left: 70, top: 24, lane: "b", delay: 1, size: 22 },
  { sp: "reed_catfish", left: 85, top: 54, lane: "a", delay: 3.5, size: 20 },
  { sp: "pond_smelt", left: 66, top: 72, lane: "b", delay: 6, size: 18 },
];

function SwimmingFish() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute overflow-hidden"
      style={{ left: "10%", top: "12.5%", width: "80%", height: "45%", borderRadius: "44px", zIndex: 4 }}
    >
      {SHOAL.map((f, i) => (
        <span
          key={i}
          className={`absolute ${f.lane === "a" ? "rf-swim-a" : "rf-swim-b"}`}
          style={{ left: `${f.left}%`, top: `${f.top}%`, animationDelay: `${f.delay}s` }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={FISH[f.sp]?.sprite}
            alt=""
            className="pixelated"
            style={{
              width: f.size,
              height: f.size,
              opacity: 0.6,
              filter: "brightness(0.7) saturate(0.6) sepia(0.45) hue-rotate(165deg)",
            }}
          />
        </span>
      ))}
    </div>
  );
}

function ResultCard({
  result,
  onClose,
}: {
  result: { won: boolean; fish: HookedFish };
  onClose: () => void;
}) {
  const { won, fish } = result;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center" role="dialog" aria-modal="true">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/45" />
      <div className="ui-frame relative w-[min(90vw,300px)] bg-[var(--rf-cream)] p-4 text-center">
        {won ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={FISH[fish.species_id]?.sprite} alt="" className="pixelated mx-auto mb-1" style={{ width: 52, height: 52 }} />
            <h3 className="pixel-heading text-base">You caught it!</h3>
            <p className="mt-1 text-sm font-bold" style={{ color: RARITY_COLOR[fish.rarity as FishRarity] }}>
              {RARITY_LABEL[fish.rarity as FishRarity]} {fish.name}
            </p>
            <p className="mt-0.5 text-[11px] text-[var(--rf-ink-soft)]">Worth 🪙 {fish.coin_value} at the hut.</p>
          </>
        ) : (
          <>
            <span className="text-3xl">💨</span>
            <h3 className="pixel-heading mt-1 text-base">It got away…</h3>
            <p className="mt-1 text-xs text-[var(--rf-ink-soft)]">The {fish.name} slipped off the line. Try again!</p>
          </>
        )}
        <button type="button" onClick={onClose} className="pixel-btn mt-3 text-xs">
          {won ? "🎣 Cast again" : "Try again"}
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * The hut interior — a cozy shopkeeper who buys fish for Coins. No buying.
 * ------------------------------------------------------------------------- */
function HutSell({
  inventory,
  onClose,
}: {
  inventory: FishStack[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function sell(speciesId: string, qty: number) {
    if (pending) return;
    setPending(speciesId);
    const r = await sellFish(speciesId, qty);
    setPending(null);
    if (!r.ok) {
      playSfx("error");
      setMsg(r.message);
      return;
    }
    playSfx("seed"); // placeholder "sell"
    announceReward(`🪙 +${r.coins} — sold ${qty} fish!`);
    setMsg(`Sold ${qty} fish for 🪙 ${r.coins}.`);
    router.refresh();
  }

  const totalWorth = inventory.reduce((s, f) => s + f.coin_value * f.quantity, 0);

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label="Fishing hut">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/50" />
      <div className="ui-frame absolute left-1/2 top-1/2 max-h-[92vh] w-[min(94vw,calc(var(--game-w)-1rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto bg-[var(--rf-cream)] p-3">
        <div className="flex items-center justify-between">
          <h2 className="pixel-heading text-base">🛖 Fishing Hut</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close hut"
            className="rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-2 py-0.5 text-xs font-extrabold hover:bg-[var(--rf-gold)]"
          >
            ✕
          </button>
        </div>

        {/* the shopkeeper */}
        <div className="mt-1 flex items-center gap-2 rounded border-2 border-[var(--rf-ink)] bg-white/50 p-2">
          <span className="text-2xl">🧑‍🦳</span>
          <p className="text-[11px] text-[var(--rf-ink-soft)]">
            “Bring me your catch and I’ll pay you in Coins. Rarer fish fetch more.”
          </p>
        </div>

        {inventory.length === 0 ? (
          <p className="mt-3 rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-3 py-4 text-center text-sm text-[var(--rf-ink-soft)]">
            🐟 No fish to sell yet — cast a line at the lake!
          </p>
        ) : (
          <>
            <ul className="mt-3 space-y-1.5">
              {inventory.map((f) => (
                <li key={f.species_id} className="flex items-center gap-2 rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] p-1.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={FISH[f.species_id]?.sprite} alt="" className="pixelated shrink-0" style={{ width: 28, height: 28 }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-extrabold">
                      {f.name} <span className="text-[10px] font-bold" style={{ color: RARITY_COLOR[f.rarity as FishRarity] }}>· {RARITY_LABEL[f.rarity as FishRarity]}</span>
                    </p>
                    <p className="text-[10px] text-[var(--rf-ink-soft)]">×{f.quantity} · 🪙 {f.coin_value} each</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      disabled={!!pending}
                      onClick={() => sell(f.species_id, 1)}
                      className="pixel-btn pixel-btn--secondary px-2 py-0.5 text-[11px] disabled:opacity-50"
                    >
                      Sell 1
                    </button>
                    <button
                      type="button"
                      disabled={!!pending}
                      onClick={() => sell(f.species_id, f.quantity)}
                      className="pixel-btn px-2 py-0.5 text-[11px] disabled:opacity-50"
                    >
                      Sell all
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-center text-[11px] font-bold text-[var(--rf-ink-soft)]">
              Everything’s worth 🪙 {totalWorth} total.
            </p>
          </>
        )}

        {msg && (
          <p role="status" className="mt-2 rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-grass)] px-3 py-1.5 text-xs font-bold">
            {msg}
          </p>
        )}
      </div>
    </div>
  );
}
