import { createClient } from "@/lib/supabase/server";
import { Container, Panel, PageHeader, PixelLink } from "@/components/pixel/ui";
import { BulletinBoard } from "@/components/pixel/BulletinBoard";

/**
 * News page — the village notice board (bulletin_posts), reachable from the
 * top nav's "News" link. Reuses the same <BulletinBoard /> shown on the public
 * homepage; RLS only ever returns posts whose publish_at has arrived. Logged-in
 * or not, anyone can read the community news.
 */
export default async function NewsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("bulletin_posts")
    .select("id")
    .limit(1);
  const hasPosts = (data ?? []).length > 0;

  return (
    <Container>
      <PageHeader
        title="📰 News"
        subtitle="The village notice board — updates, events, and announcements."
      />
      {hasPosts ? (
        <BulletinBoard />
      ) : (
        <Panel className="text-center">
          <p className="text-sm text-[var(--rf-ink-soft)]">
            No news yet. Check back soon for events and announcements! 🌱
          </p>
        </Panel>
      )}
      <div className="mt-6 text-center">
        <PixelLink href="/dashboard" variant="secondary">
          Return to Farm
        </PixelLink>
      </div>
    </Container>
  );
}
