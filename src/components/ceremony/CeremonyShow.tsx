"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Panel } from "@/components/pixel/ui";
import { Sprite } from "@/components/pixel/Sprite";
import { Medal, Badge, type MedalTier } from "@/components/pixel/placeholders";
import { ParticleBurst } from "@/components/pixel/ParticleBurst";
import { playSfx, isMuted } from "@/lib/sfx";

export type ShowFarmer = {
  rank: number;
  name: string;
  username: string | null;
  avatar: string;
  fruits: number;
  isSelf: boolean;
  medal: MedalTier | null;
};
export type ShowBadge = {
  badgeName: string;
  description: string;
  icon: string;
  winnerName: string;
  winnerUsername: string | null;
  winnerAvatar: string;
};
export type ShowMe = {
  medal: MedalTier | null;
  badges: { name: string; icon: string }[];
};

const MEDAL_FERT: Record<MedalTier, number> = { gold: 3, silver: 2, bronze: 1 };
const RISE_MS = 3200; // podium rise + counter duration
const FADE_STAGGER = 700;

const confettiColors = ["#d9483b", "#f2c14e", "#5b8fd6", "#5aa832", "#b06fc9"];

function Confetti({ count = 36 }: { count?: number }) {
  const pieces = Array.from({ length: count }, (_, i) => ({
    left: (i * 97) % 100,
    delay: ((i * 53) % 24) / 10,
    dur: 2 + ((i * 31) % 18) / 10,
    color: confettiColors[i % confettiColors.length],
    w: 5 + (i % 3) * 2,
  }));
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="rf-confetti absolute"
          style={
            {
              left: `${p.left}%`,
              top: -12,
              width: p.w,
              height: p.w * 1.6,
              background: p.color,
              animationDelay: `${p.delay}s`,
              "--fall-t": `${p.dur}s`,
              "--fall-h": "460px",
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

/** Fireworks: staggered golden bursts at pseudo-random spots. */
function Fireworks({ runId }: { runId: number }) {
  const spots = [
    { left: "18%", top: "22%" },
    { left: "74%", top: "16%" },
    { left: "48%", top: "10%" },
    { left: "30%", top: "38%" },
    { left: "64%", top: "34%" },
  ];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {spots.map((s, i) => (
        <span key={`${runId}-${i}`} className="absolute" style={{ left: s.left, top: s.top, animationDelay: `${i * 0.5}s` }}>
          <ParticleBurst kind="harvest" size={90} style={{ animationDelay: `${i * 0.5}s` }} />
        </span>
      ))}
    </div>
  );
}

/** Counter that counts 0 → target over `ms`. */
function CountUp({ target, ms, run }: { target: number; ms: number; run: boolean }) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!run) return;
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setVal(Math.round(target * p * p)); // ease-in for drama
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run, target, ms]);
  return <>{val}</>;
}

/**
 * The "Wrapped"-style ceremony:
 *  Act 1 (podium): top-10 on stage → podiums rise with count-up counters +
 *    fx/sfx → non-top-3 fade out one by one → medals + confetti + fireworks.
 *  Act 2 (mvp): Next → each badge shows a black silhouette, then reveals.
 *  Act 3 (you): personal results (wins + rewards, or gentle tips).
 */
