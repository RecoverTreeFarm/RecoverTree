import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/profile";
import { Container, Panel, PageHeader, PixelLink } from "@/components/pixel/ui";
import { FarmScene } from "@/components/pixel/FarmScene";
import { Sprite, Fruit } from "@/components/pixel/Sprite";
import { FertilizerBag, Medal, Badge, type MedalTier } from "@/components/pixel/placeholders";
import { avatarSprite, houseKey, HOUSE_SPRITES } from "@/lib/sprites";
import { houseDisplayNames, type SettingOverrideRow } from "@/lib/gameSettings";

/**
 * Public farmer profile.
 *
 * Privacy comes from RLS, not just the UI: other users' profiles are only
 * readable when their visibility is 'public' (and they aren't banned).
 * Anonymous/hidden farmers simply come back as "not found" here — and
 * meeting attendance is never queried at all.
 */
export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // ilike = case-insensitive exact match (usernames are unique that way)
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .ilike("username", username)
    .maybeSingle();
  const profile = (data as Profile | null) ?? null;

  if (!profile) {
    return (
      <Container className="flex flex-col items-center text-center">
        <PageHeader
          title="No farmer here"
          subtitle="This farmer doesn’t exist, or they prefer to keep their farm private. Either way — be well, traveler."
        />
        <PixelLink href={user ? "/dashboard" : "/"}>Head home</PixelLink>
      </Container>
    );
  }

  const isOwn = user?.id === profile.user_id;

  // The real farm snapshot — works for VISITORS too. get_public_farm is a
  // SECURITY DEFINER function that only answers for public, non-banned
  // farmers (privacy rules identical to the rest of the app).
  const { data: snapshotData } = await supabase.rpc("get_public_farm", {
    p_user: profile.user_id,
  });
  const snapshot = (snapshotData ?? null) as {
    fruit_total: number;
    trees: { stage: number; is_blossom: boolean }[];
  } | null;
  const treeCount = snapshot?.trees.length ?? 0;

  // Extra detail is only shown to the profile's owner (their farm stats are
  // RLS-protected anyway — this just avoids pointless queries for visitors).
  let farm: { fruit_total: number; fertilizer_count: number } | null = null;
  if (isOwn) {
    const { data: season } = await supabase
      .from("seasons")
      .select("id")
      .eq("status", "active")
      .maybeSingle();
    if (season) {
      const { data: farmRow } = await supabase
        .from("farms")
        .select("id, fruit_total, fertilizer_count")
        .eq("user_id", profile.user_id)
        .eq("season_id", season.id)
        .maybeSingle();
      farm = farmRow;
    }
  }

  // Own-only Weekly Orchard Lottery stats (privacy-safe by construction:
  // built from the viewer's OWN tickets + prize ledger rows, both RLS-scoped
  // to the owner — nothing here can describe another farmer).
  let lotteryStats: {
    roundsEntered: number;
    tickets: number;
    wins: number;
    biggestPrize: number;
  } | null = null;
  if (isOwn) {
    const [{ data: ticketRows }, { data: prizeRows }] = await Promise.all([
      supabase
        .from("weekly_lottery_tickets")
        .select("round_id, status")
        .eq("user_id", profile.user_id),
      supabase
        .from("coin_events")
        .select("amount")
        .eq("user_id", profile.user_id)
        .eq("reason", "lottery_prize"),
    ]);
    const tickets = (ticketRows ?? []).filter((t) => t.status !== "invalidated");
    const prizes = (prizeRows ?? []).map((p) => p.amount as number);
    if (tickets.length > 0 || prizes.length > 0) {
      lotteryStats = {
        roundsEntered: new Set(tickets.map((t) => t.round_id as string)).size,
        tickets: tickets.length,
        wins: prizes.length,
        biggestPrize: prizes.length ? Math.max(...prizes) : 0,
      };
    }
  }

  const joined = new Date(profile.created_at).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  // Portrait: selected house + admin-renamable display name.
  const hKey = houseKey(profile.avatar_config);
  const house = HOUSE_SPRITES[hKey] ?? HOUSE_SPRITES.house_1;
  const { data: houseNameRows } = await supabase
    .from("game_settings")
    .select("key, value_json")
    .like("key", "house_name_%");
  const houseName =
    houseDisplayNames(
      (houseNameRows ?? []) as Pick<SettingOverrideRow, "key" | "value_json">[],
    )[hKey] ?? house.label;

  // Won awards (ceremony results). RLS allows reading these for public
  // profiles and for yourself — anonymous/hidden farmers' awards stay private
  // (their profiles aren't reachable here anyway).
  const { data: medalRows } = await supabase
    .from("user_medals")
    .select("medal_type, awarded_at")
    .eq("user_id", profile.user_id)
    .order("awarded_at", { ascending: false });
  const { data: badgeRows } = await supabase
    .from("user_badges")
    .select("awarded_at, badge_definitions(icon, name)")
    .eq("user_id", profile.user_id)
    .order("awarded_at", { ascending: false });
  const medals = (medalRows ?? []) as { medal_type: MedalTier }[];
  const badges = (badgeRows ?? []).map((b) => {
    const def = b.badge_definitions as unknown as { icon: string | null; name: string } | null;
    return { icon: def?.icon ?? "🏅", name: def?.name ?? "Badge" };
  });

  return (
    <Container>
      <PageHeader
        title={profile.display_name || `@${profile.username}`}
        subtitle={profile.bio ?? "A farmer quietly growing their orchard."}
        route="/profile/[username]"
      />

      <div className="grid gap-6 md:grid-cols-[1fr_2fr]">
        <Panel className="flex flex-col items-center text-center">
          {/* Cozy portrait: the farmer standing in front of their house */}
          <div
            className="grass-tile relative h-40 w-full overflow-hidden rounded-lg"
            style={{ border: "2px solid var(--rf-ink)" }}
          >
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
              <Sprite
                src={house.src}
                size={[house.w, house.h]}
                scale={1.35}
                alt={houseName}
              />
            </div>
            <div className="absolute bottom-2 left-1/2 -translate-x-[110%]">
              <Sprite
                src={avatarSprite(profile.avatar_config)}
                size={[32, 32]}
                scale={3.8}
                alt="farmer avatar"
              />
            </div>
          </div>
          <p className="mt-1.5 text-[10px] font-bold uppercase tracking-wide text-[var(--rf-ink-soft)]">
            {houseName}
          </p>
          <h2 className="pixel-heading mt-2 text-xl">@{profile.username}</h2>
          {profile.display_name && (
            <p className="text-xs text-[var(--rf-ink-soft)]">“{profile.display_name}”</p>
          )}
          <p className="mt-2 text-[11px] uppercase tracking-wide text-[var(--rf-ink-soft)]">
            Farming since {joined}
          </p>

          {isOwn && farm && (
            <div className="mt-4 w-full space-y-1 border-t-2 border-dashed border-[var(--rf-ink)]/40 pt-3 text-sm">
              <p className="flex items-center justify-center gap-1.5 font-bold">
                <Fruit scale={1} /> {farm.fruit_total} Fruits
              </p>
              <p className="flex items-center justify-center gap-1.5">
                <FertilizerBag size={18} /> {farm.fertilizer_count} fertilizer
              </p>
              <p>🌳 {treeCount} {treeCount === 1 ? "tree" : "trees"}</p>
              {lotteryStats && (
                <div className="pt-1 text-xs text-[var(--rf-ink-soft)]">
                  <p className="font-bold">🎟️ Weekly Orchard Lottery</p>
                  <p>
                    {lotteryStats.roundsEntered} {lotteryStats.roundsEntered === 1 ? "drawing" : "drawings"} entered
                    · {lotteryStats.tickets} {lotteryStats.tickets === 1 ? "ticket" : "tickets"}
                  </p>
                  {lotteryStats.wins > 0 && (
                    <p>
                      {lotteryStats.wins} {lotteryStats.wins === 1 ? "win" : "wins"} · biggest prize 🪙{" "}
                      {lotteryStats.biggestPrize}
                    </p>
                  )}
                </div>
              )}
              <p className="text-[11px] text-[var(--rf-ink-soft)]">
                (These stats are visible only to you for now.)
              </p>
            </div>
          )}

          {isOwn && (
            <Link href="/settings" className="pixel-btn pixel-btn--secondary mt-4 text-xs">
              Edit profile
            </Link>
          )}
        </Panel>

        <div>
          {/* The farmer's REAL farm: their trees, avatar, house, and fruit
              crates — not a stock vignette. Falls back to a small default
              scene only if the snapshot isn't available. */}
          <FarmScene
            trees={
              snapshot && snapshot.trees.length > 0
                ? snapshot.trees.map((t) => ({
                    stage: t.stage,
                    isBlossom: t.is_blossom,
                  }))
                : [{ stage: 1 }, { stage: 3 }, { stage: 5 }]
            }
            farmerSrc={avatarSprite(profile.avatar_config)}
            house={{ src: house.src, w: house.w, h: house.h }}
            fruitTotal={snapshot?.fruit_total ?? 0}
          />

          <Panel className="mt-4">
            <h2 className="pixel-heading mb-2 text-lg">Awards</h2>
            {medals.length === 0 && badges.length === 0 ? (
              <p className="text-xs text-[var(--rf-ink-soft)]">
                No medals or badges yet — they’re won at the monthly award
                ceremony. Keep showing up. 🌱
              </p>
            ) : (
              <>
                {medals.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    {medals.map((m, i) => (
                      <Medal key={i} tier={m.medal_type} size={30} />
                    ))}
                  </div>
                )}
                {badges.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {badges.map((b, i) => (
                      <Badge key={i} icon={b.icon} label={b.name} earned />
                    ))}
                  </div>
                )}
              </>
            )}
          </Panel>
        </div>
      </div>
    </Container>
  );
}
