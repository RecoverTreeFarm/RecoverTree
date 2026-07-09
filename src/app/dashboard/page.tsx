import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOwnProfile, VISIBILITY_OPTIONS } from "@/lib/profile";
import { Container, Panel } from "@/components/pixel/ui";
import { GameShell } from "@/components/game/GameShell";
import type { BasketState } from "@/components/pixel/BasketPanel";
import type { ChecklistItem, LeaderboardRow } from "@/components/game/panels";
import type { GooseState } from "@/lib/goose";
import { avatarSprite, houseKey } from "@/lib/sprites";
import { randomAffirmation } from "@/lib/affirmations";
import { houseDisplayNames, type SettingOverrideRow } from "@/lib/gameSettings";

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

/**
 * The dashboard is a cozy game screen: a tiny greeting, a thin stat strip,
 * the farm as the main canvas, and a fixed bottom menu that opens everything
 * else (items, meeting code, Seed, Basket, goals, leaderboard, profile) in
 * small windows.
 */
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

  // This user's trees. is_blossom arrives with the blossom migration — fall
  // back to base columns if it isn't applied yet so the farm still renders.
  let treeRows: Record<string, unknown>[] | null = null;
  if (farm) {
    const withBlossom = await supabase
      .from("trees")
      .select("growth_stage, fruits_ready_at, status, is_blossom")
      .eq("farm_id", farm.farm_id)
      .neq("status", "vanished")
      .order("created_at");
    if (withBlossom.error) {
      const base = await supabase
        .from("trees")
        .select("growth_stage, fruits_ready_at, status")
        .eq("farm_id", farm.farm_id)
        .neq("status", "vanished")
        .order("created_at");
      treeRows = base.data;
    } else {
      treeRows = withBlossom.data;
    }
  }
  const trees = (treeRows ?? []).map((t) => ({
    stage: t.growth_stage as number,
    readyAt: t.fruits_ready_at as string | null,
    isBlossom: (t.is_blossom as boolean | undefined) ?? false,
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

  // Traveling Basket state (panel is hidden if the migration isn't applied).
  const { data: basketData, error: basketErr } = await supabase.rpc(
    "get_traveling_basket_state",
  );
  const basket = basketErr ? null : ((basketData ?? null) as BasketState | null);

  // Golden Goose state (hidden if the migration isn't applied yet).
  const { data: gooseData, error: gooseErr } = await supabase.rpc("get_golden_goose_state");
  const goose = gooseErr ? null : ((gooseData ?? null) as GooseState | null);

  // Leaderboard preview (top few). Private Mode enforced in get_leaderboard.
  const { data: lbRows } = await supabase.rpc("get_leaderboard");
  const leaderboard = ((lbRows ?? []) as LeaderboardRow[]).slice(0, 8);

  // Monthly checklist (recompute/award happens in ensure_my_farm above).
  const { data: checklistRows } = await supabase.rpc("get_my_checklist");
  const checklist = (checklistRows ?? []) as ChecklistItem[];

  const greetName = profile.display_name || profile.username;
  const visibility = VISIBILITY_OPTIONS.find(
    (v) => v.value === profile.leaderboard_visibility,
  );

  // A fresh affirmation each visit (picked server-side so hydration matches).
  const affirmation = randomAffirmation();

  // Admin-renamable house display names (overrides in game_settings).
  const { data: houseNameRows } = await supabase
    .from("game_settings")
    .select("key, value_json")
    .like("key", "house_name_%");
  const houseNames = houseDisplayNames(
    (houseNameRows ?? []) as Pick<SettingOverrideRow, "key" | "value_json">[],
  );

  return (
    <Container className="max-w-4xl">
      {farmError && (
        <Panel className="mb-4">
          <p className="text-sm font-bold text-[var(--rf-red)]">
            Couldn’t load your farm just now — try refreshing the page.
          </p>
        </Panel>
      )}

      <GameShell
        greetName={greetName}
        affirmation={affirmation}
        houseNames={houseNames}
        avatarSrc={avatarSprite(profile.avatar_config)}
        houseKey={houseKey(profile.avatar_config)}
        trees={trees}
        farm={{
          seasonName: farm?.season_name ?? "—",
          fruitTotal: farm?.fruit_total ?? 0,
          water: farm?.water_count ?? 0,
          seeds: farm?.seed_count ?? 0,
          fertilizer: farm?.fertilizer_count ?? 0,
          treeCount: farm?.tree_count ?? trees.length,
        }}
        members={members}
        sentToday={Boolean(todaySeed)}
        sentToName={sentToName}
        basket={basket}
        goose={goose}
        checklist={checklist}
        leaderboard={leaderboard}
        profile={{
          username: profile.username,
          displayName: profile.display_name,
          avatarSrc: avatarSprite(profile.avatar_config),
          visibilityLabel: visibility?.label ?? "Public",
          visibilityDescription: visibility?.description ?? "",
        }}
      />
    </Container>
  );
}
