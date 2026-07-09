"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sprite } from "@/components/pixel/Sprite";
import { HOUSE_SPRITES, HOUSE_KEYS } from "@/lib/sprites";
import { setHouse } from "@/app/dashboard/actions";

export type ProfileInfo = {
  username: string;
  displayName: string | null;
  avatarSrc: string;
  visibilityLabel: string;
  visibilityDescription: string;
};

/**
 * Profile window: who you are + pick your farmhouse (changeable any time,
 * like the avatar). Full settings (name, avatar, visibility) live on the
 * settings page.
 */
export function ProfilePanel({
  profile,
  houseKey,
  houseNames = {},
}: {
  profile: ProfileInfo;
  houseKey: string;
  /** admin-renamable display names (falls back to built-in labels) */
  houseNames?: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [chosen, setChosen] = useState(houseKey);
  const [error, setError] = useState<string | null>(null);

  function choose(key: string) {
    if (pending || key === chosen) return;
    setError(null);
    const prev = chosen;
    setChosen(key); // optimistic — the farm updates on refresh
    startTransition(async () => {
      const r = await setHouse(key);
      if (!r.ok) {
        setChosen(prev);
        setError(r.message);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        <Sprite src={profile.avatarSrc} size={[32, 32]} scale={4} alt="your farmer" />
        <div className="min-w-0">
          <p className="truncate font-bold">
            <Link href={`/profile/${profile.username}`} className="underline">
              @{profile.username}
            </Link>
          </p>
          {profile.displayName && (
            <p className="truncate text-xs text-[var(--rf-ink-soft)]">“{profile.displayName}”</p>
          )}
          <p className="mt-0.5 text-[11px]">
            <span className="rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-gold)] px-1 py-0.5 font-extrabold uppercase">
              {profile.visibilityLabel}
            </span>
          </p>
        </div>
      </div>
      <p className="mt-1 text-[11px] text-[var(--rf-ink-soft)]">
        {profile.visibilityDescription}
      </p>

      {/* House selection */}
      <h3 className="pixel-heading mt-4 text-sm">Your farmhouse</h3>
      <p className="mb-2 text-[11px] text-[var(--rf-ink-soft)]">
        Pick a house for your farm — change it any time.
      </p>
      <div className="grid grid-cols-3 gap-2">
        {HOUSE_KEYS.map((key) => {
          const h = HOUSE_SPRITES[key];
          const name = houseNames[key] ?? h.label;
          const active = chosen === key;
          return (
            <button
              key={key}
              type="button"
              disabled={pending}
              onClick={() => choose(key)}
              title={name}
              aria-pressed={active}
              className={`flex flex-col items-center gap-1 rounded border-[3px] p-2 ${
                active
                  ? "border-[var(--rf-ink)] bg-[var(--rf-gold)]"
                  : "border-[var(--rf-ink)]/30 bg-white hover:border-[var(--rf-ink)]"
              } disabled:opacity-60`}
            >
              <img
                src={h.src}
                alt={name}
                className="pixelated h-14 w-auto max-w-full object-contain"
              />
              <span className="text-[9px] font-extrabold uppercase tracking-wide">
                {name}
              </span>
            </button>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="mt-2 rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-red)] px-2 py-1 text-[11px] font-bold text-[var(--rf-cream)]">
          {error}
        </p>
      )}

      <div className="mt-4 border-t-2 border-dashed border-[var(--rf-ink)]/30 pt-3">
        <Link href="/settings" className="pixel-btn pixel-btn--secondary text-xs">
          Full settings (name, avatar, privacy)
        </Link>
      </div>
    </div>
  );
}
