"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { TreeView } from "@/components/pixel/FarmScene";
import { grantTutorialSupplies, completeTutorial } from "@/app/dashboard/actions";
import { subscribeTutorialReplay } from "@/lib/tutorialController";

/**
 * The mandatory first-time tutorial, taught through the REAL farm loop: the
 * player plants, waters, fertilizes, and harvests an actual tree. Coach marks
 * point at the control to use next and advance from genuine game state — never
 * a "Next" button on the action steps. There is no skip/dismiss on the required
 * run; a completed run can be replayed from the Guidebook.
 *
 * See migration 20260710040000: supplies are granted once server-side; Fruits
 * still come only from harvesting.
 */

type Step =
  | "intro"
  | "plant"
  | "water"
  | "timer"
  | "cherry"
  | "fertilize"
  | "harvest"
  | "leaderboard"
  | "explore";

/** Steps where the player interacts with the farm (no blocking backdrop). */
const ACTION_STEPS: Step[] = ["plant", "water", "fertilize", "harvest"];

type StepDef = {
  /** data-tutorial anchor: for "anchored" placement (where to point), or for
   *  "top"/"center" just to drive the action-step highlight ring, if any */
  anchor?: string;
  /**
   * Where the card sits. Never "bottom" — cards must never be pinned near the
   * bottom edge, where a mobile browser's chrome/keyboard can clip them with
   * no way to scroll into view.
   *   "anchored" — below a top-of-screen control (item bar buttons), clamped
   *     so it can never reach the bottom nav; falls back to "top" if the
   *     viewport is too short to fit it.
   *   "top"      — pinned as a context-cue banner just below the header, over
   *     the play area but never at the bottom.
   *   "center"   — a centered modal card (the welcome/finish gate steps).
   */
  placement: "anchored" | "top" | "center";
  /** dim + block the rest of the screen (info/gate steps) */
  blocking: boolean;
  title: string;
  body: string;
  instruction?: string;
  /** button label for gate steps; action steps advance from game state */
  cta?: string;
};

const STEP_DEFS: Record<Step, StepDef> = {
  intro: {
    placement: "center",
    blocking: true,
    title: "Welcome to your farm",
    body: "Let’s take a quick tour. You’ll plant your first Seed, water it, use Fertilizer, and harvest your first Fruit.",
    cta: "Start Tutorial",
  },
  plant: {
    anchor: "item-seed",
    placement: "anchored",
    blocking: false,
    title: "Plant your first Seed",
    body: "Everyone gets 1 free Seed to start. You can earn more Seeds as you play.",
    instruction: "Tap your Seed to plant it in an empty plot.",
  },
  water: {
    anchor: "item-water",
    placement: "anchored",
    blocking: false,
    title: "Give it some Water",
    body: "Water helps your trees grow. Keep tapping Water until your little tree is fully grown.",
    instruction: "Tap Water.",
  },
  timer: {
    placement: "top",
    blocking: true,
    title: "Trees take time",
    body: "Some trees need time before they produce Fruit. You can wait, or use Fertilizer when you want to hurry things along.",
    cta: "Continue",
  },
  cherry: {
    placement: "top",
    blocking: true,
    title: "Rare blooms",
    body: "Every now and then, a tree may become a Cherry Blossom while it grows. Cherry Blossoms are rare — harvesting one gives 30 Cherries plus a bonus Seed and Fertilizer.",
    cta: "Continue",
  },
  fertilize: {
    anchor: "item-fert",
    placement: "anchored",
    blocking: false,
    title: "Use Fertilizer",
    body: "Fertilizer can help a tree finish faster. It’s more special than Water, so use it when it counts.",
    instruction: "Tap Fertilizer.",
  },
  harvest: {
    // kept only for the highlight ring around the play area — the CARD is
    // pinned to the top, never anchored near the bottom of the scene.
    anchor: "farm-scene",
    placement: "top",
    blocking: false,
    title: "Harvest your Fruit",
    body: "Fruits come from trees. Harvested Fruits are what count on the leaderboard.",
    instruction: "Tap the ready tree to harvest.",
  },
  leaderboard: {
    // The real target (the Leaders button) lives in the bottom nav — never
    // anchor a card down there. Shown as a top context cue instead.
    placement: "top",
    blocking: true,
    title: "Fruits are your score",
    body: "Water, Seeds, and Fertilizer help your farm grow. Fruits only come from harvested trees, and Fruits decide the leaderboard.",
    cta: "Continue",
  },
  explore: {
    placement: "center",
    blocking: true,
    title: "Explore the map",
    body: "You know the basics now, but there’s a lot more to discover. Explore the map, check in on your farm, and look out for community events like the Traveling Basket, Golden Goose, and Community Garden.",
    cta: "Finish Tutorial",
  },
};

