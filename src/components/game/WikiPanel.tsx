"use client";

import { useState } from "react";
import { WIKI_CHAPTERS, BUG_REPORT_EMAIL, type WikiChapter } from "@/lib/wiki";

/**
 * The in-game guidebook. `WikiHelp` is the little "?" button that lives in the
 * farm's bottom-left sidebar (under the "!" notification button); tapping it
 * opens the guide as a game window — chapter tabs down the side on desktop,
 * a scrollable tab row on mobile. Content lives in src/lib/wiki.ts.
 */
export function WikiHelp() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-label="Open the guidebook"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="flex h-10 w-10 items-center justify-center rounded-full border-2 text-sm font-bold"
        style={{
          borderColor: "var(--rf-ink)",
          background: open ? "var(--rf-gold)" : "var(--rf-cream)",
          color: open ? "var(--rf-ink)" : "var(--rf-ink-soft)",
          opacity: open ? 1 : 0.6,
        }}
      >
        ?
      </button>
      {open && <WikiPanel onClose={() => setOpen(false)} />}
    </>
  );
}

function WikiPanel({ onClose }: { onClose: () => void }) {
  const [chapterId, setChapterId] = useState(WIKI_CHAPTERS[0].id);
  const chapter = WIKI_CHAPTERS.find((c) => c.id === chapterId) ?? WIKI_CHAPTERS[0];

  function Tab({ c, compact = false }: { c: WikiChapter; compact?: boolean }) {
    const active = c.id === chapter.id;
    return (
      <button
        type="button"
        role="tab"
        aria-selected={active}
        onClick={() => setChapterId(c.id)}
        className={`flex items-center gap-1.5 rounded border-2 text-left font-bold leading-tight ${
          compact ? "px-1.5 py-1 text-[10px]" : "shrink-0 px-2 py-1.5 text-[11px]"
        } ${
          active
            ? "border-[var(--rf-ink)] bg-[var(--rf-gold)] text-[var(--rf-ink)]"
            : "border-transparent text-[var(--rf-ink-soft)] hover:border-[var(--rf-ink)] hover:bg-[var(--rf-cream)]"
        }`}
      >
        <span aria-hidden>{c.icon}</span>
        <span className="min-w-0">{c.title}</span>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Guidebook">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      {/* Phone: a CONTAINED sheet (inset on every side — never pinned to the
          viewport top, nothing can clip off the right edge). Desktop: the
          same centered game window as before. */}
      <div className="ui-frame absolute inset-x-2 bottom-20 top-16 flex flex-col bg-[var(--rf-cream)] p-0 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[82vh] sm:w-[min(94vw,46rem)] sm:-translate-x-1/2 sm:-translate-y-1/2">
        <div
          className="flex items-center justify-between px-4 py-2"
          style={{ borderBottom: "2px solid var(--rf-ink)" }}
        >
          <h2 className="pixel-heading text-base">📖 Guidebook</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the guidebook"
            className="rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-2 py-0.5 text-xs font-extrabold hover:bg-[var(--rf-gold)]"
          >
            ✕
          </button>
        </div>

        {/* Phone: chapter chips WRAP inside the sheet (own scroll area if
            tall) — nothing scrolls off the right edge. */}
        <div
          role="tablist"
          aria-label="Chapters"
          className="flex max-h-36 shrink-0 flex-wrap gap-1 overflow-y-auto px-2 py-1.5 sm:hidden"
          style={{ borderBottom: "2px solid var(--rf-ink)" }}
        >
          {WIKI_CHAPTERS.map((c) => (
            <Tab key={c.id} c={c} compact />
          ))}
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Desktop: chapter tabs down the side */}
          <div
            role="tablist"
            aria-label="Chapters"
            className="hidden w-44 shrink-0 flex-col gap-0.5 overflow-y-auto p-2 sm:flex"
            style={{ borderRight: "2px solid var(--rf-ink)" }}
          >
            {WIKI_CHAPTERS.map((c) => (
              <Tab key={c.id} c={c} />
            ))}
          </div>

          {/* Chapter content */}
          <div className="min-w-0 flex-1 overflow-y-auto p-4">
            <h3 className="pixel-heading mb-2 text-lg">
              <span aria-hidden>{chapter.icon}</span> {chapter.title}
            </h3>
            {chapter.sections.map((s, i) => (
              <div key={i} className="mb-3">
                {s.heading && (
                  <h4 className="mb-1 text-[11px] font-extrabold uppercase tracking-wide text-[var(--rf-ink-soft)]">
                    {s.heading}
                  </h4>
                )}
                {s.body?.map((p, j) => (
                  <p key={j} className="mb-1.5 text-sm leading-relaxed">
                    {p}
                  </p>
                ))}
                {s.bullets && (
                  <ul className="ml-4 list-disc space-y-1 text-sm leading-relaxed">
                    {s.bullets.map((b, j) => (
                      <li key={j}>{b}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            {chapter.id === "report-bug" && <BugReportForm />}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Placeholder bug-report form. Not wired to anything yet — a future pass will
 * send these to BUG_REPORT_EMAIL once an email backend exists. Kept as a
 * separate component so wiring it later touches only this spot.
 */
function BugReportForm() {
  const [note, setNote] = useState<string | null>(null);

  const fieldCls =
    "w-full rounded border-2 border-[var(--rf-ink)] bg-white/70 px-2 py-1.5 text-sm";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setNote("Coming soon! Bug reports aren't connected yet — thank you for the thought. 🌱");
      }}
      className="mt-1 flex max-w-md flex-col gap-2"
    >
      <label className="text-xs font-bold">
        What happened?
        <textarea rows={3} className={`${fieldCls} mt-1`} placeholder="The goose did a somersault…" />
      </label>
      <label className="text-xs font-bold">
        What were you trying to do?
        <textarea rows={2} className={`${fieldCls} mt-1`} placeholder="I was watering my plants…" />
      </label>
      <label className="text-xs font-bold">
        Contact info (optional)
        <input type="text" className={`${fieldCls} mt-1`} placeholder="So we can follow up" />
      </label>
      <button type="submit" className="pixel-btn pixel-btn--secondary self-start text-xs">
        Send Bug Report
      </button>
      <p className="text-[11px] text-[var(--rf-ink-soft)]">
        Bug reports are not connected yet. Future reports will be sent to {BUG_REPORT_EMAIL}.
      </p>
      {note && (
        <p role="status" className="rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-2 py-1 text-xs font-bold">
          {note}
        </p>
      )}
    </form>
  );
}
