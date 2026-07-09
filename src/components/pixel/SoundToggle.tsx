"use client";

import { useEffect, useState } from "react";
import { isMuted, setMuted, playSfx } from "@/lib/sfx";

/** Mute / unmute toggle for the nav — this app leans on sound feedback. */
export function SoundToggle() {
  const [muted, setM] = useState(false);

  useEffect(() => {
    setM(isMuted());
    const onChange = () => setM(isMuted());
    window.addEventListener("rf-mute-change", onChange);
    return () => window.removeEventListener("rf-mute-change", onChange);
  }, []);

  return (
    <button
      type="button"
      onClick={() => {
        const next = !muted;
        setMuted(next);
        setM(next);
        if (!next) playSfx("click");
      }}
      aria-label={muted ? "Unmute sounds" : "Mute sounds"}
      title={muted ? "Unmute sounds" : "Mute sounds"}
      className="rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-2 py-1 text-xs font-bold hover:bg-[var(--rf-gold)]"
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}
