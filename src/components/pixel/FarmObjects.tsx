"use client";

/**
 * Interactive objects that sit beside the house on the farm during community
 * events. Each pulses, wears a bouncing "!", and opens its panel when tapped.
 * They stop click propagation so tapping them never walks the farmer.
 *
 * No basket/box sprites exist in the bundle yet, so the basket uses the same
 * 🧺 emoji as the rest of the UI (rendered ~2x) and the submission box is
 * drawn in CSS (.rf-golden-box).
 */

function Bang() {
  return (
    <span
      aria-hidden
      className="rf-bang text-lg font-black"
      style={{ top: -20, color: "var(--rf-gold)", WebkitTextStroke: "1px var(--rf-ink)" }}
    >
      !
    </span>
  );
}

/** The Traveling Basket, sitting on your farm because you're holding it. */
export function FarmBasket({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="The Traveling Basket is on your farm — open it"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="relative border-0 bg-transparent p-0"
      title="The Traveling Basket — keep it or pass it along"
    >
      <Bang />
      {/* ~2x the size it appears at in the UI */}
      <span aria-hidden className="rf-farm-object block text-4xl leading-none">
        🧺
      </span>
    </button>
  );
}

/**
 * The Golden Goose Submission Box. Non-Keepers see it during the first 24h
 * (drop your anonymous answer in); afterwards the Keeper sees it instead, to
 * read the answers and pick a favorite.
 */
export function GoldenSubmissionBox({
  onClick,
  role,
}: {
  onClick: () => void;
  /** what tapping it opens */
  role: "submit" | "review";
}) {
  return (
    <button
      type="button"
      aria-label={
        role === "submit"
          ? "Golden Goose Submission Box — submit your answer"
          : "Golden Goose Submission Box — read the answers and pick a favorite"
      }
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="relative flex flex-col items-center border-0 bg-transparent p-0"
      title="Golden Goose Submission Box"
    >
      <Bang />
      {/* fruit crates are 22x20 — this is about 2x that */}
      <span aria-hidden className="rf-farm-object rf-golden-box block" style={{ width: 44, height: 40 }} />
      <span className="mt-0.5 max-w-[92px] rounded border border-[var(--rf-ink)] bg-[var(--rf-cream)] px-1 text-[8px] font-extrabold uppercase leading-tight tracking-tight text-[var(--rf-ink)]">
        Golden Goose Submission Box
      </span>
    </button>
  );
}
