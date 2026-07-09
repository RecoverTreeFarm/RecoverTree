/**
 * Tiny sound-effect helper. Sounds live in /public/sfx (from the SoundFX
 * pack). Plays are best-effort and respect a per-browser mute preference.
 * Client-only — every function no-ops during SSR.
 */

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
} as const;

export type SfxName = keyof typeof SOUNDS;

const MUTE_KEY = "rf-muted";
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

export function playSfx(name: SfxName, volume = 0.22) {
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
