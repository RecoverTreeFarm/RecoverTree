"use client";

import { useEffect, useRef, useState } from "react";

export type FarmNotification = {
  /** stable id — dismissal is remembered per id (localStorage) */
  id: string;
  text: string;
};

const STORAGE_KEY = "rf-notif-dismissed";

function loadDismissed(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveDismissed(ids: string[]) {
  try {
    // keep it bounded — old ids never resurface anyway
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids.slice(-120)));
  } catch {
    /* private mode etc. — dismissals just won't persist */
  }
}

/**
 * Small notification center in the bottom-left of the farm. Collapsed: a
 * little "!" button — calm when nothing is unread, gently throbbing when
 * something is. Expanded: small bubbles (1–2 sentences) with an ✕ each.
 * MVP: notifications are derived from current app state client-side;
 * dismissals persist per-browser via localStorage.
 */
export function NotificationCenter({ notifications }: { notifications: FarmNotification[] }) {
  const [open, setOpen] = useState(false);
  // null until mounted so server/client markup match (localStorage is
  // browser-only); until then the button renders in its calm state.
  const [dismissed, setDismissed] = useState<string[] | null>(null);

  useEffect(() => {
    // localStorage is browser-only; syncing it into state after mount is the
    // SSR-safe pattern (initial render must match the server markup).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDismissed(loadDismissed());
  }, []);

  const unread =
    dismissed === null ? [] : notifications.filter((n) => !dismissed.includes(n.id));

  // Tapping anywhere outside the notification area collapses it.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  function dismiss(id: string) {
    setDismissed((prev) => {
      const next = [...(prev ?? []), id];
      saveDismissed(next);
      return next;
    });
  }

  // Position-agnostic: the parent (FarmPanel's top-right HUD stack) anchors
  // this, so the button renders first and the bubble list opens BELOW it.
  return (
    <div ref={rootRef} className="flex flex-col items-end gap-1.5">
      <NotifButton open={open} setOpen={setOpen} unreadCount={unread.length} />
      {open && (
        <div className="flex max-h-56 w-60 flex-col gap-1.5 overflow-y-auto pl-1">
          {unread.length === 0 ? (
            <div
              className="rounded-lg border-2 px-2.5 py-1.5 text-[11px] font-bold"
              style={{
                background: "var(--rf-cream)",
                borderColor: "var(--rf-ink)",
                color: "var(--rf-ink-soft)",
              }}
            >
              All caught up. 🌱
            </div>
          ) : (
            unread.map((n) => (
              <div
                key={n.id}
                className="flex items-start gap-1.5 rounded-lg border-2 px-2.5 py-1.5 text-[11px] font-bold shadow-[2px_2px_0_rgba(58,42,26,0.2)]"
                style={{ background: "var(--rf-cream)", borderColor: "var(--rf-ink)" }}
              >
                <span className="min-w-0 flex-1">{n.text}</span>
                <button
                  type="button"
                  aria-label="Dismiss notification"
                  onClick={() => dismiss(n.id)}
                  className="shrink-0 rounded border border-[var(--rf-ink)]/40 px-1 text-[10px] font-extrabold text-[var(--rf-ink-soft)] hover:bg-[var(--rf-gold)]"
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function NotifButton({
  open,
  setOpen,
  unreadCount,
}: {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  unreadCount: number;
}) {
  return (
    <button
      type="button"
      aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : "Notifications"}
      aria-expanded={open}
      onClick={() => setOpen((o) => !o)}
      className={`relative flex h-10 w-10 items-center justify-center rounded-full border-2 ${
        unreadCount > 0 ? "rf-throb text-lg font-black" : "text-sm font-bold"
      }`}
      style={{
        borderColor: "var(--rf-ink)",
        // unread: dark circle with a readable yellow "!"; calm otherwise
        background: unreadCount > 0 ? "var(--rf-ink)" : "var(--rf-cream)",
        color: unreadCount > 0 ? "var(--rf-gold)" : "var(--rf-ink-soft)",
        opacity: unreadCount > 0 ? 1 : 0.6,
        boxShadow: unreadCount > 0 ? "0 0 0 3px rgba(221,181,110,0.45)" : "none",
      }}
    >
      !
      {unreadCount > 0 && (
        <span
          aria-hidden
          className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 px-1 text-[10px] font-extrabold leading-none"
          style={{
            borderColor: "var(--rf-ink)",
            background: "var(--rf-red)",
            color: "var(--rf-cream)",
          }}
        >
          {unreadCount}
        </span>
      )}
    </button>
  );
}