const STORE_KEY = "rf-tutorial-state";

type Persisted = { step: Step; treeId: string | null };

function loadPersisted(): Persisted | null {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Persisted;
    if (p && typeof p.step === "string") return p;
  } catch {
    /* private mode etc. */
  }
  return null;
}

function savePersisted(p: Persisted | null) {
  try {
    if (p) window.localStorage.setItem(STORE_KEY, JSON.stringify(p));
    else window.localStorage.removeItem(STORE_KEY);
  } catch {
    /* no-op */
  }
}

export type UseTutorialParams = {
  /** tutorial_completed === false → the required run must play */
  required: boolean;
  trees: TreeView[];
  fruitTotal: number;
};

export type TutorialState = {
  /** overlay is showing (required run or replay) */
  active: boolean;
  /** the one tree the farm's item buttons should act on during the tutorial */
  tutorialTreeId: string | null;
  overlay: React.ReactNode;
};

export function useTutorial({ required, trees, fruitTotal }: UseTutorialParams): TutorialState {
  const router = useRouter();
  const [active, setActive] = useState(false);
  // The required first run is mandatory (no exit). A replay is optional and can
  // be ended anytime — it never re-grants supplies, so a farmer without a Seed
  // isn't trapped.
  const [mode, setMode] = useState<"required" | "replay">("required");
  const [step, setStep] = useState<Step>("intro");
  const [treeId, setTreeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // snapshots used to detect real progress
  const plantSnapshot = useRef<Set<string>>(new Set());
  const fruitSnapshot = useRef<number>(0);

  const goTo = useCallback((next: Step, tree: string | null) => {
    setStep(next);
    setTreeId(tree);
    savePersisted({ step: next, treeId: tree });
  }, []);

  // Boot: start (or resume) the required run. Syncing tutorial state to the
  // profile's `required` flag is exactly the external-system case effects are
  // for, so the set-state-in-effect guidance doesn't apply.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!required) {
      setActive(false);
      return;
    }
    setMode("required");
    setActive(true);
    const p = loadPersisted();
    if (p) {
      setStep(p.step);
      setTreeId(p.treeId);
    } else {
      setStep("intro");
      setTreeId(null);
    }
  }, [required]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Replay from the Guidebook/Profile (only meaningful once required is done).
  useEffect(() => {
    return subscribeTutorialReplay(() => {
      savePersisted(null);
      plantSnapshot.current = new Set(trees.map((t) => t.id ?? "").filter(Boolean));
      setTreeId(null);
      setStep("intro");
      setMode("replay");
      setActive(true);
    });
  }, [trees]);

  // When entering the plant step, remember which trees already existed so a
  // freshly planted one is recognisable.
  useEffect(() => {
    if (step === "plant") {
      plantSnapshot.current = new Set(trees.map((t) => t.id ?? "").filter(Boolean));
    }
    if (step === "harvest") {
      fruitSnapshot.current = fruitTotal;
    }
    // Intentionally keyed on step ONLY — re-running on every trees/fruitTotal
    // change would keep re-snapshotting and break new-tree/harvest detection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Advance the machine from real game state (the external system here is the
  // live farm — trees/fruitTotal props — so driving step transitions from it in
  // an effect is intentional).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!active) return;
    const tutTree = treeId ? trees.find((t) => t.id === treeId) ?? null : null;

    // If a tree-dependent step lost its tree (e.g. cleared data), restart the
    // hands-on loop from planting rather than getting stuck.
    if (["water", "timer", "cherry", "fertilize"].includes(step) && treeId && !tutTree) {
      goTo("plant", null);
      return;
    }

    if (step === "plant") {
      const planted = trees.find((t) => t.id && !plantSnapshot.current.has(t.id));
      if (planted?.id) goTo("water", planted.id);
      return;
    }
    if (step === "water") {
      if (tutTree && tutTree.stage >= 4) goTo("timer", treeId);
      return;
    }
    if (step === "fertilize") {
      if (tutTree && tutTree.stage === 5) {
        fruitSnapshot.current = fruitTotal;
        goTo("harvest", treeId);
      }
      return;
    }
    if (step === "harvest") {
      if (fruitTotal > fruitSnapshot.current) goTo("leaderboard", null);
      return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, step, treeId, trees, fruitTotal]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleStart() {
    if (busy) return;
    setBusy(true);
    await grantTutorialSupplies();
    plantSnapshot.current = new Set(trees.map((t) => t.id ?? "").filter(Boolean));
    goTo("plant", null);
    setBusy(false);
    router.refresh();
  }

  async function handleFinish() {
    if (busy) return;
    setBusy(true);
    await completeTutorial();
    savePersisted(null);
    setActive(false);
    setBusy(false);
    router.refresh();
  }

  function handleGateContinue() {
    if (step === "timer") return goTo("cherry", treeId);
    if (step === "cherry") return goTo("fertilize", treeId);
    if (step === "leaderboard") return goTo("explore", null);
  }

  /** End an optional replay early (the required run has no exit). */
  function handleExit() {
    savePersisted(null);
    setActive(false);
  }

  function onCta() {
    if (step === "intro") return void handleStart();
    if (step === "explore") return void handleFinish();
    return handleGateContinue();
  }

  const def = STEP_DEFS[step];
  const overlay = active ? (
    <TutorialCoach
      def={def}
      isAction={ACTION_STEPS.includes(step)}
      busy={busy}
      onCta={onCta}
      onExit={mode === "replay" ? handleExit : undefined}
    />
  ) : null;

  return {
    active,
    tutorialTreeId: ACTION_STEPS.includes(step) ? treeId : null,
    overlay,
  };
}

/* ---------------------------------------------------------------------------
 * Presentational coach mark: a cozy pixel card anchored near the control the
 * player should use, with a pointer triangle and (for action steps) a golden
 * highlight ring around the target. Falls back to a bottom sheet on mobile or
 * when the anchor isn't on screen.
 * ------------------------------------------------------------------------- */

function useAnchorRect(anchor: string | undefined): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  // Tracking a live DOM node's position into state is the intended effect use.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!anchor) {
      setRect(null);
      return;
    }
    const sel = `[data-tutorial="${anchor}"]`;
    const read = () => {
      const el = document.querySelector(sel);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    read();
    const id = window.setInterval(read, 150);
    window.addEventListener("resize", read);
    window.addEventListener("scroll", read, true);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("resize", read);
      window.removeEventListener("scroll", read, true);
    };
  }, [anchor]);
  /* eslint-enable react-hooks/set-state-in-effect */
  return rect;
}

