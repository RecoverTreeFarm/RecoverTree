import { createClient } from "@/lib/supabase/server";
import { CATEGORY_STYLE, CATEGORY_LABEL, type BulletinPost } from "@/lib/bulletin";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

/**
 * The village notice board on the public homepage: pinned paper notes on a
 * wooden board. Posts come from `bulletin_posts` (Admin → Bulletin); RLS
 * only ever hands out rows whose publish_at has arrived, so scheduled posts
 * simply appear on their own date.
 */
export async function BulletinBoard() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("bulletin_posts")
    .select("id, title, body, category, image_src, publish_at")
    .order("publish_at", { ascending: false })
    .limit(8);
  const posts = (data ?? []) as BulletinPost[];

  if (posts.length === 0) return null;

  return (
    <section className="mt-10">
      <h2 className="pixel-heading mb-4 text-2xl text-[var(--rf-ink)]">📌 Notice board</h2>

      <div
        className="rounded-lg p-3 sm:p-5"
        style={{
          background: "var(--rf-wood)",
          border: "3px solid var(--rf-ink)",
          boxShadow: "inset 0 0 0 3px rgba(58,42,26,0.18), 4px 4px 0 rgba(58,42,26,0.25)",
        }}
      >
        {/* One column always — notices stack, never sit side by side. */}
        <div className="grid gap-3">
          {posts.map((post, i) => {
            const style = CATEGORY_STYLE[post.category] ?? CATEGORY_STYLE.update;
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
                    <span aria-hidden>{style.label}</span>{" "}
                    {CATEGORY_LABEL[post.category] ?? post.category}
                  </span>
                  <time
                    dateTime={post.publish_at}
                    className="text-[10px] font-bold uppercase tracking-wide text-[var(--rf-ink-soft)]"
                  >
                    {fmtDate(post.publish_at)}
                  </time>
                </div>

                <div className="mt-1.5 flex items-start gap-2">
                  {post.image_src && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={post.image_src}
                      alt=""
                      className="pixelated mt-0.5 h-10 w-10 shrink-0 object-contain"
                    />
                  )}
                  <div className="min-w-0">
                    <h3 className="text-sm font-extrabold leading-snug">{post.title}</h3>
                    <p className="mt-1 text-xs leading-5 text-[var(--rf-ink-soft)]">{post.body}</p>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
