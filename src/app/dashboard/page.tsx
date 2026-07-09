import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getOwnProfile, VISIBILITY_OPTIONS } from "@/lib/profile";
import { Container, Panel, PageHeader, PixelLink, StatChip } from "@/components/pixel/ui";
import { FarmPanel } from "@/components/pixel/FarmPanel";
import { SeedPanel } from "@/components/pixel/SeedPanel";
import { Sprite, Fruit } from "@/components/pixel/Sprite";
import { FertilizerBag } from "@/components/pixel/placeholders";
import { avatarSprite } from "@/lib/sprites";

type FarmSummary = {
  season_id: string;
  season_name: string;
  farm_id: string;
  fruit_total: number;
  fertilizer_count: number;
  water_count: number;
  seed_count: number;
  tree_count: number;
};

type LeaderboardPreviewRow = {
  rank: number;
  username: string | null;
  display_name: string | null;
  fruit_total: number;
  visibility: "public" | "anonymous" | "hidden";
  is_self: boolean;
};

type ChecklistItem = {
  key: string;
  name: string;
  description: string | null;
  progress: number;
  target: number;
  completed: boolean;
  water_reward: number;
  fertilizer_reward: number;
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const profile = await getOwnProfile(supabase, user.id);
  if (!profile) redirect("/setup-profile");

  // Server-side bootstrap: closes a finished Season, creates the current
  // month's Season if needed, and guarantees this user's farm + starter tree.
  const { data: farmRows, error: farmError } = await supabase.rpc("ensure_my_farm");
  const farm = ((farmRows ?? []) as FarmSummary[])[0] ?? null;

  // This user's trees: growth stage + the 4-hour fruit timer if running.
  const { data: treeRows } = farm
    ? await supabase
        .from("trees")
        .select("growth_stage, fruits_ready_at, status")
        .eq("farm_id", farm.farm_id)
        .neq("status", "vanished")
        .order("created_at")
    : { data: [] };
  const trees = (treeRows ?? []).map((t) => ({
    stage: t.growth_stage as number,
    readyAt: t.fruits_ready_at as string | null,
  }));

  // Members you can Seed: public profiles other than yourself (RLS already
  // hides anonymous/hidden farmers from this query).
  const { data: memberRows } = await supabase
    .from("profiles")
    .select("user_id, username, display_name")
    .neq("user_id", user.id)
    .order("username");
  const members = memberRows ?? [];

  // Has today's Seed been used? (given_on_date is a UTC date in the DB.)
  const today = new Date().toISOString().slice(0, 10);
  const { data: todaySeed } = await supabase
    .from("seed_events")
    .select("receiver_user_id")
    .eq("giver_user_id", user.id)
    .eq("given_on_date", today)
    .maybeSingle();
  let sentToName: string | null = null;
  if (todaySeed) {
    const { data: receiverProfile } = await supabase
      .from("profiles")
      .select("username")
      .eq("user_id", todaySeed.receiver_user_id)
      .maybeSingle();
    sentToName = receiverProfile?.username ?? null;
  }

  // Leaderboard preview (top few). Private Mode enforced in get_leaderboard.
  const { data: lbRows } = await supabase.rpc("get_leaderboard");
  const leaderboard = ((lbRows ?? []) as LeaderboardPreviewRow[]).slice(0, 5);

  // Monthly checklist (recompute/award happens in ensure_my_farm above).
  const { data: checklistRows } = await supabase.rpc("get_my_checklist");
  const checklist = (checklistRows ?? []) as ChecklistItem[];
  const checklistDone = checklist.filter((c) => c.completed).length;

  const greetName = profile.display_name || profile.username;
  const visibility = VISIBILITY_OPTIONS.find(
    (v) => v.value === profile.leaderboard_visibility,
  );

  return (
    <Container>
      <div className="mb-2 flex items-center gap-3">
        <Sprite src={avatarSprite(profile.avatar_config)} size={[16, 16]} scale={4} alt="your farmer" />
        <PageHeader
          title={`Howdy, ${greetName}!`}
          subtitle="Attend meetings to earn Fruits — your farmer waters a tree and it grows toward bearing fruit."
        />
      </div>

      {farmError && (
        <Panel className="mb-4">
          <p className="text-sm font-bold text-[var(--rf-red)]">
            Couldn’t load your farm just now — try refreshing the page.
          </p>
        </Panel>
      )}

      <div className="mb-4 flex flex-wrap gap-3">
        <StatChip label="Season" value={farm?.season_name ?? "—"} />
        <StatChip label="Water" value={farm?.water_count ?? 0} icon={<span aria-hidden>💧</span>} />
        <StatChip
          label="Fruits this Season"
          value={farm?.fruit_total ?? 0}
          icon={<Fruit scale={2} />}
        />
        <StatChip
          label="Fertilizer"
          value={farm?.fertilizer_count ?? 0}
          icon={<FertilizerBag size={22} />}
        />
        <StatChip label="Trees" value={farm?.tree_count ?? trees.length} />
        <StatChip label="Seeds to plant" value={farm?.seed_count ?? 0} icon={<span aria-hidden>🌱</span>} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div>
          <FarmPanel
            trees={trees.length ? trees : [{ stage: 1, readyAt: null }]}
            water={farm?.water_count ?? 0}
            seeds={farm?.seed_count ?? 0}
            fertilizer={farm?.fertilizer_count ?? 0}
            fruitTotal={farm?.fruit_total ?? 0}
          />
          <div className="mt-3 flex flex-wrap gap-3">
            <PixelLink href="/meeting-code">Enter meeting code</PixelLink>
          </div>
        </div>

        <div className="space-y-6">
          <SeedPanel
            members={members}
            sentToday={Boolean(todaySeed)}
            sentToName={sentToName}
          />

          <Panel>
            <h2 className="pixel-heading mb-3 text-lg">Your profile</h2>
            <p className="text-sm">
              <Link href={`/profile/${profile.username}`} className="font-bold underline">
                @{profile.username}
              </Link>
            </p>
            {profile.display_name && (
              <p className="text-xs text-[var(--rf-ink-soft)]">“{profile.display_name}”</p>
            )}
            <p className="mt-2 text-xs">
              Visibility:{" "}
              <span className="rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-gold)] px-1.5 py-0.5 font-extrabold uppercase">
                {visibility?.label}
              </span>
            </p>
            <p className="mt-1 text-[11px] text-[var(--rf-ink-soft)]">{visibility?.description}</p>
            <Link href="/settings" className="pixel-btn pixel-btn--secondary mt-3 text-xs">
              Edit profile
            </Link>
          </Panel>

          <Panel>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="pixel-heading text-lg">Leaderboard</h2>
              <Link href="/leaderboard" className="text-[11px] font-bold underline">
                See all
              </Link>
            </div>
            {leaderboard.length === 0 ? (
              <p className="text-xs text-[var(--rf-ink-soft)]">
                No Fruits yet this Season — be the first to grow some! 🌱
              </p>
            ) : (
              <ul className="space-y-1.5">
                {leaderboard.map((r, i) => {
                  const anon = r.visibility === "anonymous";
                  const name = anon
                    ? "Anonymous Farmer"
                    : r.display_name || (r.username ? `@${r.username}` : "Farmer");
                  return (
                    <li
                      key={`${r.rank}-${i}`}
                      className="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm"
                      style={{ background: r.is_self ? "rgba(242,193,78,0.35)" : "transparent" }}
                    >
                      <span className="flex items-center gap-2 truncate">
                        <span className="w-5 font-extrabold">{r.rank}</span>
                        {r.visibility === "public" && r.username ? (
                          <Link href={`/profile/${r.username}`} className="truncate font-bold underline">
                            {name}
                          </Link>
                        ) : (
                          <span className="truncate font-bold">{name}</span>
                        )}
                        {r.is_self && (
                          <span className="rounded border border-[var(--rf-ink)] bg-[var(--rf-gold)] px-1 text-[9px] font-extrabold uppercase">
                            you
                          </span>
                        )}
                      </span>
                      <span className="flex shrink-0 items-center gap-1 font-bold">
                        <Fruit scale={1} /> {r.fruit_total}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="pixel-heading text-lg">Monthly checklist</h2>
              <span className="text-[11px] font-bold text-[var(--rf-ink-soft)]">
                {checklistDone}/{checklist.length} done
              </span>
            </div>
            <ul className="space-y-2.5">
              {checklist.map((c) => {
                const pct = Math.min(100, Math.round((c.progress / c.target) * 100));
                return (
                  <li key={c.key}>
                    <div className="flex items-center gap-2 text-sm">
                      <span
                        className="flex h-5 w-5 shrink-0 items-center justify-center border-2 border-[var(--rf-ink)] text-xs"
                        style={{ background: c.completed ? "var(--rf-grass)" : "var(--rf-cream)" }}
                      >
                        {c.completed ? "✓" : ""}
                      </span>
                      <span className={`flex-1 ${c.completed ? "line-through opacity-70" : ""}`}>
                        {c.name}
                      </span>
                      <span className="flex shrink-0 items-center gap-1 text-[11px] font-bold text-[var(--rf-ink-soft)]">
                        💧{c.water_reward}
                        {c.fertilizer_reward > 0 && <span>✨{c.fertilizer_reward}</span>}
                      </span>
                    </div>
                    {c.target > 1 && (
                      <div className="mt-1 ml-7 flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)]">
                          <div
                            className="h-full"
                            style={{ width: `${pct}%`, background: "var(--rf-gold)" }}
                          />
                        </div>
                        <span className="text-[10px] font-bold text-[var(--rf-ink-soft)]">
                          {Math.min(c.progress, c.target)}/{c.target}
                        </span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-[11px] text-[var(--rf-ink-soft)]">
              Complete a goal to earn 💧 water + ✨ fertilizer — automatically.
              Goals reshuffle each month. 🌱
            </p>
          </Panel>
        </div>
      </div>
    </Container>
  );
}
