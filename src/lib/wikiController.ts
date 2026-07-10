/**
 * A tiny module-level controller so anything on the dashboard can open the
 * in-game Guidebook to a specific chapter — the "?" button, a feature-guide
 * popup's "Open Help Guide", or the tutorial. There are several "?" buttons on
 * screen (one per location), but only ONE Guidebook panel is mounted (WikiRoot
 * in GameShell), which subscribes here.
 *
 * No context/provider needed — just subscribe/emit.
 */

/** null = closed; otherwise the chapter id to show. */
type Listener = (chapterId: string | null) => void;

const listeners = new Set<Listener>();
let current: string | null = null;

function emit() {
  for (const fn of listeners) fn(current);
}

/** Open the Guidebook to a chapter (defaults to the first chapter). */
export function openWiki(chapterId = "quick-start") {
  current = chapterId;
  emit();
}

export function closeWiki() {
  current = null;
  emit();
}

export function subscribeWiki(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
