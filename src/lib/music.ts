/**
 * Background music. One track at a time, tied to a SCENE — the track starts
 * when a scene mounts and stops the moment it unmounts (leaving the location,
 * closing the cinematic). Separate from the sound-effect channel in sfx.ts:
 * `rf-music-enabled` (mirrored to the user's profile) mutes only music.
 *
 * Client-only; every function no-ops during SSR.
 */

const TRACKS = {
  walking: "/music/walking.mp3", // the travel cinematic
  garden: "/music/garden.ogg", // Community Garden
  store: "/music/store.ogg", // General Store
} as const;

export type MusicTrack = keyof typeof TRACKS;

const ENABLED_KEY = "rf-music-enabled";
/** Music sits under the sound effects so cues stay audible over it. */
const MUSIC_VOLUME = 0.18;

let current: { track: MusicTrack; audio: HTMLAudioElement } | null = null;

export function isMusicEnabled(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(ENABLED_KEY) !== "0";
}

/** Mirror the account preference into localStorage (called on page load). */
export function primeMusicEnabled(enabled: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
}

export function setMusicEnabled(enabled: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
  if (!enabled) stopMusic();
  window.dispatchEvent(new Event("rf-music-change"));
}

/**
 * Play a scene's track on a loop. Calling it again with the same track is a
 * no-op (scene re-renders don't restart the music).
 */
export function playMusic(track: MusicTrack) {
  if (typeof window === "undefined") return;
  if (!isMusicEnabled()) return;
  if (current?.track === track) return;

  stopMusic();
  try {
    const audio = new Audio(TRACKS[track]);
    audio.loop = true;
    audio.volume = MUSIC_VOLUME;
    current = { track, audio };
    // Autoplay may reject before the first gesture — the next scene retries.
    void audio.play().catch(() => {});
  } catch {
    /* no-op */
  }
}

/** Stop whatever is playing (scene exit, music disabled). */
export function stopMusic() {
  if (!current) return;
  try {
    current.audio.pause();
    current.audio.currentTime = 0;
  } catch {
    /* no-op */
  }
  current = null;
}