export function CeremonyShow({
  farmers,
  badges,
  me,
  seasonName,
}: {
  farmers: ShowFarmer[];
  badges: ShowBadge[];
  me: ShowMe;
  seasonName: string;
}) {
  const [act, setAct] = useState<"podium" | "mvp" | "you">("podium");
  const [phase, setPhase] = useState<"line" | "rising" | "fading" | "final">("line");
  const [fadedCount, setFadedCount] = useState(0);
  const [mvpShown, setMvpShown] = useState(0); // how many badge cards visible
  const [mvpRevealed, setMvpRevealed] = useState(0); // how many un-silhouetted
  const [runId, setRunId] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const music = useRef<HTMLAudioElement | null>(null);

  const nonTop3 = farmers.filter((f) => f.rank > 3).length;
  const maxFruits = Math.max(1, ...farmers.map((f) => f.fruits));

  // Ceremony music: plays for the whole show, stops when leaving the page.
  useEffect(() => {
    if (isMuted()) return;
    const audio = new Audio("/music/ceremony.ogg");
    audio.loop = true;
    audio.volume = 0.18;
    music.current = audio;
    void audio.play().catch(() => {}); // may need a user gesture first
    return () => {
      audio.pause();
      music.current = null;
    };
  }, []);

  // Act 1 timeline
  useEffect(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setAct("podium");
    setPhase("line");
    setFadedCount(0);
    setMvpShown(0);
    setMvpRevealed(0);
    const t = timers.current;
    t.push(
      setTimeout(() => {
        setPhase("rising");
        playSfx("charge", 0.3);
      }, 1000),
    );
    // fade the non-top-3 one by one after the rise
    for (let i = 1; i <= nonTop3; i++) {
      t.push(
        setTimeout(() => {
          setPhase("fading");
          setFadedCount(i);
          playSfx("click");
        }, 1000 + RISE_MS + i * FADE_STAGGER),
      );
    }
    t.push(
      setTimeout(() => {
        setPhase("final");
        playSfx("boom", 0.3);
      }, 1000 + RISE_MS + nonTop3 * FADE_STAGGER + 600),
    );
    return () => t.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  // Act 2: reveal cadence — each shown card un-silhouettes after a beat
  function showNextMvp() {
    void music.current?.play().catch(() => {}); // resume if autoplay was blocked
    const next = mvpShown + 1;
    setMvpShown(next);
    playSfx("click");
    timers.current.push(
      setTimeout(() => {
        setMvpRevealed(next);
        playSfx("reveal", 0.3);
      }, 1200),
    );
  }

  // One continuous rise: height is proportional to Fruits and every podium
  // animates for the same duration — so higher scores visibly rise faster.
  const podiumH = (f: ShowFarmer) =>
    phase === "line" ? 0 : 24 + (f.fruits / maxFruits) * 170;

  const skipAll = () => {
    void music.current?.play().catch(() => {});
    timers.current.forEach(clearTimeout);
    setPhase("final");
    setFadedCount(nonTop3);
  };

  return (
    <div className="relative">
      {/* ------------------------------ ACT 1: PODIUM ----------------------- */}
      {act === "podium" && (
        <Panel className="relative overflow-hidden" >
          <h2 className="pixel-heading mb-2 text-center text-xl">🎪 {seasonName} — Top Farmers</h2>
          <div className="relative flex min-h-[380px] items-end justify-center gap-2 pb-8 pt-4">
            {phase === "final" && <Confetti />}
            {phase === "final" && <Fireworks runId={runId} />}

            {farmers.map((f) => {
              const fadeIdx = f.rank - 3; // 4th → 1, 5th → 2 …
              const faded = f.rank > 3 && fadedCount >= fadeIdx;
              const hidden = phase === "final" && f.rank > 3;
              if (hidden && faded) {
                // keep layout tight in final: drop them entirely
                return null;
              }
              return (
                <div
                  key={f.rank}
                  className={`flex flex-col items-center ${faded ? "rf-fade-out" : ""}`}
                  style={{ transition: "opacity 0.5s" }}
                >
                  <Sprite src={f.avatar} size={[16, 16]} scale={3} alt="" />
                  <span className="mt-0.5 max-w-16 truncate text-[10px] font-bold">
                    {f.name}
                    {f.isSelf ? " ⭐" : ""}
                  </span>
                  {/* counter */}
                  <span className="font-mono text-[11px] font-bold text-[var(--rf-ink-soft)]">
                    <CountUp target={f.fruits} ms={RISE_MS} run={phase !== "line"} />
                  </span>
                  {/* rising podium — same duration for all, so taller = faster */}
                  <div
                    className="relative mt-1 w-14 rounded-t border-[3px] border-[var(--rf-ink)] bg-[var(--rf-wood)]"
                    style={{
                      height: podiumH(f),
                      transition: `height ${RISE_MS / 1000}s ease-out`,
                    }}
                  >
                    {phase === "rising" && (
                      <ParticleBurst kind="ready" size={40} style={{ left: "50%", top: -6, transform: "translateX(-50%)" }} />
                    )}
                    {phase === "final" && f.medal && (
                      <span className="absolute left-1/2 top-2 -translate-x-1/2">
                        <Medal tier={f.medal} size={30} />
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex justify-center gap-3">
            {phase !== "final" ? (
              <button type="button" onClick={skipAll} className="pixel-btn pixel-btn--secondary">
                ⏭ Skip
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setAct("mvp");
                  showNextMvp();
                }}
                className="pixel-btn"
              >
                Next →
              </button>
            )}
          </div>
        </Panel>
      )}

      {/* ------------------------------- ACT 2: MVP ------------------------- */}
      {act === "mvp" && (
        <Panel className="relative overflow-hidden">
          <h2 className="pixel-heading mb-4 text-center text-xl">🎖️ MVP Awards</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {badges.slice(0, mvpShown).map((b, i) => {
              const revealed = mvpRevealed > i;
              return (
                <div key={i} className="rf-cine-in relative rounded border-[3px] border-[var(--rf-ink)] bg-white/60 p-4 text-center">
                  {revealed && <ParticleBurst kind="harvest" size={80} style={{ left: "50%", top: "40%", transform: "translate(-50%,-50%)" }} />}
                  <div className="text-3xl" aria-hidden>{b.icon}</div>
                  <Badge icon={b.icon} label={b.badgeName} earned />
                  <p className="mt-1 text-[10px] text-[var(--rf-ink-soft)]">{b.description}</p>
                  <div className="mt-3 flex flex-col items-center gap-1 border-t-2 border-dashed border-[var(--rf-ink)]/40 pt-3">
                    <span className={revealed ? "rf-revealed rf-silhouette" : "rf-silhouette"}>
                      <Sprite src={b.winnerAvatar} size={[16, 16]} scale={3} alt="" />
                    </span>
                    <span className="text-sm font-bold">
                      {revealed ? (
                        b.winnerUsername ? (
                          <Link href={`/profile/${b.winnerUsername}`} className="underline">
                            {b.winnerName}
                          </Link>
                        ) : (
                          b.winnerName
                        )
                      ) : (
                        "???"
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-5 flex justify-center">
            {mvpShown < badges.length ? (
              <button
                type="button"
                onClick={showNextMvp}
                disabled={mvpRevealed < mvpShown}
                className="pixel-btn disabled:opacity-50"
              >
                Next →
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setAct("you");
                  playSfx("seed", 0.3);
                }}
                disabled={mvpRevealed < mvpShown}
                className="pixel-btn disabled:opacity-50"
              >
                Next →
              </button>
            )}
          </div>
        </Panel>
      )}

      {/* ------------------------------- ACT 3: YOU ------------------------- */}
      {act === "you" && (
        <Panel className="relative overflow-hidden text-center">
          {(me.medal || me.badges.length > 0) && <Confetti count={24} />}
          <h2 className="pixel-heading mb-4 text-xl">🌱 Your {seasonName}</h2>

          {me.medal || me.badges.length > 0 ? (
            <div className="mx-auto max-w-md space-y-4">
              <p className="text-sm font-bold">You did it — look what you grew:</p>
              {me.medal && (
                <div className="flex items-center justify-center gap-3">
                  <Medal tier={me.medal} size={44} />
                  <div className="text-left text-sm">
                    <p className="font-extrabold uppercase">{me.medal} medal</p>
                    <p className="text-xs text-[var(--rf-ink-soft)]">
                      +{MEDAL_FERT[me.medal]} fertilizer for next month ✨
                    </p>
                  </div>
                </div>
              )}
              {me.badges.map((b, i) => (
                <div key={i} className="flex items-center justify-center gap-3">
                  <Badge icon={b.icon} label={b.name} earned />
                  <span className="text-xs text-[var(--rf-ink-soft)]">+1 fertilizer ✨</span>
                </div>
              ))}
              <p className="text-xs text-[var(--rf-ink-soft)]">
                Your rewards are already on next month’s farm. Keep showing up. 💛
              </p>
            </div>
          ) : (
            <div className="mx-auto max-w-md space-y-3">
              <p className="text-sm font-bold">No medals this time — better luck next month! 🌤️</p>
              <p className="text-xs text-[var(--rf-ink-soft)]">A few gentle tips for next Season:</p>
              <ul className="mx-auto max-w-xs space-y-1.5 text-left text-xs text-[var(--rf-ink-soft)]">
                <li>💧 Attend meetings — every code is water for your trees</li>
                <li>🌱 Send your daily Seed — kindness earns water too</li>
                <li>📋 Finish checklist goals for bonus water + fertilizer</li>
                <li>🧺 Water daily and harvest often — Fruits win medals</li>
              </ul>
              <p className="text-xs font-bold">Showing up is the real win. See you out there. 💛</p>
            </div>
          )}

          <div className="mt-6 flex justify-center gap-3">
            <button type="button" onClick={() => setRunId((n) => n + 1)} className="pixel-btn pixel-btn--secondary">
              ↻ Replay
            </button>
            <Link href="/dashboard" className="pixel-btn">
              Return to your farm
            </Link>
          </div>
        </Panel>
      )}
    </div>
  );
}
