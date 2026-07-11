"use client";

import { openWiki } from "@/lib/wikiController";
import { markFeatureIntroSeen } from "@/app/dashboard/actions";

/**
 * First-time feature guides. NOT tutorials — the first time a player reaches a
 * major feature area we show one small cozy popup asking whether they'd like to
 * read that feature's Guidebook chapter. Once dismissed (either button) it
 * never appears again (tracked in profiles.feature_intro_seen). Shown only
 * after the required tutorial is complete, so the two never overlap.
 */

export type FeatureKey =
  | "meeting_code"
  | "store"
  | "community_garden"
  | "traveling_basket"
  | "golden_goose"
  | "lottery"
  | "fishing_lake";

type Guide = { title: string; body: string; icon: string; chapter: string };

export const FEATURE_GUIDES: Record<FeatureKey, Guide> = {
  meeting_code: {
    title: "Meeting Codes",
    body: "Meetings happen outside the app. When a host reads a code aloud, enter it here to earn farm supplies.",
    icon: "🎟️",
    chapter: "meeting-codes",
  },
  store: {
    title: "Store",
    body: "The Store is where you can browse farm items, cosmetics, or future upgrades. Want to learn how it works?",
    icon: "🛒",
    chapter: "general-store",
  },
  community_garden: {
    title: "Community Garden",
    body: "The Community Garden is a shared space where everyone can help something grow together.",
    icon: "🌱",
    chapter: "community-garden",
  },
  traveling_basket: {
    title: "Traveling Basket",
    body: "The Traveling Basket moves through the community. Add supplies, pass it on, or keep what’s inside.",
    icon: "🧺",
    chapter: "traveling-basket",
  },
  golden_goose: {
    title: "Golden Goose",
    body: "The Golden Goose visits a Keeper, who posts a question in the community chat. Answers can earn a Golden Goose Egg.",
    icon: "🪿",
    chapter: "golden-goose",
  },
  lottery: {
    title: "Weekly Orchard Lottery",
    body: "Buy up to 3 tickets with Coins. Every ticket adds to the community pot, the Orchard adds a bonus, and one ticket is drawn on Sunday.",
    icon: "🎟️",
    chapter: "weekly-lottery",
  },
  fishing_lake: {
    title: "Fishing",
    body: "Cast your line and try your luck! Keep the fish inside the green bar until the catch meter fills. Different fish behave differently and can be sold for Coins in the fishing hut.",
    icon: "🎣",
    chapter: "fishing",
  },
};

export function FeatureGuidePopup({
  feature,
  onSeen,
}: {
  feature: FeatureKey;
  /** called after we persist the "seen" flag so the parent can stop showing it */
  onSeen: () => void;
}) {
  const guide = FEATURE_GUIDES[feature];

  async function dismiss(openGuide: boolean) {
    // optimistic: hide immediately, then persist
    onSeen();
    if (openGuide) openWiki(guide.chapter);
    await markFeatureIntroSeen(feature);
  }

  return (
    <div className="fixed inset-0 z-[65] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={guide.title}>
      <button
        type="button"
        aria-label="Not now"
        onClick={() => void dismiss(false)}
        className="absolute inset-0 bg-black/40"
      />
      <div className="ui-frame relative mx-2 mb-24 w-full max-w-sm bg-[var(--rf-cream)] p-0 sm:mb-0">
        <div className="flex flex-col items-center p-5 text-center">
          <span aria-hidden className="text-4xl leading-none">
            {guide.icon}
          </span>
          <h2 className="pixel-heading mt-2 text-lg">{guide.title}</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--rf-ink)]">{guide.body}</p>
          <div className="mt-4 flex w-full flex-col gap-2">
            <button type="button" onClick={() => void dismiss(true)} className="pixel-btn w-full text-sm">
              📖 Open Help Guide
            </button>
            <button
              type="button"
              onClick={() => void dismiss(false)}
              className="pixel-btn pixel-btn--secondary w-full text-sm"
            >
              Not Now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
