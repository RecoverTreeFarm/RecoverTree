"use client";

import { useEffect, useState, useTransition } from "react";
import { isMusicEnabled, setMusicEnabled, primeMusicEnabled } from "@/lib/music";
import { setMusicPreference } from "@/app/settings/actions";

/**
 * Music note toggle, beside the speaker in the nav. It turns the background
 * scene music on/off (sound effects keep their own speaker control) and the
 * choice persists on the user's ACCOUNT (profiles.music_enabled), so it
 * follows them to any device. localStorage mirrors it for instant response.
 */
export function MusicToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [, startTransition] = useTransition();

  // Seed localStorage from the account preference on first paint.
  useEffect(() => {
    primeMusicEnabled(initialEnabled);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEnabled(isMusicEnabled());
  }, [initialEnabled]);

  function toggle() {
    const next = !enabled;
    setEnabled(next);
    setMusicEnabled(next); // stops any playing track immediately when off
    startTransition(async () => {
      await setMusicPreference(next);
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={enabled}
      aria-label={enabled ? "Turn music off" : "Turn music on"}
      title={enabled ? "Music on" : "Music off"}
      className={`rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-2 py-1 text-xs font-bold hover:bg-[var(--rf-gold)] ${
        enabled ? "" : "opacity-55 grayscale line-through"
      }`}
    >
      🎵
    </button>
  );
}
