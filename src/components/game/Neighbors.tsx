"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SPRITES, AVATAR_SPRITES } from "@/lib/sprites";
import { greetNeighbor, pingLocationPresence } from "@/app/dashboard/actions";
import { announceReward } from "./RewardBanner";
import { playSfx } from "@/lib/sfx";

/* ---------------------------------------------------------------------------
 * Shared "other players are here" plumbing. This is the standard for EVERY
 * location: a 60s presence heartbeat, privacy-filtered neighbors idling in
 * fixed spots, a 5-minute inactivity walk-off, and tap-to-greet (+10 water,
 * once per neighbor per day, server-enforced).
 * ------------------------------------------------------------------------- */

export type Neighbor = {
  key: string;
  name: string;
  avatar_sprite: string | null;
};

export type Visitor = Neighbor & { leaving: boolean };

export type LocationKey = "garden" | "store";

/** A point in scene-percent coords. */
export type Pos = { left: number; bottom: number };

/** Heartbeat + walk-off bookkeeping for one location scene. */
export function usePresence(location: LocationKey, initial: Neighbor[]) {
  const [visitors, setVisitors] = useState<Visitor[]>(
    initial.map((o) => ({ ...o, leaving: false })),
  );
  const visitorsRef = useRef(visitors);
  useEffect(() => {
    visitorsRef.current = visitors;
  }, [visitors]);

  useEffect(() => {
    let alive = true;
    const sync = async () => {
      const r = await pingLocationPresence(location);
      if (!alive || !r.ok) return;
      const next = r.others as Neighbor[];
      const nextKeys = new Set(next.map((n) => n.key));
      const current = visitorsRef.current;
      // anyone who vanished walks off screen, then is removed
      const leaving = current.filter((v) => !nextKeys.has(v.key) && !v.leaving);
      const merged: Visitor[] = [
        ...current
          .filter((v) => nextKeys.has(v.key) || v.leaving || leaving.includes(v))
          .map((v) => (leaving.includes(v) ? { ...v, leaving: true } : v)),
        ...next
          .filter((n) => !current.some((v) => v.key === n.key))
          .map((n) => ({ ...n, leaving: false })),
      ];
      setVisitors(merged);
      if (leaving.length > 0) {
        // remove them right after the fade/poof finishes (rf-vanish is 0.55s)
        setTimeout(() => {
          if (!alive) return;
          setVisitors((vs) => vs.filter((v) => !v.leaving));
        }, 600);
      }
    };
    void sync();
    const iv = setInterval(() => void sync(), 60_000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [location]);

  return visitors;
}

/**
 * Greeting state: walk up beside the neighbor, then hearts over both farmers
 * and the reward banner. `walkTo` comes from useWalk; pass the neighbor's spot
 * so the farmer ends up shoulder-to-shoulder rather than shouting across the
 * lawn.
 */
export function useGreeting(
  walkTo?: (target: Pos, then?: () => void) => void,
) {
  const router = useRouter();
  const [heartFor, setHeartFor] = useState<string | null>(null);
  const [myHeart, setMyHeart] = useState(false);
  const [pending, setPending] = useState(false);

  const greet = useCallback(
    async (v: Visitor, spot?: Pos) => {
      if (v.leaving || pending) return;
      setPending(true);

      const doGreet = async () => {
        const r = await greetNeighbor(v.key);
        setPending(false);
        if (!r.ok) {
          playSfx("error");
          announceReward(r.message);
          return;
        }
        playSfx("seed");
        setHeartFor(v.key);
        setMyHeart(true);
        announceReward(`💧 +${r.water_earned} water — you said hi to ${v.name}!`);
        setTimeout(() => {
          setHeartFor(null);
          setMyHeart(false);
        }, 2600);
        router.refresh();
      };

      if (walkTo && spot) {
        // stand right next to them (their sprite is centered on `left`)
        walkTo({ left: spot.left - 4, bottom: spot.bottom }, () => void doGreet());
      } else {
        await doGreet();
      }
    },
    [pending, router, walkTo],
  );

  return { greet, heartFor, myHeart, greetPending: pending };
}

/**
 * Neighbors don't stand still: each one strolls to a spot, loiters 7–15s,
 * then wanders to another random spot. Each has its own timer, so a crowd
 * never moves in lockstep. Purely cosmetic — no server round-trips.
 */
export function useWandering(count: number, spots: { left: number; bottom: number }[]) {
  // Keyed by index; a growing crowd just reads past the end and falls back to
  // its default spot until its first stroll, so no resize effect is needed.
  const [targets, setTargets] = useState<number[]>(() =>
    Array.from({ length: count }, (_, i) => i % spots.length),
  );
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const localTimers = timers.current;
    function scheduleFor(i: number) {
      // loiter 7–15 seconds, then pick a different spot
      const wait = 7000 + Math.random() * 8000;
      const t = setTimeout(() => {
        setTargets((prev) => {
          const next = [...prev];
          while (next.length <= i) next.push(next.length % spots.length);
          let pick = Math.floor(Math.random() * spots.length);
          if (pick === next[i]) pick = (pick + 1) % spots.length;
          next[i] = pick;
          return next;
        });
        scheduleFor(i);
      }, wait);
      localTimers.push(t);
    }
    for (let i = 0; i < count; i++) scheduleFor(i);
    return () => {
      localTimers.forEach(clearTimeout);
      localTimers.length = 0;
    };
  }, [count, spots.length]);

  return targets;
}

/** Puff-particle offsets (px) for a departing neighbor. */
const POOF = [
  { x: -12, y: -16 },
  { x: 12, y: -14 },
  { x: 0, y: -22 },
  { x: -8, y: -6 },
  { x: 9, y: -4 },
];

