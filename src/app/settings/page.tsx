import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getOwnProfile, VISIBILITY_OPTIONS } from "@/lib/profile";
import { Container, Panel, PageHeader } from "@/components/pixel/ui";
import { Sprite } from "@/components/pixel/Sprite";
import { AVATAR_KEYS, AVATAR_SPRITES } from "@/lib/sprites";
import { updateProfile } from "./actions";

const inputClass =
  "w-full border-[3px] border-[var(--rf-ink)] bg-white px-3 py-2 text-sm font-mono rounded";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const profile = await getOwnProfile(supabase, user.id);
  if (!profile) redirect("/setup-profile");

  const { error, saved } = await searchParams;
  const currentSprite = profile.avatar_config?.sprite ?? "worker_1";

  return (
    <Container className="flex flex-col items-center">
      <PageHeader
        title="Settings"
        subtitle="Tend to your farmer. Username can’t be changed."
        route="/settings"
      />

      <Panel className="w-full max-w-lg">
        <form action={updateProfile} className="space-y-5">
          <div>
            <span className="mb-1 block text-xs font-bold uppercase tracking-wide">Username</span>
            <p className="rounded border-[3px] border-dashed border-[var(--rf-ink)]/40 bg-[var(--rf-cream)] px-3 py-2 font-mono text-sm">
              @{profile.username}
            </p>
          </div>

          <div>
            <label htmlFor="display_name" className="mb-1 block text-xs font-bold uppercase tracking-wide">
              Display name <span className="font-normal normal-case">(optional)</span>
            </label>
            <input
              id="display_name"
              name="display_name"
              maxLength={40}
              defaultValue={profile.display_name ?? ""}
              className={inputClass}
              placeholder="Sunny"
            />
          </div>

          <div>
            <label htmlFor="bio" className="mb-1 block text-xs font-bold uppercase tracking-wide">
              Bio <span className="font-normal normal-case">(optional)</span>
            </label>
            <textarea
              id="bio"
              name="bio"
              maxLength={200}
              rows={2}
              defaultValue={profile.bio ?? ""}
              className={inputClass}
              placeholder="Just here growing my little orchard."
            />
          </div>

          <fieldset>
            <legend className="mb-2 text-xs font-bold uppercase tracking-wide">Your farmer</legend>
            <div className="flex flex-wrap gap-2">
              {AVATAR_KEYS.map((key) => (
                <label
                  key={key}
                  className="cursor-pointer rounded border-[3px] border-[var(--rf-ink)] bg-white p-1.5 has-checked:bg-[var(--rf-gold)]"
                >
                  <input
                    type="radio"
                    name="avatar"
                    value={key}
                    defaultChecked={key === currentSprite}
                    className="sr-only"
                  />
                  <Sprite src={AVATAR_SPRITES[key]} size={[16, 16]} scale={3} alt={key} />
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-xs font-bold uppercase tracking-wide">
              Leaderboard visibility
            </legend>
            <div className="space-y-2">
              {VISIBILITY_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="flex cursor-pointer items-start gap-3 rounded border-[3px] border-[var(--rf-ink)] bg-white p-3 has-checked:bg-[var(--rf-gold)]"
                >
                  <input
                    type="radio"
                    name="visibility"
                    value={opt.value}
                    defaultChecked={opt.value === profile.leaderboard_visibility}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-sm font-extrabold uppercase">{opt.label}</span>
                    <span className="block text-xs text-[var(--rf-ink-soft)]">{opt.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {error && (
            <p role="alert" className="rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-red)] px-3 py-2 text-xs font-bold text-[var(--rf-cream)]">
              {error}
            </p>
          )}
          {saved && (
            <p role="status" className="rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-grass)] px-3 py-2 text-xs font-bold">
              Saved! Your farm is growing. 🌱
            </p>
          )}

          <div className="flex gap-3">
            <button type="submit" className="pixel-btn flex-1">
              Save changes
            </button>
            <Link href="/dashboard" className="pixel-btn pixel-btn--secondary">
              Back to farm
            </Link>
          </div>
        </form>
      </Panel>
    </Container>
  );
}
