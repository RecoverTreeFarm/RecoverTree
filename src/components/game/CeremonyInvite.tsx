"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setCeremonyViewState } from "@/app/dashboard/actions";

/**
 * The season-end invitation. Appears the first time a player opens their own
 * farm after a season's ceremony has run; dismissing or attending records
 * per-user view state server-side, so it never shows again for that season.
 * "Maybe later" keeps the ceremony replayable from the Leaderboard page.
 */
export function CeremonyInvitePopup({
  invite,
}: {
  invite: { season_id: string; season_name: string };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [hidden, setHidden] = useState(false);

  if (hidden) return null;

  function attend() {
    startTransition(async () => {
      await setCeremonyViewState(invite.season_id, "attended");
      router.push(`/ceremony/${invite.season_id}`);
    });
  }

  function later() {
    setHidden(true); // hide immediately; the server write makes it stick
    startTransition(async () => {
      await setCeremonyViewState(invite.season_id, "dismissed");
    });
  }

  return (
    <div className="fixed inset-0 z-[75]" role="dialog" aria-modal="true" aria-label="Season ceremony invitation">
      <div className="absolute inset-0 bg-black/50" />
      <div className="ui-frame absolute left-1/2 top-1/2 w-[min(92vw,22rem)] -translate-x-1/2 -translate-y-1/2 bg-[var(--rf-cream)] p-5 text-center">
        <p aria-hidden className="text-3xl">🎉</p>
        <h2 className="pixel-heading mt-1 text-lg">Great season.</h2>
        <p className="mt-2 text-sm">
          Your farm made it through another month. Come see the {invite.season_name}{" "}
          ceremony and celebrate what everyone grew.
        </p>
        <div className="mt-4 flex flex-col items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={attend}
            className="pixel-btn text-sm disabled:opacity-50"
          >
            {pending ? "Opening…" : "Attend Ceremony"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={later}
            className="pixel-btn pixel-btn--secondary text-xs"
          >
            Maybe later
          </button>
          <p className="text-[10px] text-[var(--rf-ink-soft)]">
            You can replay it any time from the Leaderboard page.
          </p>
        </div>
      </div>
    </div>
  );
}
