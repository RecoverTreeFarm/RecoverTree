import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOwnProfile, VISIBILITY_OPTIONS } from "@/lib/profile";
import { Panel } from "@/components/pixel/ui";
import { GameShell } from "@/components/game/GameShell";
import type { BasketState } from "@/components/pixel/BasketPanel";
import type { ChecklistItem, LeaderboardRow } from "@/components/game/panels";
import type { GooseState } from "@/lib/goose";
import type { GardenState } from "@/lib/garden";
import type { StoreState } from "@/lib/store";
import type { LotteryState } from "@/lib/lottery";
import { avatarSprite, houseKey } from "@/lib/sprites";
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

/** Coins live on the same farms row but aren't in ensure_my_farm's summary
 *  (that function predates them) — read the column directly. */
async function fetchCoinCount(
  supabase: Awaited<ReturnType<typeof createClient>>,
  farmId: string,
): Promise<number> {
  const { data } = await supabase
    .from("farms")
    .select("coin_count")
    .eq("id", farmId)
    .maybeSingle();
  return (data?.coin_count as number | undefined) ?? 0;
}

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
  const coins = farm ? await fetchCoinCount(supabase, farm.farm_id) : 0;

  // This user's trees. is_blossom arrives with the blossom migration — fall
  // back to base columns if it isn't applied yet so the farm still renders.
  let treeRows: Record<string, unknown>[] | null = null;
  if (farm) {
    const withBlossom = await supabase
      .from("trees")
      .select("id, growth_stage, fruits_ready_at, status, is_blossom")
      .eq("farm_id", farm.farm_id)
      .neq("status", "vanished")
      .order("created_at");
    if (withBlossom.error) {
      const base = await supabase
        .from("trees")
        .select("id, growth_stage, fruits_ready_at, status")
        .eq("farm_id", farm.farm_id)
        .neq("status", "vanished")
        .order("created_at");
      treeRows = base.data;
    } else {
      treeRows = withBlossom.data;
    }
  }
  const trees = (treeRows ?? []).map((t) => ({
    // the id lets the player act on ONE tree (water/fertilize/harvest it)
    id: t.id as string,
    stage: t.growth_stage as number,
    readyAt: t.fruits_ready_at as string | null,
    isBlossom: (t.is_blossom as boolean | undefined) ?? false,
  }));

  // Season date for the compact chip ("8th of Maypril") + countdown data.
  let seasonDaysLeft: number | null = null;
  let seasonDayOfMonth: number | null = null;
  let seasonCyclePosition: number | null = null;
  if (farm) {
    const { data: seasonRow } = await supabase
      .from("seasons")
      .select("starts_at, ends_at, cycle_position")
      .eq("id", farm.season_id)
      .maybeSingle();
    if (seasonRow?.ends_at) {
      // Server component renders per-request, so "now" is stable per render.
      // eslint-disable-next-line react-hooks/purity
      const now = Date.now();
      seasonDaysLeft = Math.max(
        0,
        Math.ceil((new Date(seasonRow.ends_at as string).getTime() - now) / 86_400_000),
      );
      if (seasonRow.starts_at) {
        seasonDayOfMonth = Math.max(
          1,
          Math.floor((now - new Date(seasonRow.starts_at as string).getTime()) / 86_400_000) + 1,
        );
      }
    }
    seasonCyclePosition = (seasonRow?.cycle_position as number | null) ?? null;
  }

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

  // Community Garden state (hidden if the migration isn't applied yet).
  const { data: gardenData, error: gardenErr } = await supabase.rpc(
    "get_community_garden_state",
  );
  const garden = gardenErr ? null : ((gardenData ?? null) as GardenState | null);

  // General Store state (hidden if the migration isn't applied yet).
  const { data: storeData, error: storeErr } = await supabase.rpc("get_general_store_state");
  const store = storeErr ? null : ((storeData ?? null) as StoreState | null);

  // Weekly Orchard Lottery state (hidden if the migration isn't applied yet).
  const { data: lotteryData, error: lotteryErr } = await supabase.rpc("get_weekly_lottery_state");
  const lottery = lotteryErr ? null : ((lotteryData ?? null) as LotteryState | null);

  // Season-end ceremony invitation (null once dismissed/attended).
  const { data: inviteData, error: inviteErr } = await supabase.rpc("get_ceremony_invite");
  const ceremonyInvite = inviteErr
    ? null
    : ((inviteData ?? null) as { season_id: string; season_name: string } | null);

  // Leaderboard preview (top few). Private Mode enforced in get_leaderboard.
  const { data: lbRows } = await supabase.rpc("get_leaderboard");
  const leaderboard = ((lbRows ?? []) as LeaderboardRow[]).slice(0, 8);

  // KudoSeeds sent to me recently, with their notes.
  const { data: kudoData, error: kudoErr } = await supabase.rpc("get_my_kudoseeds");
  const kudoseeds = kudoErr
    ? []
    : ((kudoData ?? []) as { from: string; message: string | null; given_on_date: string }[]);

  // Monthly checklist (recompute/award happens in ensure_my_farm above).
  const { data: checklistRows } = await supabase.rpc("get_my_checklist");
  const checklist = (checklistRows ?? []) as ChecklistItem[];

  const visibility = VISIBILITY_OPTIONS.find(
    (v) => v.value === profile.leaderboard_visibility,
  );

  // Admin-renamable house display names (overrides in game_settings).
  const { data: houseNameRows } = await supabase
    .from("game_settings")
    .select("key, value_json")
    .like("key", "house_name_%");
  const houseNames = houseDisplayNames(
    (houseNameRows ?? []) as Pick<SettingOverrideRow, "key" | "value_json">[],
  );

  return (
    // Tighter than the shared Container: on a phone the farm should own the
    // height, so the dashboard skips Container's roomy py-8. No bottom padding
    // of its own — GameShell's pb clears the fixed menu and nothing scrolls
    // below the play area.
    <main className="mx-auto w-full flex-1 px-3 pb-0 pt-2">
      {farmError && (
        <Panel className="mb-4">
          <p className="text-sm font-bold text-[var(--rf-red)]">
            Couldn’t load your farm just now — try refreshing the page.
          </p>
        </Panel>
      )}

      <GameShell
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
          coins,
          treeCount: farm?.tree_count ?? trees.length,
        }}
        seasonDaysLeft={seasonDaysLeft}
        seasonDayOfMonth={seasonDayOfMonth}
        seasonCyclePosition={seasonCyclePosition}
        members={members}
        sentToday={Boolean(todaySeed)}
        sentToName={sentToName}
        kudoseeds={kudoseeds}
        basket={basket}
        goose={goose}
        garden={garden}
        store={store}
        lottery={lottery}
        ceremonyInvite={ceremonyInvite}
        checklist={checklist}
        leaderboard={leaderboard}
        profile={{
          username: profile.username,
          displayName: profile.display_name,
          avatarSrc: avatarSprite(profile.avatar_config),
          visibilityLabel: visibility?.label ?? "Public",
          visibilityDescription: visibility?.description ?? "",
        }}
        tutorial={{
          completed: profile.tutorial_completed ?? false,
          featureIntroSeen: (profile.feature_intro_seen ?? {}) as Record<string, boolean>,
        }}
      />
    </main>
  );
}
