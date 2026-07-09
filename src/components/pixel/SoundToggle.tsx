"use client";

import { useEffect, useRef, useState } from "react";
import { isMuted, setMuted, playSfx, getVolume, setVolume } from "@/lib/sfx";

/**
 * Mute / unmute toggle for the nav. Clicking it also pops up a small volume
 * slider, which fades away after 5 untouched seconds or when tapping
 * anywhere else on the screen.
 */
export function SoundToggle() {
  const [muted, setM] = useState(false);
  const [vol, setVol] = useState(0.22);
  const [slider, setSlider] = useState<"hidden" | "visible" | "fading">("hidden");
  const rootRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setM(isMuted());
    setVol(getVolume());
    const onChange = () => setM(isMuted());
    window.addEventListener("rf-mute-change", onChange);
    return () => window.removeEventListener("rf-mute-change", onChange);
  }, []);

  function clearTimers() {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
  }

  /** (Re)start the 5s idle countdown, then fade out and unmount. */
  function armAutoHide() {
    clearTimers();
    hideTimer.current = setTimeout(() => {
      setSlider("fading");
      fadeTimer.current = setTimeout(() => setSlider("hidden"), 400);
    }, 5000);
  }

  function showSlider() {
    setSlider("visible");
    armAutoHide();
  }

  // Clicking anywhere else on the screen dismisses the slider immediately.
  useEffect(() => {
    if (slider === "hidden") return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        clearTimers();
        setSlider("hidden");
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [slider]);

  useEffect(() => clearTimers, []);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => {
          const next = !muted;
          setMuted(next);
          setM(next);
          if (!next) playSfx("click");
          showSlider();
        }}
        aria-label={muted ? "Unmute sounds" : "Mute sounds"}
        title={muted ? "Unmute sounds" : "Mute sounds"}
        className="rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-2 py-1 text-xs font-bold hover:bg-[var(--rf-gold)]"
      >
        {muted ? "🔇" : "🔊"}
      </button>

      {slider !== "hidden" && (
        <div
          className="absolute right-0 top-full z-50 mt-1.5 flex items-center gap-2 rounded-lg border-2 px-2.5 py-2 shadow-[2px_2px_0_rgba(58,42,26,0.3)] transition-opacity duration-300"
          style={{
            background: "var(--rf-cream)",
            borderColor: "var(--rf-ink)",
            opacity: slider === "fading" ? 0 : 1,
          }}
        >
          <span aria-hidden className="text-xs">🔉</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(vol * 100)}
            aria-label="Sound volume"
            className="h-2 w-24 accent-[var(--rf-gold)]"
            onPointerDown={() => armAutoHide()}
            onChange={(e) => {
              const v = Number(e.target.value) / 100;
              setVol(v);
              setVolume(v);
              if (muted && v > 0) {
                setMuted(false);
                setM(false);
              }
              armAutoHide();
            }}
            onPointerUp={() => {
              playSfx("click");
              armAutoHide();
            }}
          />
          <span className="w-7 text-right text-[10px] font-bold text-[var(--rf-ink-soft)]">
            {Math.round(vol * 100)}%
          </span>
        </div>
      )}
    </div>
  );
}