/** One neighbor, strolling between spots. Tap to say hi. */
export function NeighborSprite({
  v,
  spot,
  heart,
  onGreet,
  size = 51,
  walking = false,
}: {
  v: Visitor;
  spot: { left: number; bottom: number };
  heart: boolean;
  onGreet: () => void;
  size?: number;
  /** strolling to a new spot (bobs faster) */
  walking?: boolean;
}) {
  const src = (v.avatar_sprite && AVATAR_SPRITES[v.avatar_sprite]) || SPRITES.farmer;
  const anonymous = !v.avatar_sprite;
  return (
    <button
      type="button"
      aria-label={`Say hi to ${v.name}`}
      title={`Say hi to ${v.name}`}
      onClick={(e) => {
        e.stopPropagation();
        onGreet();
      }}
      className={`absolute flex flex-col items-center border-0 bg-transparent p-0 ${
        v.leaving ? "rf-vanish" : ""
      }`}
      style={{
        left: `${spot.left}%`,
        bottom: `${spot.bottom}%`,
        zIndex: Math.round(60 - spot.bottom),
        // only the stroll between spots animates position; leaving is an
        // instant fade (rf-vanish) rather than a slow walk-off
        transition: v.leaving ? "none" : "left 2.4s linear, bottom 2.4s linear",
      }}
    >
      {heart && <span aria-hidden className="rf-reward-pop absolute -top-5 text-lg">💗</span>}
      {/* a small puff of particles as they blink out */}
      {v.leaving && (
        <>
          {POOF.map((p, i) => (
            <span
              key={i}
              aria-hidden
              className="rf-poof"
              style={
                { "--poof-x": `${p.x}px`, "--poof-y": `${p.y}px` } as React.CSSProperties &
                  Record<string, string>
              }
            />
          ))}
        </>
      )}
      <div className={walking && !v.leaving ? "rf-walk" : "rf-idle"}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          className="pixelated"
          style={{ width: size, height: size, ...(anonymous ? { filter: "brightness(0.35)" } : {}) }}
        />
      </div>
      <span className="rounded border border-[var(--rf-ink)]/40 bg-[var(--rf-cream)]/85 px-1 text-[8px] font-bold leading-tight text-[var(--rf-ink)]">
        {v.name}
      </span>
    </button>
  );
}

/** Your own farmer, walking around a location. */
export function PlayerFarmer({
  src,
  pos,
  walking,
  walkMs,
  heart,
  size = 58,
}: {
  src: string;
  pos: { left: number; bottom: number };
  walking: boolean;
  walkMs: number;
  heart: boolean;
  size?: number;
}) {
  return (
    <div
      className="pointer-events-none absolute -translate-x-1/2"
      style={{
        left: `${pos.left}%`,
        bottom: `${pos.bottom}%`,
        zIndex: Math.round(60 - pos.bottom),
        transition: `left ${walkMs}ms linear, bottom ${walkMs}ms linear`,
      }}
    >
      <div className="relative">
        {heart && (
          <span aria-hidden className="rf-reward-pop absolute -top-5 left-1/2 -translate-x-1/2 text-lg">
            💗
          </span>
        )}
        <div className={walking ? "rf-walk" : "rf-idle"}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="Your farmer" className="pixelated" style={{ width: size, height: size }} />
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Click-to-walk with optional blocked rectangles (e.g. the store counter).
 * ------------------------------------------------------------------------- */
/** A no-go box in scene-percent coords. */
export type Blocker = { left: number; right: number; bottom: number; top: number };

export function isBlocked(p: Pos, blockers: Blocker[]): boolean {
  return blockers.some(
    (b) => p.left >= b.left && p.left <= b.right && p.bottom >= b.bottom && p.bottom <= b.top,
  );
}

/**
 * Walk state for a location. `blockers` are rectangles the farmer can't stand
 * in — if a click lands inside one, he stops just short of its near edge
 * instead of strolling through it.
 */
export function useWalk(home: Pos, bounds: { minLeft: number; maxLeft: number; minBottom: number; maxBottom: number }, blockers: Blocker[] = []) {
  const [pos, setPos] = useState<Pos>(home);
  const [walking, setWalking] = useState(false);
  const [walkMs, setWalkMs] = useState(700);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const walkTo = useCallback(
    (target: Pos, then?: () => void) => {
      setPos((from) => {
        const clamped: Pos = {
          left: Math.min(bounds.maxLeft, Math.max(bounds.minLeft, target.left)),
          bottom: Math.min(bounds.maxBottom, Math.max(bounds.minBottom, target.bottom)),
        };
        // Refuse to enter a blocker: stop just below its bottom edge.
        let final = clamped;
        for (const b of blockers) {
          if (isBlocked(clamped, [b])) {
            // stop right at the blocker's near edge, not a stride short of it
            final = { left: clamped.left, bottom: Math.max(bounds.minBottom, b.bottom - 0.5) };
            break;
          }
        }
        const dist = Math.hypot(final.left - from.left, (final.bottom - from.bottom) * 1.6);
        const dur = Math.min(1400, Math.max(350, Math.round(dist * 16)));
        setWalkMs(dur);
        setWalking(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          setWalking(false);
          then?.();
        }, dur + 60);
        return final;
      });
    },
    [bounds, blockers],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  /** Turn a click on the scene into a walk target. */
  const walkToClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      // the sprite is centered on `left`, so walk to exactly where they tapped
      walkTo({
        left: ((e.clientX - rect.left) / rect.width) * 100,
        bottom: ((rect.bottom - e.clientY) / rect.height) * 100,
      });
    },
    [walkTo],
  );

  return { pos, walking, walkMs, walkTo, walkToClick };
}
