import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOwnProfile, VISIBILITY_OPTIONS } from "@/lib/profile";
import { Container, Panel, PageHeader } from "@/components/pixel/ui";
import { Sprite } from "@/components/pixel/Sprite";
import { AVATAR_KEYS, AVATAR_SPRITES } from "@/lib/sprites";
import { createProfile } from "./actions";

const inputClass =
  "w-full border-[3px] border-[var(--rf-ink)] bg-white px-3 py-2 text-sm font-mono rounded";

export default async function SetupProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Already set up? Off to the farm.
  const profile = await getOwnProfile(supabase, user.id);
  if (profile) redirect("/dashboard");

  const { error } = await searchParams;

  return (
    <Container className="flex flex-col items-center">
      <PageHeader
        title="Name your farmer"
        subtitle="One last step — pick a username so friends can find your farm. You get a farm and your first tree right away."
        route="/setup-profile"
      />

      <Panel className="w-full max-w-lg">
        <form action={createProfile} className="space-y-5">
          <div>
            <label htmlFor="username" className="mb-1 block text-xs font-bold uppercase tracking-wide">
              Username <span className="text-[var(--rf-red)]">*</span>
            </label>
            <input
              id="username"
              name="username"
              required
              minLength={3}
              maxLength={20}
              pattern="[A-Za-z0-9_]{3,20}"
              title="3–20 characters: letters, numbers, and _ only"
              className={inputClass}
              placeholder="sunny_fields"
            />
            <p className="mt-1 text-[11px] text-[var(--rf-ink-soft)]">
              3–20 characters. Letters, numbers, and _ only. This is public (unless you go anonymous or hidden).
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
              className={inputClass}
              placeholder="Sunny"
            />
          </div>

          <fieldset>
            <legend className="mb-2 text-xs font-bold uppercase tracking-wide">
              Pick your farmer
            </legend>
            <div className="flex flex-wrap gap-2">
              {AVATAR_KEYS.map((key, i) => (
                <label
                  key={key}
                  className="cursor-pointer rounded border-[3px] border-[var(--rf-ink)] bg-white p-1.5 has-checked:bg-[var(--rf-gold)]"
                >
                  <input
                    type="radio"
                    name="avatar"
                    value={key}
                    defaultChecked={i === 0}
                    className="sr-only"
                  />
                  <Sprite src={AVATAR_SPRITES[key]} size={[32, 32]} scale={3} alt={key} />
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-xs font-bold uppercase tracking-wide">
              Leaderboard visibility
            </legend>
            <div className="space-y-2">
              {VISIBILITY_OPTIONS.map((opt, i) => (
                <label
                  key={opt.value}
                  className="flex cursor-pointer items-start gap-3 rounded border-[3px] border-[var(--rf-ink)] bg-white p-3 has-checked:bg-[var(--rf-gold)]"
                >
                  <input
                    type="radio"
                    name="visibility"
                    value={opt.value}
                    defaultChecked={i === 0}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-sm font-extrabold uppercase">{opt.label}</span>
                    <span className="block text-xs text-[var(--rf-ink-soft)]">{opt.description}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-[var(--rf-ink-soft)]">
              You can change this any time in Settings.
            </p>
          </fieldset>

          {error && (
            <p
              role="alert"
              className="rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-red)] px-3 py-2 text-xs font-bold text-[var(--rf-cream)]"
            >
              {error}
            </p>
          )}

          <button type="submit" className="pixel-btn w-full">
            Start farming
          </button>
        </form>
      </Panel>
    </Container>
  );
}
