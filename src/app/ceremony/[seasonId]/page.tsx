import { createClient } from "@/lib/supabase/server";
import { Container, Panel, PageHeader, PixelLink } from "@/components/pixel/ui";
import { CeremonyShow, type ShowFarmer, type ShowBadge } from "@/components/ceremony/CeremonyShow";
import { avatarSprite, houseKey, HOUSE_SPRITES, SPRITES } from "@/lib/sprites";
import { houseDisplayNames, type SettingOverrideRow } from "@/lib/gameSettings";
import type { CertificateData } from "@/components/ceremony/Certificate";
import type { MedalTier } from "@/components/pixel/placeholders";

type LbRow = {
  rank: number;
  username: string | null;
  display_name: string | null;
  avatar_config: { sprite?: string } | null;
  fruit_total: number;
  visibility: string;
  is_self: boolean;
};

/**
 * Monthly ceremony for a CLOSED season — the "Wrapped"-style show:
 * podium rise for the top 10, MVP badge reveals, then your personal recap.
 * Private Mode respected throughout.
 */
export default async function CeremonyPage({
  params,
}: {
  params: Promise<{ seasonId: string }>;
}) {
  const { seasonId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return (
      <Container className="flex flex-col items-center text-center">
        <PageHeader title="Monthly Ceremony" subtitle="Log in to watch the celebration." />
        <PixelLink href="/login">Log in</PixelLink>
      </Container>
    );
  }

  const { data: season } = await supabase
    .from("seasons")
    .select("id, name, status")
    .eq("id", seasonId)
    .maybeSingle();

  if (!season || season.status !== "closed") {
    return (
      <Container className="flex flex-col items-center text-center">
        <PageHeader
          title="Ceremony not ready"
          subtitle="This Season hasn’t finished yet — its ceremony appears once the month closes."
        />
        <PixelLink href="/dashboard">Back to your farm</PixelLink>
      </Container>
    );
  }

  // Top 10 for the closed season (Private-Mode-safe).
  const { data: lbRows } = await supabase.rpc("get_season_leaderboard", {
    p_season: seasonId,
  });
  const top10 = (lbRows ?? []) as LbRow[];

  // Medals + badges for the season.
  const { data: medalRows } = await supabase
    .from("user_medals")
    .select("user_id, medal_type, rank")
    .eq("season_id", seasonId)
    .order("rank");
  const { data: badgeRows } = await supabase
    .from("user_badges")
    .select("user_id, badge_definitions(name, description, icon)")
    .eq("season_id", seasonId);

  const badgeWinnerIds = (badgeRows ?? []).map((b) => b.user_id);
  const { data: badgeProfiles } = badgeWinnerIds.length
    ? await supabase
        .from("profiles")
        .select("user_id, username, display_name, avatar_config, leaderboard_visibility")
        .in("user_id", badgeWinnerIds)
    : { data: [] };
  const profileMap = new Map((badgeProfiles ?? []).map((p) => [p.user_id, p]));

  const medalByRank = new Map<number, MedalTier>([
    [1, "gold"],
    [2, "silver"],
    [3, "bronze"],
  ]);
  // only ranks that actually received a medal
  const medalRanks = new Set((medalRows ?? []).map((m) => m.rank as number));

  const farmers: ShowFarmer[] = top10.map((r) => ({
    rank: r.rank,
    name:
      r.visibility === "public" && r.username
        ? r.display_name || `@${r.username}`
        : "Anonymous Farmer",
    username: r.visibility === "public" ? r.username : null,
    avatar:
      r.visibility === "public"
        ? avatarSprite(r.avatar_config)
        : SPRITES.villagerVariants[6],
    fruits: r.fruit_total,
    isSelf: r.is_self,
    medal: medalRanks.has(r.rank) ? (medalByRank.get(r.rank) ?? null) : null,
  }));

  const badges: ShowBadge[] = (badgeRows ?? []).map((b) => {
    const def = b.badge_definitions as unknown as {
      name: string;
      description: string | null;
      icon: string | null;
    } | null;
    const p = profileMap.get(b.user_id);
    const anon = !p || p.leaderboard_visibility !== "public";
    return {
      badgeName: def?.name ?? "Badge",
      description: def?.description ?? "",
      icon: def?.icon ?? "🏅",
      winnerName: anon ? "Anonymous Farmer" : p!.display_name || `@${p!.username}`,
      winnerUsername: anon ? null : p!.username,
      winnerAvatar: anon ? SPRITES.villagerVariants[6] : avatarSprite(p!.avatar_config),
    };
  });

  // Your personal recap.
  const myMedal =
    ((medalRows ?? []).find((m) => m.user_id === user.id)?.medal_type as MedalTier | undefined) ??
    null;
  const myBadges = (badgeRows ?? [])
    .filter((b) => b.user_id === user.id)
    .map((b) => {
      const def = b.badge_definitions as unknown as { name: string; icon: string | null } | null;
      return { name: def?.name ?? "Badge", icon: def?.icon ?? "🏅" };
    });

  // ---- certificate data: your farmer in front of your house + stats -------
  const { data: myProfile } = await supabase
    .from("profiles")
    .select("username, display_name, avatar_config")
    .eq("user_id", user.id)
    .maybeSingle();
  const { data: myFarm } = await supabase
    .from("farms")
    .select("id, fruit_total")
    .eq("user_id", user.id)
    .eq("season_id", seasonId)
    .maybeSingle();
  let myTrees = 0;
  if (myFarm?.id) {
    const { count } = await supabase
      .from("trees")
      .select("id", { count: "exact", head: true })
      .eq("farm_id", myFarm.id as string);
    myTrees = count ?? 0;
  }
  const { data: houseNameRows } = await supabase
    .from("game_settings")
    .select("key, value_json")
    .like("key", "house_name_%");
  const houseNames = houseDisplayNames(
    (houseNameRows ?? []) as Pick<SettingOverrideRow, "key" | "value_json">[],
  );
  const myHouseKey = houseKey(myProfile?.avatar_config);
  const myRank = farmers.find((f) => f.isSelf)?.rank ?? null;

  const certificate: CertificateData | null = myProfile
    ? {
        seasonName: season.name as string,
        farmerName:
          (myProfile.display_name as string | null) ||
          `@${myProfile.username as string}`,
        avatarSrc: avatarSprite(myProfile.avatar_config),
        houseSrc: (HOUSE_SPRITES[myHouseKey] ?? HOUSE_SPRITES.house_1).src,
        houseName: houseNames[myHouseKey] ?? "Cozy Cottage",
        rank: myRank,
        fruits: (myFarm?.fruit_total as number | undefined) ?? 0,
        trees: myTrees,
        medal: myMedal,
        badges: myBadges.map((b) => b.name),
      }
    : null;

  return (
    <Container>
      <PageHeader
        title={`${season.name} Ceremony`}
        subtitle="🎉 The month is complete — let’s celebrate everyone who kept showing up!"
        route="/ceremony/[seasonId]"
      />

      {farmers.length === 0 ? (
        <Panel className="text-center">
          <p className="text-sm font-bold">This Season closed quietly — no farms to celebrate. 🌱</p>
          <div className="mt-4">
            <PixelLink href="/dashboard">Back to your farm</PixelLink>
          </div>
        </Panel>
      ) : (
        <CeremonyShow
          farmers={farmers}
          badges={badges}
          me={{ medal: myMedal, badges: myBadges }}
          seasonName={season.name}
          certificate={certificate}
        />
      )}
    </Container>
  );
}
