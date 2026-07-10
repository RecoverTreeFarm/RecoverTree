import { BULLETIN_POSTS, CATEGORY_STYLE } from "@/lib/bulletin";

const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

/**
 * The village notice board on the public homepage: pinned paper notes on a
 * wooden board. Content is static (src/lib/bulletin.ts) — no CMS.
 */
export function BulletinBoard() {
  return (
    <section className="mt-12">
      <h2 className="pixel-heading mb-4 text-2xl text-[var(--rf-ink)]">
        📌 Notice board
      </h2>

      {/* the wooden board itself */}
      <div
        className="rounded-lg p-3 sm:p-5"
        style={{
          background: "var(--rf-wood)",
          border: "3px solid var(--rf-ink)",
          boxShadow: "inset 0 0 0 3px rgba(58,42,26,0.18), 4px 4px 0 rgba(58,42,26,0.25)",
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {BULLETIN_POSTS.map((post, i) => {
            const style = CATEGORY_STYLE[post.category];
            // a gentle alternating tilt, like notes actually pinned by hand
            const tilt = i % 3 === 0 ? "-0.5deg" : i % 3 === 1 ? "0.6deg" : "-0.2deg";
            return (
              <article
                key={post.id}
                className="relative rounded p-3 pt-5"
                style={{
                  background: "var(--rf-cream)",
                  border: "2px solid var(--rf-ink)",
                  boxShadow: "2px 3px 0 rgba(58,42,26,0.35)",
                  transform: `rotate(${tilt})`,
                }}
              >
                {/* the pin */}
                <span
                  aria-hidden
                  className="absolute left-1/2 top-1.5 h-3 w-3 -translate-x-1/2 rounded-full"
                  style={{ background: style.pin, border: "2px solid var(--rf-ink)" }}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="rounded border-2 border-[var(--rf-ink)] px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide"
                    style={{ background: style.pin, color: "var(--rf-ink)" }}
                  >
                    <span aria-hidden>{style.label}</span> {post.category}
                  </span>
                  <time
                    dateTime={post.date}
                    className="text-[10px] font-bold uppercase tracking-wide text-[var(--rf-ink-soft)]"
                  >
                    {fmtDate(post.date)}
                  </time>
                </div>
                <h3 className="mt-1.5 text-sm font-extrabold leading-snug">{post.title}</h3>
                <p className="mt-1 text-xs leading-5 text-[var(--rf-ink-soft)]">{post.body}</p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
