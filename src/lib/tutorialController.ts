/**
 * Lets the Guidebook or Profile ask the dashboard to replay the tutorial.
 * The tutorial itself lives in GameShell (useTutorial); it subscribes here.
 *
 * Replay only re-shows the teaching prompts — it never re-grants supplies
 * (grant_tutorial_supplies is idempotent server-side), so it can't be used to
 * farm Water/Seeds/Fertilizer.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** Request a tutorial replay. Only meaningful after the required run is done. */
export function requestTutorialReplay() {
  for (const fn of listeners) fn();
}

export function subscribeTutorialReplay(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
