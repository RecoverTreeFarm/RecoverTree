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

const LAKE_SRC = "/sprites/fishing/lake_scene.png";

/* ===========================================================================
 * The Fishing Lake — Phase 1. Admin-only preview: cast → wait → "!" → tap →
 * the catch minigame → the fish lands in a separate fish inventory. Sell fish
 * for Coins in the hut on the shore. No rods/bait/seasons/weather yet.
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
    // random bite delay (1.4–4s)
    const wait = 1400 + Math.random() * 2600;
    const t1 = setTimeout(() => {
      setPhase("bite");
      playSfx("click"); // placeholder "nibble"
      // the player has ~1.4s to react or the fish gets away
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
        }}
      >
        {/* sign */}
        <div
          className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-wood)] px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-[var(--rf-cream)]"
          style={{ boxShadow: "0 2px 0 var(--rf-ink)", zIndex: 30 }}
        >
          🎣 Fishing Lake
        </div>

        {/* the angler stands at the end of the dock */}
        <div className="absolute left-1/2 -translate-x-1/2" style={{ top: "44%", zIndex: 10 }}>
          <span className={phase === "waiting" || phase === "bite" ? "rf-idle block" : "block"}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={avatarSrc} alt="" className="pixelated" style={{ width: 46, height: 46 }} />
          </span>
          {/* the bite "!" — tap to strike */}
          {phase === "bite" && (
            <button
              type="button"
              aria-label="Strike!"
              onClick={strike}
              className="absolute -top-6 left-1/2 -translate-x-1/2 rf-throb text-2xl font-black"
              style={{ color: "var(--rf-red)", WebkitTextStroke: "1.5px var(--rf-ink)", zIndex: 40 }}
            >
              !
            </button>
          )}
        </div>

        {/* the hut — tap to sell fish */}
        <button
          type="button"
          aria-label="Fishing hut — sell your fish"
          title="Sell your fish"
          onClick={() => setHutOpen(true)}
          className="absolute"
          style={{ left: "66%", top: "68%", width: "28%", height: "18%", zIndex: 12 }}
        >
          <span className="rf-bang absolute left-1/2 top-0 -translate-x-1/2 text-lg font-black" style={{ color: "var(--rf-gold)", WebkitTextStroke: "1px var(--rf-ink)" }}>
            !
          </span>
        </button>

        {/* cast prompt / status, bottom-centre */}
        <div className="absolute inset-x-0 bottom-3 flex flex-col items-center gap-1.5" style={{ zIndex: 20 }}>
          {phase === "idle" && (
            <button
              type="button"
              disabled={busy}
              onClick={cast}
              className="pixel-btn text-xs disabled:opacity-50"
            >
              🎣 Cast Line
            </button>
          )}
          {phase === "waiting" && (
            <span className="rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-3 py-1 text-xs font-bold">
              Waiting for a bite…
            </span>
          )}
          {phase === "bite" && (
            <button
              type="button"
              onClick={strike}
              className="pixel-btn animate-pulse text-xs"
            >
              Tap to reel! ❗
            </button>
          )}
          <button
            type="button"
            onClick={() => setHutOpen(true)}
            className="rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-2.5 py-0.5 text-[11px] font-bold"
          >
            🐟 Fish: {totalFish} — sell at the hut
          </button>
        </div>

        {/* HUD (notifications / guidebook), top-right */}
        {notificationSlot && (
          <div className="absolute right-2 top-2 z-40 flex flex-col items-end gap-1.5" onClick={(e) => e.stopPropagation()}>
            {notificationSlot}
          </div>
        )}
      </div>

      <p className="mt-2 text-xs font-bold">The old fishing lake. 🎣</p>
      <p className="text-[11px] text-[var(--rf-ink-soft)]">
        Cast your line, reel when you feel a bite, and keep the fish in the green bar. Sell your catch for Coins at the hut.
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
  const BAR_H = Math.max(14, 26 - (fish.rarity === "legendary" ? 8 : fish.rarity === "rare" ? 4 : 0));
  const [barBottom, setBarBottom] = useState(50 - BAR_H / 2);
  const [fishPos, setFishPos] = useState(50);
  const [meter, setMeter] = useState(45);

  const holding = useRef(false);
  const barRef = useRef(50 - BAR_H / 2);
  const velRef = useRef(0);
  const fishRef = useRef(50);
  const fishTarget = useRef(50);
  const meterRef = useRef(45);
  const raf = useRef(0);
  const last = useRef(0);
  const done = useRef(false);

  useEffect(() => {
    function frame(now: number) {
      if (done.current) return;
      const dt = Math.min(0.05, last.current ? (now - last.current) / 1000 : 0.016);
      last.current = now;

      // --- green bar physics: hold = thrust up, release = gravity down ---
      const accel = holding.current ? 190 : -150;
      velRef.current += accel * dt;
      velRef.current = Math.max(-95, Math.min(95, velRef.current));
      barRef.current += velRef.current * dt;
      if (barRef.current <= 0) {
        barRef.current = 0;
        velRef.current *= -0.35; // soft bounce off the floor
      }
      if (barRef.current + BAR_H >= 100) {
        barRef.current = 100 - BAR_H;
        velRef.current *= -0.35; // soft bounce off the ceiling
      }

      // --- fish movement: darts, pauses, drifts toward a target ---
      if (Math.random() < beh.dartChance) {
        fishTarget.current = Math.random() * 100;
      } else if (Math.random() < beh.pause) {
        fishTarget.current = fishRef.current; // brief hold
      }
      const dir = Math.sign(fishTarget.current - fishRef.current);
      fishRef.current += dir * beh.speed * dt;
      fishRef.current = Math.max(0, Math.min(100, fishRef.current));

      // --- meter: fill inside the bar, drain outside ---
      const inside =
        fishRef.current >= barRef.current && fishRef.current <= barRef.current + BAR_H;
      meterRef.current += (inside ? beh.catchRate : -beh.escapeRate * diff) * dt;
      meterRef.current = Math.max(0, Math.min(100, meterRef.current));

      setBarBottom(barRef.current);
      setFishPos(fishRef.current);
      setMeter(meterRef.current);

      if (meterRef.current >= 100) {
        done.current = true;
        onDone(true);
        return;
      }
      if (meterRef.current <= 0) {
        done.current = true;
        onDone(false);
        return;
      }
      raf.current = requestAnimationFrame(frame);
    }
    raf.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hold = () => (holding.current = true);
  const letGo = () => (holding.current = false);

  const meterColor =
    meter > 66 ? "#5f8a6b" : meter > 33 ? "var(--rf-gold)" : "var(--rf-red)";

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Fishing minigame">
      <div className="absolute inset-0 bg-black/50" />
      <div className="ui-frame relative flex w-[min(92vw,320px)] flex-col items-center gap-2 bg-[var(--rf-cream)] p-4">
        <p className="pixel-heading text-sm">Reel it in! 🎣</p>
        <p className="text-[11px] font-bold" style={{ color: RARITY_COLOR[fish.rarity as FishRarity] }}>
          {RARITY_LABEL[fish.rarity as FishRarity]} · {fish.name}
        </p>

        <div className="flex items-stretch gap-3" style={{ height: 260 }}>
          {/* the vertical track + green bar + fish */}
          <div
            role="button"
            tabIndex={0}
            aria-label="Hold to raise the bar"
            onPointerDown={(e) => { e.preventDefault(); hold(); }}
            onPointerUp={letGo}
            onPointerLeave={letGo}
            onPointerCancel={letGo}
            onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") hold(); }}
            onKeyUp={letGo}
            className="relative w-16 cursor-pointer select-none rounded border-2 border-[var(--rf-ink)]"
            style={{ background: "linear-gradient(var(--rf-sky), var(--rf-sky-2))", touchAction: "none" }}
          >
            {/* green catch bar */}
            <div
              className="absolute inset-x-1 rounded"
              style={{
                bottom: `${barBottom}%`,
                height: `${BAR_H}%`,
                background: "rgba(95,138,107,0.55)",
                border: "2px solid #5f8a6b",
              }}
            />
            {/* the fish */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={FISH[fish.species_id]?.sprite}
              alt=""
              className="pixelated absolute left-1/2 -translate-x-1/2 translate-y-1/2"
              style={{ bottom: `${fishPos}%`, width: 26, height: 26 }}
            />
          </div>

          {/* catch meter */}
          <div className="relative w-4 overflow-hidden rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)]">
            <div
              className="absolute inset-x-0 bottom-0 transition-[height] duration-75"
              style={{ height: `${meter}%`, background: meterColor }}
            />
          </div>
        </div>

        <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--rf-ink-soft)]">
          Hold to rise · release to fall
        </p>
      </div>
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
