import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Container, Panel, PageHeader, PixelLink } from "@/components/pixel/ui";
import { Sprite, Fruit } from "@/components/pixel/Sprite";
import { Medal, Badge, type MedalTier } from "@/components/pixel/placeholders";
import { avatarSprite, SPRITES } from "@/lib/sprites";

type LeaderboardRow = {
  rank: number;
  username: string | null;
  display_name: string | null;
  avatar_config: { sprite?: string } | null;
  fruit_total: number;
  visibility: "public" | "anonymous" | "hidden";
  is_self: boolean;
  medals: MedalTier[];
  badges: { icon: string | null; name: string }[];
};

/**
 * Monthly leaderboard (current Season, ranked by fruit_total).
 * Private Mode is enforced in the database function:
 *  - hidden farmers are excluded (they only see their own row)
 *  - anonymous farmers arrive with identity + awards already stripped
 * Medals/badges show ONLY once actually won at a monthly ceremony.
 */
export default async function LeaderboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <Container className="flex flex-col items-center text-center">
        <PageHeader
          title="Leaderboard"
          subtitle="Log in to see how the community orchard is growing this Season."
        />
        <div className="flex gap-3">
          <PixelLink href="/login">Log in</PixelLink>
          <PixelLink href="/signup" variant="secondary">
            Sign up
          </PixelLink>
        </div>
      </Container>
    );
  }

  const { data } = await supabase.rpc("get_leaderboard");
  const rows = (data ?? []) as LeaderboardRow[];

  return (
    <Container>
      <PageHeader
        title="Leaderboard"
        subtitle="A light, friendly ranking by Fruits this Season. Anonymous farmers appear as Anonymous Farmer; hidden farmers stay off the board."
        route="/leaderboard"
      />

      {rows.length === 0 ? (
        <Panel className="text-center">
          <p className="text-sm font-bold">The board is empty — the Season is just beginning. 🌱</p>
          <p className="mt-1 text-xs text-[var(--rf-ink-soft)]">
            Attend a meeting and enter its code to plant your first Fruits.
          </p>
        </Panel>
      ) : (
        <>
          <Panel className="overflow-x-auto p-0">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-[3px] border-[var(--rf-ink)] text-left text-xs uppercase tracking-wide">
                  <th className="p-3">Rank</th>
                  <th className="p-3">Farmer</th>
                  <th className="p-3">Fruits</th>
                  <th className="p-3">Medals</th>
                  <th className="p-3">Badges</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const anonymous = r.visibility === "anonymous";
                  const hiddenSelf = r.visibility === "hidden";
                  const name = anonymous
                    ? "Anonymous Farmer"
                    : r.display_name || (r.username ? `@${r.username}` : "Farmer");
                  // Clickable only for public identities (not anonymous, not
                  // your own hidden row — a hidden profile page 404s anyway).
                  const clickable = r.visibility === "public" && r.username;
                  return (
                    <tr
                      key={`${r.rank}-${r.username ?? i}`}
                      className="border-b-2 border-[var(--rf-ink)]/20"
                      style={{
                        background: r.is_self
                          ? "rgba(242,193,78,0.35)"
                          : i % 2
                            ? "transparent"
                            : "rgba(255,255,255,0.4)",
                      }}
                    >
                      <td className="p-3 text-lg font-extrabold">{r.rank}</td>
                      <td className="p-3">
                        <span className="flex flex-wrap items-center gap-2">
                          <Sprite
                            src={anonymous ? SPRITES.villagerVariants[6] : avatarSprite(r.avatar_config)}
                            size={[32, 32]}
                            scale={2}
                            alt=""
                          />
                          {clickable ? (
                            <Link href={`/profile/${r.username}`} className="font-bold underline">
                              {name}
                            </Link>
                          ) : (
                            <span className="font-bold">{name}</span>
                          )}
                          {r.is_self && (
                            <span className="rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-gold)] px-1.5 text-[10px] font-extrabold uppercase">
                              you
                            </span>
                          )}
                          {hiddenSelf && (
                            <span className="rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-1.5 text-[10px] font-bold uppercase text-[var(--rf-ink-soft)]">
                              hidden — only you can see this
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="p-3">
                        <span className="flex items-center gap-1 font-bold">
                          <Fruit scale={1} /> {r.fruit_total}
                        </span>
                      </td>
                      <td className="p-3">
                        <span className="flex items-center gap-1">
                          {r.medals.length === 0 ? (
                            <span className="text-xs text-[var(--rf-ink-soft)]">—</span>
                          ) : (
                            r.medals.slice(0, 3).map((tier, mi) => (
                              <Medal key={mi} tier={tier} size={22} />
                            ))
                          )}
                        </span>
                      </td>
                      <td className="p-3">
                        <span className="flex flex-wrap items-center gap-1">
                          {r.badges.length === 0 ? (
                            <span className="text-xs text-[var(--rf-ink-soft)]">—</span>
                          ) : (
                            r.badges.slice(0, 3).map((b, bi) => (
                              <Badge key={bi} icon={b.icon ?? "🏅"} label="" earned />
                            ))
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>
          <p className="mt-2 text-[11px] text-[var(--rf-ink-soft)]">
            Medals and badges appear here after they’re won at a monthly award
            ceremony. None have been awarded yet — the first ceremony is coming.
          </p>
        </>
      )}
    </Container>
  );
}
