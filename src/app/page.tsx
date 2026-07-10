import { redirect } from "next/navigation";
import { Container } from "@/components/pixel/ui";
import { PixelLink, Panel } from "@/components/pixel/ui";
import { FarmScene } from "@/components/pixel/FarmScene";
import { BulletinBoard } from "@/components/pixel/BulletinBoard";
import { Fruit } from "@/components/pixel/Sprite";
import { createClient } from "@/lib/supabase/server";

const steps = [
  { n: "1", t: "Attend a meeting", d: "Join your recovery meeting on WhatsApp, Signal, or Google Meet — wherever your group already meets." },
  { n: "2", t: "Enter the code", d: "The host reads a 4-digit code aloud. Type it in to check in." },
  { n: "3", t: "Earn Water & Seeds", d: "Showing up earns Water, Seeds, and Fertilizer — the things that make your trees grow." },
  { n: "4", t: "Harvest Fruits", d: "Grown trees bear fruit. Harvest them for Fruits — your score — and cheer each other on." },
];

/**
 * Public landing page. Logged-in farmers never see it — they're sent straight
 * to their farm. (/dashboard is the only redirect target and it never sends
 * anyone back here, so there's no loop; unauthenticated visitors to
 * /dashboard go to /login.)
 */
export default async function LandingPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) redirect("/dashboard");

  return (
    <Container>
      <section className="grid items-center gap-8 md:grid-cols-2">
        <div>
          <h1 className="pixel-heading text-4xl text-[var(--rf-ink)] sm:text-5xl">
            RecoverTree
          </h1>
          <p className="mt-4 max-w-md text-sm leading-6 text-[var(--rf-ink-soft)]">
            A tiny, nostalgic pixel farm for a recovery community. No chat, no
            meetings here — just a cute companion that celebrates showing up.
            Attend meetings, grow <span className="font-bold">Trees</span>,
            harvest <span className="font-bold">Fruits</span>, and cheer each
            other on.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <PixelLink href="/signup">Start your farm</PixelLink>
            <PixelLink href="/login" variant="secondary">
              Log in
            </PixelLink>
          </div>
        </div>
        {/* decorative preview: a sapling, a growing bush, and one bearing fruit */}
        <FarmScene trees={[{ stage: 1 }, { stage: 3 }, { stage: 5 }]} />
      </section>

      <section className="mt-12">
        <h2 className="pixel-heading mb-4 text-2xl text-[var(--rf-ink)]">
          How it works
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s) => (
            <Panel key={s.n}>
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full border-[3px] border-[var(--rf-ink)] bg-[var(--rf-gold)] text-sm font-extrabold">
                  {s.n}
                </span>
                <h3 className="text-sm font-extrabold uppercase tracking-wide">
                  {s.t}
                </h3>
              </div>
              <p className="mt-2 text-xs leading-5 text-[var(--rf-ink-soft)]">
                {s.d}
              </p>
            </Panel>
          ))}
        </div>
      </section>

      <BulletinBoard />

      <section className="mt-12">
        <Panel className="flex flex-wrap items-center justify-between gap-4">
          <p className="flex items-center gap-2 text-sm font-bold">
            <Fruit scale={2} /> Your orchard is waiting — come back whenever you’re ready.
          </p>
          <PixelLink href="/signup" variant="blue">
            Start growing
          </PixelLink>
        </Panel>
      </section>
    </Container>
  );
}
