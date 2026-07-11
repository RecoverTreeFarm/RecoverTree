"use client";

import { useEffect, useState } from "react";
import { WIKI_CHAPTERS, SUPPORT_EMAIL, FEEDBACK_TYPES, type WikiChapter } from "@/lib/wiki";
import { submitFeedback } from "@/app/feedback/actions";
import { openWiki, closeWiki, subscribeWiki } from "@/lib/wikiController";
import { requestTutorialReplay } from "@/lib/tutorialController";

/**
 * The in-game guidebook. `WikiHelp` is the little "?" button in the farm HUD;
 * tapping it opens the guide. A feature-guide popup can also open it straight
 * to a specific chapter. Only ONE panel is mounted (`WikiRoot`, in GameShell);
 * every "?" button and every deep link routes through wikiController. Content
 * lives in src/lib/wiki.ts.
 */
export function WikiHelp() {
  return (
    <button
      type="button"
      aria-label="Open the guidebook"
      onClick={() => openWiki()}
      className="flex h-10 w-10 items-center justify-center rounded-full border-2 text-sm font-bold"
      style={{
        borderColor: "var(--rf-ink)",
        background: "var(--rf-cream)",
        color: "var(--rf-ink-soft)",
        opacity: 0.6,
      }}
    >
      ?
    </button>
  );
}

/**
 * The single Guidebook panel. Mounted once; listens for open/deep-link/close
 * requests. `canReplayTutorial` shows a "Replay Tutorial" button (only offered
 * once the required tutorial is done).
 */
export function WikiRoot({ canReplayTutorial }: { canReplayTutorial: boolean }) {
  const [chapterId, setChapterId] = useState<string | null>(null);

  useEffect(() => {
    return subscribeWiki((id) => setChapterId(id));
  }, []);

  if (chapterId === null) return null;
  return (
    <WikiPanel
      initialChapterId={chapterId}
      canReplayTutorial={canReplayTutorial}
      onClose={() => closeWiki()}
    />
  );
}

function WikiPanel({
  initialChapterId,
  canReplayTutorial,
  onClose,
}: {
  initialChapterId: string;
  canReplayTutorial: boolean;
  onClose: () => void;
}) {
  const known = WIKI_CHAPTERS.some((c) => c.id === initialChapterId);
  const [chapterId, setChapterId] = useState(known ? initialChapterId : WIKI_CHAPTERS[0].id);
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
      {/* A CONTAINED sheet (inset on every side — never pinned to the
          viewport top, nothing can clip off the right edge). Capped at the
          phone game-frame width on every screen size, so the guidebook stays
          inside the centered game viewport on desktop too. */}
      <div className="ui-frame absolute inset-x-0 bottom-20 top-16 mx-auto flex w-[calc(100%-16px)] max-w-[calc(var(--game-w)-16px)] flex-col bg-[var(--rf-cream)] p-0">
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

        {/* Chapter chips WRAP inside the sheet (own scroll area if tall) —
            the panel is phone-width everywhere now, so the one chip row
            replaces the old desktop sidebar. */}
        <div
          role="tablist"
          aria-label="Chapters"
          className="flex max-h-36 shrink-0 flex-wrap gap-1 overflow-y-auto px-2 py-1.5"
          style={{ borderBottom: "2px solid var(--rf-ink)" }}
        >
          {WIKI_CHAPTERS.map((c) => (
            <Tab key={c.id} c={c} compact />
          ))}
        </div>

        <div className="flex min-h-0 flex-1">
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
                {s.sprites && (
                  <div className="mt-2 flex flex-wrap items-end gap-3 rounded border-2 border-dashed border-[var(--rf-ink)]/25 bg-[var(--rf-cream)] p-2">
                    {s.sprites.map((sp, j) => (
                      <figure key={j} className="flex flex-col items-center gap-1">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={sp.src}
                          alt={sp.label}
                          className="pixelated"
                          style={{ height: sp.height ?? 40, width: "auto" }}
                        />
                        <figcaption className="text-[9px] font-bold uppercase tracking-tight text-[var(--rf-ink-soft)]">
                          {sp.label}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {chapter.id === "quick-start" && canReplayTutorial && (
              <div className="mt-4 border-t-2 border-dashed border-[var(--rf-ink)]/30 pt-3">
                <p className="mb-2 text-xs text-[var(--rf-ink-soft)]">
                  Want a refresher? Replay the hands-on beginner tutorial anytime — it won’t grant supplies again.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    closeWiki();
                    requestTutorialReplay();
                  }}
                  className="pixel-btn pixel-btn--secondary text-xs"
                >
                  ↻ Replay Tutorial
                </button>
              </div>
            )}
            {chapter.id === "report-bug" && <FeedbackForm />}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Leave Feedback — the real thing. The feedback type IS the subject; the
 * server action saves to feedback_reports (validated + rate-limited in the
 * database) and best-effort emails SUPPORT_EMAIL via Resend.
 */
function FeedbackForm() {
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const fieldCls =
    "w-full rounded border-2 border-[var(--rf-ink)] bg-white/70 px-2 py-1.5 text-sm";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending || sent) return;
    setSending(true);
    setNote(null);
    const form = e.currentTarget;
    const r = await submitFeedback(new FormData(form));
    setSending(false);
    if (r.ok) {
      setSent(true);
      form.reset();
      setNote({ ok: true, text: "Sent — thank you for helping the orchard grow! 🌱" });
    } else {
      setNote({ ok: false, text: r.message });
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-1 flex max-w-md flex-col gap-2">
      <label className="text-xs font-bold">
        Feedback type
        <select name="type" defaultValue="bug" className={`${fieldCls} mt-1`}>
          {Object.entries(FEEDBACK_TYPES).map(([slug, label]) => (
            <option key={slug} value={slug}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs font-bold">
        Your message
        <textarea
          name="message"
          rows={4}
          required
          maxLength={2000}
          className={`${fieldCls} mt-1`}
          placeholder="Tell us what happened, what you wish existed, or anything else…"
        />
      </label>
      <label className="text-xs font-bold">
        Contact info (optional)
        <input
          type="text"
          name="contact"
          maxLength={200}
          className={`${fieldCls} mt-1`}
          placeholder="So we can follow up"
        />
      </label>
      <button
        type="submit"
        disabled={sending || sent}
        className="pixel-btn pixel-btn--secondary self-start text-xs disabled:opacity-50"
      >
        {sent ? "✅ Feedback sent" : sending ? "Sending…" : "💬 Leave Feedback"}
      </button>
      <p className="text-[11px] text-[var(--rf-ink-soft)]">
        Your note goes to the RecoverTree team at {SUPPORT_EMAIL}.
      </p>
      {note && (
        <p
          role="status"
          className="rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-2 py-1 text-xs font-bold"
          style={note.ok ? undefined : { borderColor: "var(--rf-red)" }}
        >
          {note.text}
        </p>
      )}
    </form>
  );
}
