"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/pixel/ui";
import { createBulletinPost, deleteBulletinPost } from "@/app/admin/actions";
import {
  BULLETIN_CATEGORIES,
  CATEGORY_LABEL,
  CATEGORY_STYLE,
  SPRITE_CATALOG,
  type AdminBulletinPost,
  type BulletinCategory,
} from "@/lib/bulletin";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

/**
 * Admin → Bulletin. Create, schedule, and remove the homepage notice-board
 * posts. Scheduling is just a future `publish_at`: RLS hides unpublished
 * posts from the public homepage until their moment arrives.
 */
export function BulletinAdmin({ posts }: { posts: AdminBulletinPost[] }) {
  return (
    <div className="grid gap-4">
      <NewPostForm />
      <section>
        <h3 className="pixel-heading mb-2 text-base">Posts</h3>
        <div className="grid gap-2">
          {posts.map((p) => (
            <PostRow key={p.id} post={p} />
          ))}
          {posts.length === 0 && (
            <p className="text-sm text-[var(--rf-ink-soft)]">No posts yet — write the first one.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function NewPostForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<BulletinCategory>("announcement");
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [publishAt, setPublishAt] = useState(""); // datetime-local; blank = now
  const [msg, setMsg] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const field =
    "w-full rounded border-2 border-[var(--rf-ink)] bg-white/80 px-2 py-1.5 text-sm";

  function submit() {
    setMsg(null);
    if (!title.trim() || !body.trim()) {
      setMsg("A title and a body are required.");
      return;
    }
    startTransition(async () => {
      const r = await createBulletinPost({
        title: title.trim(),
        body: body.trim(),
        category,
        imageSrc,
        // datetime-local has no timezone — treat it as local time
        publishAt: publishAt ? new Date(publishAt).toISOString() : null,
      });
      if (!r.ok) {
        setMsg(r.message);
        return;
      }
      setTitle("");
      setBody("");
      setImageSrc(null);
      setPublishAt("");
      setMsg("Posted! It’s on the homepage (or scheduled).");
      router.refresh();
    });
  }

  return (
    <Panel className="!p-3">
      <h3 className="pixel-heading mb-2 text-base">New post</h3>
      <div className="grid gap-2">
        <label className="text-xs font-bold">
          Title
          <input className={`${field} mt-1`} value={title} disabled={pending} maxLength={120}
            onChange={(e) => setTitle(e.target.value)} placeholder="Cherry blossoms are here" />
        </label>
        <label className="text-xs font-bold">
          Body
          <textarea className={`${field} mt-1`} rows={3} value={body} disabled={pending} maxLength={1000}
            onChange={(e) => setBody(e.target.value)} placeholder="A short, warm note for the community…" />
        </label>

        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-bold">
            Type
            <select className={`${field} mt-1`} value={category} disabled={pending}
              onChange={(e) => setCategory(e.target.value as BulletinCategory)}>
              {BULLETIN_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_STYLE[c].label} {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-bold">
            Publish at <span className="font-normal text-[var(--rf-ink-soft)]">(blank = now)</span>
            <input type="datetime-local" className={`${field} mt-1`} value={publishAt} disabled={pending}
              onChange={(e) => setPublishAt(e.target.value)} />
          </label>

          <div className="text-xs font-bold">
            Image
            <div className="mt-1 flex items-center gap-2">
              {imageSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageSrc} alt="" className="pixelated h-9 w-9 rounded border-2 border-[var(--rf-ink)] bg-white object-contain" />
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded border-2 border-dashed border-[var(--rf-ink)] text-[10px] text-[var(--rf-ink-soft)]">
                  none
                </span>
              )}
              <button type="button" disabled={pending} onClick={() => setPickerOpen((o) => !o)}
                className="pixel-btn pixel-btn--secondary text-[11px]">
                {pickerOpen ? "Close" : "Choose"}
              </button>
              {imageSrc && (
                <button type="button" disabled={pending} onClick={() => setImageSrc(null)}
                  className="pixel-btn pixel-btn--secondary text-[11px]">
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>

        {pickerOpen && (
          <SpritePicker
            selected={imageSrc}
            onPick={(src) => {
              setImageSrc(src);
              setPickerOpen(false);
            }}
          />
        )}

        <div className="flex items-center gap-2">
          <button type="button" onClick={submit} disabled={pending} className="pixel-btn text-xs disabled:opacity-50">
            {pending ? "Posting…" : "Add post"}
          </button>
          {msg && (
            <p role="status" className="rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-2 py-1 text-[11px] font-bold">
              {msg}
            </p>
          )}
        </div>
      </div>
    </Panel>
  );
}

/** Game art only — characters, trees, fruit, farm/nature. No UI assets. */
function SpritePicker({
  selected,
  onPick,
}: {
  selected: string | null;
  onPick: (src: string) => void;
}) {
  return (
    <div className="rounded border-2 border-[var(--rf-ink)] bg-white/60 p-2">
      <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[var(--rf-ink-soft)]">
        Game sprites (UI assets aren’t offered)
      </p>
      <div className="max-h-56 overflow-y-auto">
        {SPRITE_CATALOG.map((g) => (
          <div key={g.group} className="mb-2">
            <p className="mb-1 text-[10px] font-extrabold uppercase tracking-wide">{g.group}</p>
            <div className="flex flex-wrap gap-1.5">
              {g.sprites.map((s) => (
                <button
                  key={s.src}
                  type="button"
                  title={s.label}
                  aria-label={s.label}
                  aria-pressed={selected === s.src}
                  onClick={() => onPick(s.src)}
                  className={`flex h-11 w-11 items-center justify-center rounded border-2 bg-white p-0.5 hover:bg-[var(--rf-gold)] ${
                    selected === s.src ? "border-[var(--rf-gold)] ring-2 ring-[var(--rf-gold)]" : "border-[var(--rf-ink)]"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.src} alt="" className="pixelated max-h-full max-w-full object-contain" />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PostRow({ post }: { post: AdminBulletinPost }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const style = CATEGORY_STYLE[post.category] ?? CATEGORY_STYLE.update;

  function remove() {
    setErr(null);
    startTransition(async () => {
      const r = await deleteBulletinPost(post.id);
      if (!r.ok) setErr(r.message);
      else router.refresh();
      setConfirming(false);
    });
  }

  return (
    <Panel className="!p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          {post.image_src && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={post.image_src} alt="" className="pixelated h-9 w-9 shrink-0 object-contain" />
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded border-2 border-[var(--rf-ink)] px-1.5 py-0.5 text-[9px] font-extrabold uppercase"
                style={{ background: style.pin }}>
                {style.label} {CATEGORY_LABEL[post.category] ?? post.category}
              </span>
              {post.is_published ? (
                <span className="text-[10px] font-bold text-[var(--rf-ink-soft)]">live · {fmt(post.publish_at)}</span>
              ) : (
                <span className="rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-gold)] px-1.5 py-0.5 text-[9px] font-extrabold uppercase">
                  ⏳ scheduled · {fmt(post.publish_at)}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm font-extrabold">{post.title}</p>
            <p className="text-[11px] text-[var(--rf-ink-soft)]">{post.body}</p>
          </div>
        </div>

        {confirming ? (
          <span className="flex shrink-0 items-center gap-1.5">
            <span className="text-[11px] font-bold">Delete this post?</span>
            <button type="button" disabled={pending} onClick={remove} className="pixel-btn text-[11px]"
              style={{ background: "var(--rf-red)", color: "var(--rf-cream)" }}>
              Yes, delete
            </button>
            <button type="button" disabled={pending} onClick={() => setConfirming(false)}
              className="pixel-btn pixel-btn--secondary text-[11px]">
              Keep
            </button>
          </span>
        ) : (
          <button type="button" disabled={pending} onClick={() => setConfirming(true)}
            className="pixel-btn pixel-btn--secondary shrink-0 text-[11px]">
            Remove
          </button>
        )}
      </div>
      {err && (
        <p role="alert" className="mt-2 rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-red)] px-2 py-1 text-[11px] font-bold text-[var(--rf-cream)]">
          {err}
        </p>
      )}
    </Panel>
  );
}
