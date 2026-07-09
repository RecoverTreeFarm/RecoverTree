"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const FRUIT_WAIT_MS = 4 * 60 * 60 * 1000; // 4 hours — matches the DB timer

/**
 * Tiny ring timer over a tree waiting on its 4-hour fruit timer. The whole
 * ring changes colour as fruiting nears (red → orange → yellow → green),
 * the middle is open, and the label shows minutes remaining only.
 * Fires onReady (once) + refreshes at zero.
 */
export function TreeTimer({
  readyAt,
  size = 30,
  onReady,
}: {
  readyAt: string;
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

  const pct =
    remaining === null
      ? 0
      : Math.min(100, Math.max(0, ((FRUIT_WAIT_MS - remaining) / FRUIT_WAIT_MS) * 100));
  // whole ring warms up as fruiting approaches
  const ringColor =
    pct < 25 ? "#d9483b" : pct < 50 ? "#e8842b" : pct < 75 ? "#f2c14e" : "#5aa832";
  const minutes = remaining === null ? null : Math.max(0, Math.ceil(remaining / 60000));

  return (
    <span
      className="absolute left-1/2 top-0 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center"
      style={{ width: size, height: size }}
      title="Minutes until this tree bears fruit"
    >
      <span
        aria-hidden
        className="absolute inset-0 rounded-full"
        style={{
          border: `${Math.max(3, Math.round(size * 0.14))}px solid ${ringColor}`,
          boxShadow: "0 0 0 1.5px var(--rf-ink), inset 0 0 0 1.5px var(--rf-ink)",
        }}
      />
      <span
        className="relative font-mono font-bold"
        style={{
          fontSize: Math.round(size * 0.34),
          lineHeight: 1,
          color: "var(--rf-ink)",
          textShadow:
            "1px 0 0 var(--rf-cream), -1px 0 0 var(--rf-cream), 0 1px 0 var(--rf-cream), 0 -1px 0 var(--rf-cream)",
        }}
      >
        {minutes === null ? "…" : minutes <= 0 ? "🍇" : `${minutes}m`}
      </span>
    </span>
  );
}