/** Clears the sticky header (SiteNav, ~64px) with a little breathing room. */
const TOP_SAFE = 76;
/** Clears the fixed bottom game menu (~64px) with a little breathing room. */
const BOTTOM_SAFE = 88;
const GAP = 14;
/** Below this much room, an anchored card would be too cramped — use the top
 *  banner instead rather than risk a squeezed or clipped card. */
const MIN_ANCHORED_SPACE = 120;

function TutorialCoach({
  def,
  isAction,
  busy,
  onCta,
  onExit,
}: {
  def: StepDef;
  isAction: boolean;
  busy: boolean;
  onCta: () => void;
  /** present only during an optional replay — lets the farmer end it early */
  onExit?: () => void;
}) {
  const rect = useAnchorRect(def.anchor);
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const vw = typeof window !== "undefined" ? window.innerWidth : 400;
  const cardW = Math.min(340, vw - 24);

  let cardStyle: React.CSSProperties;
  let pointer: "up" | null = null;

  // Cards never sit at the bottom of the screen — only "anchored" (below a
  // top-of-screen control, clamped) or "top"/"center", both well clear of the
  // bottom edge where mobile browser chrome or the fixed bottom nav could
  // clip them with no way to scroll into view.
  if (def.placement === "anchored" && rect) {
    const belowSpace = vh - rect.bottom - GAP - BOTTOM_SAFE;
    if (belowSpace >= MIN_ANCHORED_SPACE) {
      const cx = Math.min(Math.max(rect.left + rect.width / 2, 12 + cardW / 2), vw - 12 - cardW / 2);
      cardStyle = {
        left: cx,
        top: rect.bottom + GAP,
        transform: "translateX(-50%)",
        width: cardW,
        maxHeight: belowSpace,
      };
      pointer = "up";
    } else {
      // Not enough room below the anchor (short viewport) — fall back to the
      // top banner rather than crowd the card toward the bottom edge.
      cardStyle = {
        left: "50%",
        top: TOP_SAFE,
        transform: "translateX(-50%)",
        width: cardW,
        maxHeight: vh - TOP_SAFE - BOTTOM_SAFE,
      };
    }
  } else if (def.placement === "center") {
    cardStyle = {
      left: "50%",
      top: "50%",
      transform: "translate(-50%,-50%)",
      width: cardW,
      maxHeight: vh - TOP_SAFE - BOTTOM_SAFE,
    };
  } else {
    // "top" — a pinned context-cue banner just below the header.
    cardStyle = {
      left: "50%",
      top: TOP_SAFE,
      transform: "translateX(-50%)",
      width: cardW,
      maxHeight: vh - TOP_SAFE - BOTTOM_SAFE,
    };
  }

  return (
    <div
      className="fixed inset-0 z-[70]"
      role="dialog"
      aria-modal={def.blocking}
      aria-label={def.title}
      // Action steps must let taps reach the real control underneath — the whole
      // container is click-through and only the card (pointer-events:auto) and a
      // blocking backdrop capture events.
      style={{ pointerEvents: def.blocking ? "auto" : "none" }}
    >
      {/* Backdrop — blocking gate steps dim + capture taps; action steps have
          no backdrop so the farm stays fully interactive. */}
      {def.blocking && <div className="absolute inset-0 bg-black/45" />}

      {/* Golden highlight ring around the target (action steps with a rect). */}
      {isAction && rect && (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-lg"
          style={{
            left: rect.left - 6,
            top: rect.top - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            border: "3px solid var(--rf-gold)",
            boxShadow: "0 0 0 3px var(--rf-ink), 0 0 14px 3px rgba(242,193,78,0.7)",
          }}
        />
      )}

      {/* The card — overflow-y-auto is a safety net: if content is ever
          taller than the clamped maxHeight allows, it scrolls internally
          rather than getting clipped with no way to see the rest. */}
      <div
        className="ui-frame pointer-events-auto absolute overflow-y-auto bg-[var(--rf-cream)] p-0"
        style={cardStyle}
      >
        {/* Only ever points UP at an anchor above the card — cards never sit
            below their target, so there's no "down" pointer case. */}
        {pointer === "up" && (
          <span
            aria-hidden
            className="absolute left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-[var(--rf-ink)] bg-[var(--rf-cream)]"
            style={{ top: -7, borderTopWidth: 2, borderLeftWidth: 2 }}
          />
        )}
        <div className="p-4">
          <div className="mb-1 flex items-center gap-2">
            <img src="/sprites/icons/seed_packet.png" alt="" className="pixelated h-5 w-5" />
            <span className="text-[9px] font-extrabold uppercase tracking-wider text-[var(--rf-ink-soft)]">
              Tutorial
            </span>
          </div>
          <h2 className="pixel-heading mb-1 text-base">{def.title}</h2>
          <p className="text-[13px] leading-relaxed text-[var(--rf-ink)]">{def.body}</p>
          {def.instruction && (
            <p className="mt-2 rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-gold)]/25 px-2.5 py-1.5 text-[13px] font-extrabold">
              👉 {def.instruction}
            </p>
          )}
          {def.cta && (
            <button
              type="button"
              onClick={onCta}
              disabled={busy}
              className="pixel-btn mt-3 w-full text-sm disabled:opacity-50"
            >
              {busy ? "…" : def.cta}
            </button>
          )}
          {onExit && (
            <button
              type="button"
              onClick={onExit}
              className="mt-2 w-full text-[11px] font-bold text-[var(--rf-ink-soft)] underline"
            >
              End replay
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
