"use client";

import { useEffect, useState } from "react";
import { ICON } from "@/lib/icons";

/**
 * A cozy banner that slides in whenever the player receives something —
 * styled like the travel cinematic's "Heading to your farm…" plate.
 *
 * Anything (server action wrapper, panel, scene) can announce a reward from
 * anywhere without prop drilling:
 *
 *     announceReward("💧 +10 water — thanks for saying hi!");
 *
 * The host lives once in GameShell and stacks up to three at a time.
 */

const EVENT = "rf-reward";
const SHOW_MS = 3400;

export function announceReward(text: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: text }));
}

/** Build the banner text from a reward bundle (skips zero amounts). */
export function rewardText(
  parts: { water?: number; seed?: number; fertilizer?: number; coin?: number },
  suffix = "",
): string {
  const bits: string[] = [];
  if (parts.water) bits.push(`💧 ${parts.water}`);
  if (parts.seed) bits.push(`🌰 ${parts.seed}`);
  if (parts.fertilizer) bits.push(`${ICON.fertilizer} ${parts.fertilizer}`);
  if (parts.coin) bits.push(`🪙 ${parts.coin}`);
  const body = bits.length ? bits.join("  ") : "a little something";
  return suffix ? `${body} — ${suffix}` : body;
}

type Banner = { id: number; text: string };

export function RewardBannerHost() {
  const [banners, setBanners] = useState<Banner[]>([]);

  useEffect(() => {
    let seq = 0;
    function onReward(e: Event) {
      const text = (e as CustomEvent<string>).detail;
      if (!text) return;
      const id = ++seq;
      setBanners((b) => [...b, { id, text }].slice(-3));
      setTimeout(() => setBanners((b) => b.filter((x) => x.id !== id)), SHOW_MS);
    }
    window.addEventListener(EVENT, onReward);
    return () => window.removeEventListener(EVENT, onReward);
  }, []);

  if (banners.length === 0) return null;

  const dismiss = (id: number) => setBanners((b) => b.filter((x) => x.id !== id));

  return (
    <div
      className="rf-fixed-game-w pointer-events-none fixed z-[85] flex flex-col items-center gap-1.5"
      style={{ bottom: "6.5rem" }}
      aria-live="polite"
    >
      {banners.map((b) => (
        <div
          key={b.id}
          role="status"
          className="rf-reward-banner pointer-events-auto relative w-fit max-w-[calc(100%-2rem)] rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] py-1.5 pl-4 pr-7 text-center text-xs font-extrabold uppercase tracking-wide"
          style={{ boxShadow: "0 2px 0 var(--rf-ink)" }}
        >
          {b.text}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismiss(b.id)}
            className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] text-[10px] font-black leading-none hover:bg-[var(--rf-gold)]"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
