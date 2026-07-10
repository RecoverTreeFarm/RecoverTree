/**
 * Tiny sound-effect helper. Sounds live in /public/sfx (from the SoundFX
 * pack). Plays are best-effort and respect a per-browser mute preference.
 * Client-only — every function no-ops during SSR.
 */

/**
 * TODO(cherry-sfx): the cherry blossom deserves its own chime. Drop an
 * `/public/sfx/cherry.ogg` in and change this one constant — nothing else
 * needs to move. Until then it borrows the sparkly "reveal" cue.
 */
const CHERRY_SFX = "/sfx/reveal.ogg";

const SOUNDS = {
  water: "/sfx/water.ogg",
  harvest: "/sfx/harvest.ogg",
  plant: "/sfx/plant.ogg",
  seed: "/sfx/seed.ogg",
  click: "/sfx/click.ogg",
  error: "/sfx/error.ogg",
  charge: "/sfx/charge.ogg", // podium rise / counter count-up
  boom: "/sfx/boom.ogg", // fireworks
  reveal: "/sfx/reveal.ogg", // MVP silhouette reveal
  cherry: CHERRY_SFX, // a cherry blossom tree appeared
} as const;

export type SfxName = keyof typeof SOUNDS;

const MUTE_KEY = "rf-muted";
const VOLUME_KEY = "rf-volume";
const DEFAULT_VOLUME = 0.22; // the app's original fixed level
const cache = new Map<SfxName, HTMLAudioElement>();

export function isMuted(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(MUTE_KEY) === "1";
}

export function setMuted(muted: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  window.dispatchEvent(new Event("rf-mute-change"));
}

/** Per-browser sound-effect volume, 0..1 (defaults to the classic 0.22). */
export function getVolume(): number {
  if (typeof window === "undefined") return DEFAULT_VOLUME;
  const v = parseFloat(window.localStorage.getItem(VOLUME_KEY) ?? "");
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_VOLUME;
}

export function setVolume(volume: number) {
  if (typeof window === "undefined") return;
  const v = Math.min(1, Math.max(0, volume));
  window.localStorage.setItem(VOLUME_KEY, String(v));
  window.dispatchEvent(new Event("rf-volume-change"));
}

export function playSfx(name: SfxName, volume = getVolume()) {
  if (typeof window === "undefined" || isMuted()) return;
  try {
    let audio = cache.get(name);
    if (!audio) {
      audio = new Audio(SOUNDS[name]);
      cache.set(name, audio);
    }
    audio.volume = volume;
    audio.currentTime = 0;
    // Autoplay can reject before the first user gesture — ignore quietly.
    void audio.play().catch(() => {});
  } catch {
    /* no-op */
  }
}
