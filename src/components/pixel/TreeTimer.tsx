"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Retro text timer for a tree waiting on its fruit timer — a tiny muted
 * "3h 20m" chip, like old game UI text. No rings, no loud countdowns. The
 * parent (FarmScene) only reveals it on hover/selection. Fires onReady once
 * and refreshes at zero; backend timing is unchanged.
 */
export function TreeTimer({
  readyAt,
  onReady,
}: {
  readyAt: string;
  /** kept for call-site compatibility; text sizing is fixed */
  size?: number;
  onReady?: () => void;
}) {
  const router = useRouter();
  const fired = useRef(false);
  // null on first render so server/client markup match (no hydration mismatch)
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => {
      const rem = new Date(readyAt).getTime() - Date.now();
      setRemaining(rem);
      if (rem <= 0 && !fired.current) {
        fired.current = true;
        clearInterval(iv);
        onReady?.();
        router.refresh();
      }
    };
    const iv = setInterval(tick, 1000);
    tick();
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyAt]);

  const label = (() => {
    if (remaining === null) return "…";
    if (remaining <= 0) return "ready";
    const h = Math.floor(remaining / 3_600_000);
    const m = Math.floor((remaining % 3_600_000) / 60_000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  })();

  return (
    <span
      className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-sm border px-1 py-px font-mono text-[9px] font-bold leading-none"
      style={{
        background: "rgba(247,239,223,0.92)", /* --rf-cream, slightly sheer */
        borderColor: "rgba(64,52,42,0.55)",   /* muted ink */
        color: "var(--rf-ink-soft)",
      }}
      title="Time until this tree bears fruit"
    >
      {label}
    </span>
  );
}
