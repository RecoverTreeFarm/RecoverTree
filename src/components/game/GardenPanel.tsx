"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SPRITES } from "@/lib/sprites";
import { PixelIcon, type ItemIconName } from "@/components/pixel/Sprite";
import { gardenTreeStage, type GardenState } from "@/lib/garden";
import { contributeToGarden } from "@/app/dashboard/actions";
import { playSfx } from "@/lib/sfx";
import { playMusic, stopMusic } from "@/lib/music";
import { Butterflies } from "@/components/pixel/Butterflies";
import { announceReward } from "./RewardBanner";
import { ICON } from "@/lib/icons";
import {
  usePresence,
  useGreeting,
  useWalk,
  useWandering,
  NeighborSprite,
  PlayerFarmer,
  type Neighbor,
  type Blocker,
} from "./Neighbors";

/* ---------------------------------------------------------------------------
 * The Community Garden — a WALKABLE shared location (reached from the map via
 * the travel cinematic, not a popup). Your farmer walks where you click; the
 * donation box is an in-world object he walks up to; neighbors visiting right
 * now stand around idle and walk off after 5 minutes of inactivity.
 * Collaborative only: no passing, no winners, no leaderboard. Contributions
 * spend water/seeds/fertilizer; rewards pay water/seeds/fertilizer/coins —
 * never Fruits.
 * ------------------------------------------------------------------------- */

/** "2d 3h" / "5h 12m" / "any moment" from a future ISO timestamp (SSR-safe). */
function useCountdown(iso: string | undefined): string {
  const [label, setLabel] = useState("");
  useEffect(() => {
    if (!iso) return;
    const compute = () => {
      const rem = new Date(iso).getTime() - Date.now();
      if (rem <= 0) {
        setLabel("any moment");
        return;
      }
      const d = Math.floor(rem / 86_400_000);
      const h = Math.floor((rem % 86_400_000) / 3_600_000);
      const m = Math.floor((rem % 3_600_000) / 60_000);
      setLabel(d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`);
    };
    compute();
    const iv = setInterval(compute, 30_000);
    return () => clearInterval(iv);
  }, [iso]);
  return label;
}

/** The community tree art (the user's clean 32x32 crop), crisp-scaled. */
function CommunityTree({
  scale,
  className = "",
  style,
}: {
  scale: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={SPRITES.treeCommunity}
      alt=""
      aria-hidden
      className={`pixelated ${className}`}
      style={{ width: 32 * scale, height: 32 * scale, imageRendering: "pixelated", ...style }}
    />
  );
}

/** The pink cherry tree — a SINGLE 32x44 frame (not a strip). */
function CherryTree({
  scale,
  className = "",
  style,
}: {
  scale: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={SPRITES.treeBlossom}
      alt=""
      aria-hidden
      className={`pixelated ${className}`}
      style={{ width: 32 * scale, height: 44 * scale, imageRendering: "pixelated", ...style }}
    />
  );
}

/**
 * The giant shared tree. It STARTS at a normal farm-tree size and grows with
 * combined progress until it towers over anything on a player farm; at 100%
 * it blooms into the pink community tree with drifting petals.
 */
function GiantTree({ stage, progressPercent }: { stage: number; progressPercent: number }) {
  // farm trees render around 32px × ~3 — the community tree grows 2.8 → 6.2
  const scale = 2.8 + (Math.min(progressPercent, 100) / 100) * 3.4;
  const cherry = stage === 5;
  const glow = stage >= 4;
  return (
    <div className="relative flex flex-col items-center">
      {glow && (
        <div
          aria-hidden
          className="rf-ripe-glow absolute bottom-1 left-1/2 -translate-x-1/2 rounded-full"
          style={{ width: 34 * scale, height: 13 * scale, background: "var(--rf-gold)", opacity: 0.3, filter: "blur(10px)" }}
        />
      )}
      {cherry ? (
        <CherryTree scale={scale} className="relative" />
      ) : (
        <CommunityTree scale={scale} className="relative" />
      )}
      {glow && (
        <span aria-hidden className="rf-ripe-spark absolute -top-2 right-2 text-lg">✨</span>
      )}
      {cherry && (
        <>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              aria-hidden
              className="rf-petal absolute text-xs"
              style={{ left: `${22 + i * 26}%`, top: 8, animationDelay: `${i * 0.9}s`, color: "#e8a8c8" }}
            >
              ❀
            </span>
          ))}
        </>
      )}
    </div>
  );
}

/** Ground flowers ring the tree; more bloom as the garden nears completion. */
const PROGRESS_FLOWERS: { emoji: string; left: string; bottom: string }[] = [
  { emoji: "🌼", left: "40%", bottom: "26%" },
  { emoji: "🌷", left: "58%", bottom: "24%" },
  { emoji: "🌸", left: "46%", bottom: "18%" },
  { emoji: "🌼", left: "62%", bottom: "34%" },
  { emoji: "🌺", left: "36%", bottom: "36%" },
  { emoji: "🌸", left: "54%", bottom: "12%" },
  { emoji: "🌷", left: "30%", bottom: "20%" },
  { emoji: "🌼", left: "68%", bottom: "14%" },
  { emoji: "🌺", left: "44%", bottom: "42%" },
  { emoji: "🌸", left: "60%", bottom: "44%" },
];

function ProgressFlowers({ progressPercent }: { progressPercent: number }) {
  const count = Math.min(PROGRESS_FLOWERS.length, Math.floor(progressPercent / 10));
  return (
    <>
      {PROGRESS_FLOWERS.slice(0, count).map((f, i) => (
        <span
          key={i}
          aria-hidden
          className="pointer-events-none absolute text-sm leading-none"
          style={{ left: f.left, bottom: f.bottom, zIndex: 2 }}
        >
          {f.emoji}
        </span>
      ))}
    </>
  );
}

/** The open wooden donation crate, drawn in CSS (scales with `width`). */
function CrateArt({ width }: { width: number }) {
  return (
    <span
      aria-hidden
      className="block rounded-sm"
      style={{
        width,
        height: width * 0.75,
        background:
          "linear-gradient(var(--rf-soil-dark), var(--rf-soil-dark)) 0 0/100% 18% no-repeat, repeating-linear-gradient(90deg, var(--rf-wood) 0 20%, var(--rf-soil) 20% 25%)",
        border: "2px solid var(--rf-ink)",
        boxShadow: "inset 0 -8px 0 rgba(0,0,0,0.22)",
      }}
    />
  );
}

/** The in-world donation box — bouncing "!", walks the farmer over on tap. */
function DonationBox({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Donation box — add supplies to the Community Garden"
      title="Add a little care"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="relative flex flex-col items-center border-0 bg-transparent p-0"
    >
      <span
        aria-hidden
        className="rf-bang text-lg font-black"
        style={{ top: -20, color: "var(--rf-gold)", WebkitTextStroke: "1px var(--rf-ink)" }}
      >
        !
      </span>
      <span className="rf-farm-object block">
        <CrateArt width={44} />
      </span>
      <span className="mt-0.5 rounded border border-[var(--rf-ink)] bg-[var(--rf-cream)] px-1 text-[8px] font-extrabold uppercase leading-tight tracking-tight text-[var(--rf-ink)]">
        Donations
      </span>
    </button>
  );
}

/** Fixed idle spots for visiting neighbors — gathered NEAR the donation box
 *  (which sits around 67%/22%), like folks chatting by the collection point. */
const NEIGHBOR_SPOTS: { left: number; bottom: number }[] = [
  { left: 14, bottom: 14 },
  { left: 30, bottom: 10 },
  { left: 44, bottom: 16 },
  { left: 24, bottom: 20 },
  { left: 82, bottom: 12 },
  { left: 88, bottom: 18 },
  { left: 76, bottom: 10 },
  { left: 40, bottom: 22 },
];

/** Non-interactive dressing scattered around the green. */
function Decorations() {
  const items: { emoji: string; left: string; bottom: string; size: string }[] = [
    { emoji: "🌼", left: "12%", bottom: "5%", size: "text-sm" },
    { emoji: "🌷", left: "24%", bottom: "22%", size: "text-sm" },
    { emoji: "🌻", left: "80%", bottom: "24%", size: "text-base" },
    { emoji: "🌼", left: "88%", bottom: "6%", size: "text-sm" },
    { emoji: "🪨", left: "70%", bottom: "18%", size: "text-sm" },
    { emoji: "🌷", left: "42%", bottom: "48%", size: "text-sm" },
    { emoji: "🌼", left: "60%", bottom: "52%", size: "text-sm" },
    { emoji: "🪑", left: "8%", bottom: "56%", size: "text-base" },
  ];
  return (
    <>
      {items.map((d, i) => (
        <span
          key={i}
          aria-hidden
          className={`pointer-events-none absolute ${d.size} leading-none`}
          style={{ left: d.left, bottom: d.bottom, zIndex: 2 }}
        >
          {d.emoji}
        </span>
      ))}
      {/* side trees frame the green (normal farm-tree size, for comparison) */}
      <CommunityTree scale={3} className="pointer-events-none absolute" style={{ left: "2%", bottom: "52%", zIndex: 3 }} />
      <CommunityTree scale={2.5} className="pointer-events-none absolute" style={{ right: "2%", bottom: "56%", zIndex: 3 }} />
      {/* welcome sign */}
      <div
        className="pointer-events-none absolute left-1/2 top-1.5 -translate-x-1/2 rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-wood)] px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-[var(--rf-cream)]"
        style={{ boxShadow: "0 2px 0 var(--rf-ink)", zIndex: 40 }}
      >
        🪧 Community Garden
      </div>
    </>
  );
}

function GoalBar({ icon, cur, req }: { icon: React.ReactNode; cur: number; req: number }) {
  const pct = Math.min(100, Math.round((cur / req) * 100));
  return (
    <div className="flex items-center gap-1.5">
      <span aria-hidden className="flex w-5 items-center justify-center text-sm leading-none">{icon}</span>
      <div className="h-3 flex-1 overflow-hidden rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)]">
        <div className="h-full bg-[var(--rf-grass)]" style={{ width: `${pct}%`, transition: "width 0.4s ease" }} />
      </div>
      <span className="w-16 text-right text-[10px] font-bold tabular-nums">
        {Math.min(cur, req)} / {req}
      </span>
    </div>
  );
}

function milestoneLine(pct: number, completed: boolean): string {
  if (completed || pct >= 100) return "The Community Tree is blooming. 🌸";
  if (pct >= 75) return "The Community Tree is almost blooming.";
  if (pct >= 50) return "The Community Tree is growing tall.";
  if (pct >= 25) return "The Community Tree is starting to sprout.";
  return "A young tree takes root. Everyone’s care helps it grow.";
}

const REWARD_ICON: Record<string, string> = {
  water: "💧",
  seed: "🌰",
  fertilizer: ICON.fertilizer,
  coin: "🪙",
};

/* -------------------------------------------------------------------------
 * Walkable scene geometry (scene-percent coordinates)
 * ------------------------------------------------------------------------- */
const TREE_POS = { left: 50, bottom: 30 };
const BOX_POS = { left: 67, bottom: 22 };
/** Where the farmer stands to use the donation box — shoulder to shoulder. */
const FARMER_POS_FOR_BOX = { left: 63, bottom: 21 };
const FARMER_HOME = { left: 30, bottom: 12 };
/**
 * Farmers roam the front lawn only. maxBottom is held below the tree base
 * (bottom 30) so — because every walk is a straight line — the farmer can
 * never climb into the sky band, stand in the growing tree, or pass through
 * it. The trunk is also a blocker as an end-position guard.
 */
const WALK_BOUNDS = { minLeft: 3, maxLeft: 91, minBottom: 3, maxBottom: 24 };
const TREE_BLOCKER: Blocker[] = [{ left: 40, right: 60, bottom: 24, top: 50 }];

// ---------------------------------------------------------------------------
export function GardenScene({
  state,
  myWater,
  mySeeds,
  myFertilizer,
  avatarSrc,
  notificationSlot,
}: {
  state: GardenState;
  myWater: number;
  mySeeds: number;
  myFertilizer: number;
  /** the player's chosen farmer sprite */
  avatarSrc: string;
  /** rendered top-right over the garden (notifications + guidebook) */
  notificationSlot?: React.ReactNode;
}) {
  const active = state.has_event && state.status === "active" && !state.completed;
  const endsAt = state.has_event ? state.ends_at : undefined;
  const timeLeft = useCountdown(active ? endsAt : undefined);
  const [donateOpen, setDonateOpen] = useState(false);
  // The item the farmer is "holding" (shown in-hand after tending). Set when a
  // contribution lands; cleared a few seconds after the crate closes.
  const [held, setHeld] = useState<ItemIconName | null>(null);
  const heldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (heldTimer.current) clearTimeout(heldTimer.current); }, []);

  function closeDonate() {
    setDonateOpen(false);
    if (held) {
      if (heldTimer.current) clearTimeout(heldTimer.current);
      heldTimer.current = setTimeout(() => setHeld(null), 2800);
    }
  }

  // Garden music plays while the scene is mounted, stops on leave.
  useEffect(() => {
    playMusic("garden");
    return () => stopMusic();
  }, []);

  // Shared location plumbing: neighbors, greetings, click-to-walk.
  const initialOthers: Neighbor[] = state.has_event ? state.others : [];
  const visitors = usePresence("garden", initialOthers);
  const wanderTargets = useWandering(visitors.length, NEIGHBOR_SPOTS);
  
  const { pos, walking, walkMs, walkTo, walkToClick } = useWalk(
    FARMER_HOME,
    WALK_BOUNDS,
    TREE_BLOCKER,
  );
  const { greet, heartFor, myHeart } = useGreeting(walkTo);

  function onBoxClick() {
    // walk up to the box first, then the closeup opens — like farm objects
    walkTo(FARMER_POS_FOR_BOX, () => setDonateOpen(true));
  }

  const stage = state.has_event ? gardenTreeStage(state.progress_percent, state.completed) : 1;
  const last = state.has_event ? null : state.last_event;

  return (
    <div>
      {/* ---- THE GARDEN (walkable canvas) ---------------------------------- */}
      <div
        className="relative overflow-hidden rounded border-[3px] border-[var(--rf-ink)]"
        style={{ height: "clamp(340px, 52vh, 560px)" }}
        onClick={walkToClick}
      >
        {/* sky */}
        <div className="pointer-events-none absolute inset-x-0 top-0" style={{ height: "17%", background: "var(--rf-sky)" }} />
        {/* fenced green */}
        <div
          className="grass-tile pointer-events-none absolute inset-x-0 bottom-0"
          style={{ top: "15%", borderTop: "4px solid var(--rf-wood)", boxShadow: "inset 0 3px 0 rgba(0,0,0,0.15)" }}
        />
        {/* dirt path up to the tree */}
        <div
          className="soil-tile pointer-events-none absolute left-1/2 bottom-0 -translate-x-1/2"
          style={{ width: 52, height: "34%", border: "2px solid var(--rf-soil-dark)", borderBottom: "none", opacity: 0.9 }}
        />
        <Decorations />
        <ProgressFlowers progressPercent={state.has_event ? state.progress_percent : 0} />
        <Butterflies count={4} />

        {/* the giant shared tree — grows with the whole group's progress */}
        <div
          className="pointer-events-none absolute -translate-x-1/2"
          style={{ left: `${TREE_POS.left}%`, bottom: `${TREE_POS.bottom}%`, zIndex: Math.round(60 - TREE_POS.bottom) }}
        >
          <GiantTree
            stage={stage}
            progressPercent={state.has_event ? state.progress_percent : 0}
          />
        </div>

        {/* donation box (only while the garden is open for care) */}
        {active && (
          <div
            className="absolute -translate-x-1/2"
            style={{ left: `${BOX_POS.left}%`, bottom: `${BOX_POS.bottom}%`, zIndex: Math.round(60 - BOX_POS.bottom) }}
          >
            <DonationBox onClick={onBoxClick} />
          </div>
        )}

        {/* neighbors visiting right now — tap one to say hi (💗, +10 water) */}
        {visitors.map((v, i) => (
          <NeighborSprite
            key={v.key}
            v={v}
            spot={NEIGHBOR_SPOTS[wanderTargets[i] ?? i % NEIGHBOR_SPOTS.length]}
            heart={heartFor === v.key}
            onGreet={() => void greet(v, NEIGHBOR_SPOTS[wanderTargets[i] ?? i % NEIGHBOR_SPOTS.length])}
          />
        ))}

        {/* my farmer (holds the item just used to tend the garden) */}
        <PlayerFarmer src={avatarSrc} pos={pos} walking={walking} walkMs={walkMs} heart={myHeart} held={held} />

        {/* HUD overlay (notifications + guidebook) */}
        {notificationSlot && (
          <div
            className="absolute right-2 top-2 flex flex-col items-end gap-1.5"
            style={{ zIndex: 70 }}
            onClick={(e) => e.stopPropagation()}
          >
            {notificationSlot}
          </div>
        )}
      </div>

      {/* ---- status + shared goals ------------------------------------------ */}
      {state.has_event ? (
        <>
          <p className="mt-2 text-xs font-bold">{milestoneLine(state.progress_percent, state.completed)}</p>
          <p className="text-[11px] text-[var(--rf-ink-soft)]">
            {state.completed
              ? "The Community Garden bloomed — contributors received a Garden Share Bundle. 🧺"
              : active
                ? `Open for ${timeLeft} more · everyone’s care counts once a day. Tap the donation box to help.`
                : "The garden wrapped up for the week."}
          </p>
          <div className="mt-2 space-y-1.5">
            <GoalBar icon={<PixelIcon name="water" size={16} />} cur={state.current_water} req={state.required_water} />
            <GoalBar icon={<PixelIcon name="seed" size={16} />} cur={state.current_seeds} req={state.required_seeds} />
            <GoalBar icon={<PixelIcon name="fertilizer" size={16} />} cur={state.current_fertilizer} req={state.required_fertilizer} />
          </div>
          {state.i_contributed && (
            <p className="mt-2 text-[11px] text-[var(--rf-ink-soft)]">
              You’ve added {state.my_water > 0 && `💧${state.my_water} `}
              {state.my_seed > 0 && `🌰${state.my_seed} `}
              {state.my_fertilizer > 0 && `${ICON.fertilizer}${state.my_fertilizer} `}so far. Thank you. 🌱
            </p>
          )}
          {state.my_rewards.length > 0 && (
            <p className="mt-2 rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-gold)]/40 px-3 py-2 text-xs font-bold">
              Your Garden Share Bundle arrived:{" "}
              {state.my_rewards.map((r) => `${REWARD_ICON[r.reward_type] ?? ""}${r.amount}`).join(" ")}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="mt-3 text-sm font-bold">The garden is resting right now.</p>
          <p className="mt-1 text-xs text-[var(--rf-ink-soft)]">
            {state.enabled
              ? "A new Community Garden opens at the start of the week. Small steps still grow roots. 🌱"
              : "The Community Garden isn’t open at the moment."}
          </p>
          {last && last.status === "completed" && (
            <p className="mt-2 rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-gold)]/40 px-3 py-2 text-xs font-bold">
              Last week’s garden fully bloomed — contributors received a Garden Share Bundle. 🌸
            </p>
          )}
          {last && last.status === "expired" && (
            <p className="mt-2 rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-3 py-2 text-xs">
              The garden didn’t fully bloom this time, but every bit of care helped.
            </p>
          )}
        </>
      )}

      {/* ---- donation closeup ----------------------------------------------- */}
      {donateOpen && active && state.has_event && (
        <DonationCloseup
          state={state}
          myWater={myWater}
          mySeeds={mySeeds}
          myFertilizer={myFertilizer}
          onUseItem={setHeld}
          onClose={closeDonate}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Donation closeup — a big look inside the crate. Added items visibly drop
 * into the box with a sound and a sparkle.
 * ------------------------------------------------------------------------- */
type Drop = { id: number; icon: string; offset: number };

function DonationCloseup({
  state,
  myWater,
  mySeeds,
  myFertilizer,
  onUseItem,
  onClose,
}: {
  state: Extract<GardenState, { has_event: true }>;
  myWater: number;
  mySeeds: number;
  myFertilizer: number;
  /** report which item was just used so the farmer can be shown holding it */
  onUseItem: (item: ItemIconName) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [water, setWater] = useState(0);
  const [seed, setSeed] = useState(0);
  const [fert, setFert] = useState(0);
  const [drops, setDrops] = useState<Drop[]>([]);
  const [sparkle, setSparkle] = useState(false);
  const dropId = useRef(0);

  const maxWater = Math.min(myWater, state.today_water_left);
  const maxSeed = Math.min(mySeeds, state.today_seed_left);
  const maxFert = Math.min(myFertilizer, state.today_fertilizer_left);

  function donate() {
    if (water + seed + fert === 0) {
      setMsg({ ok: false, text: "Add a little something first." });
      return;
    }
    setMsg(null);
    startTransition(async () => {
      const r = await contributeToGarden(water, seed, fert);
      if (!r.ok) {
        playSfx("error");
        setMsg({ ok: false, text: r.message });
        return;
      }
      // items visibly tumble into the crate (a few per type, capped)
      const icons: Drop[] = [];
      const push = (icon: string, n: number) => {
        for (let i = 0; i < Math.min(n, 4); i++) {
          icons.push({ id: dropId.current++, icon, offset: (icons.length % 5) * 16 - 32 });
        }
      };
      push("💧", water);
      push("🌰", seed);
      push(ICON.fertilizer, fert);
      setDrops(icons);
      setSparkle(true);
      // hand the farmer whatever they contributed the most of (watering can /
      // seed bag / fertilizer), so they're shown holding it back in the scene.
      onUseItem(
        water >= seed && water >= fert ? "water" : seed >= fert ? "seed" : "fertilizer",
      );
      playSfx(seed > 0 ? "seed" : water > 0 ? "water" : "reveal");
      setTimeout(() => {
        setDrops([]);
        setSparkle(false);
      }, 1000);

      announceReward(
        `${water > 0 ? `${ICON.water} ${water}  ` : ""}${seed > 0 ? `${ICON.seed} ${seed}  ` : ""}${fert > 0 ? `${ICON.fertilizer} ${fert}  ` : ""}— added to the Community Garden`,
      );
      const text = r.completed
        ? "You helped the garden bloom. 🌸"
        : seed > 0
          ? "You planted a Seed in the Community Garden."
          : water > 0
            ? "You watered the Community Garden."
            : `Every bit of care helps. ${ICON.fertilizer}`;
      setMsg({ ok: true, text });
      setWater(0);
      setSeed(0);
      setFert(0);
      router.refresh();
    });
  }

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Donation box">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/50" />
      <div className="ui-frame absolute left-1/2 top-1/2 w-[min(92vw,24rem)] -translate-x-1/2 -translate-y-1/2 bg-[var(--rf-cream)] p-4">
        <div className="flex items-center justify-between">
          <h2 className="pixel-heading text-base">Add a little care 🌱</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close donation box"
            className="rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-2 py-0.5 text-xs font-extrabold hover:bg-[var(--rf-gold)]"
          >
            ✕
          </button>
        </div>

        {/* the crate, up close — items drop into it */}
        <div className="relative mx-auto mt-3 w-fit">
          {drops.map((d) => (
            <span
              key={d.id}
              aria-hidden
              className="rf-drop-in text-xl"
              style={{ marginLeft: d.offset, top: -6, zIndex: 5 }}
            >
              {d.icon}
            </span>
          ))}
          {sparkle && (
            <span aria-hidden className="rf-ripe-spark absolute -right-4 -top-2 text-lg" style={{ zIndex: 6 }}>
              ✨
            </span>
          )}
          <CrateArt width={132} />
          <span className="mt-1 block text-center text-[9px] font-extrabold uppercase tracking-wide text-[var(--rf-ink-soft)]">
            Community donations
          </span>
        </div>

        <p className="mt-2 text-[10px] text-[var(--rf-ink-soft)]">
          Up to your daily limit — you can add more on another day.
        </p>
        <div className="mt-2 space-y-2">
          {/* water always moves in fives — the app-wide water rule */}
          <DonateRow icon={<PixelIcon name="water" size={16} />} label="Water" value={water} max={maxWater} have={myWater} todayLeft={state.today_water_left} onChange={setWater} step={5} />
          <DonateRow icon={<PixelIcon name="seed" size={16} />} label="Seeds" value={seed} max={maxSeed} have={mySeeds} todayLeft={state.today_seed_left} onChange={setSeed} />
          <DonateRow icon={<PixelIcon name="fertilizer" size={16} />} label="Fertilizer" value={fert} max={maxFert} have={myFertilizer} todayLeft={state.today_fertilizer_left} onChange={setFert} />
        </div>

        {msg && (
          <p
            role={msg.ok ? "status" : "alert"}
            className={`mt-2 rounded border-2 border-[var(--rf-ink)] px-3 py-2 text-xs font-bold ${
              msg.ok ? "bg-[var(--rf-grass)]" : "bg-[var(--rf-red)] text-[var(--rf-cream)]"
            }`}
          >
            {msg.text}
          </p>
        )}

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={pending || water + seed + fert === 0}
            onClick={donate}
            className="pixel-btn text-xs disabled:opacity-50"
          >
            {pending ? "Adding…" : "Add to the garden"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onClose}
            className="pixel-btn pixel-btn--secondary text-xs"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/** One supply row in the donation menu: −/+ steppers, capped by inventory
 *  AND the remaining daily allowance. */
function DonateRow({
  icon,
  label,
  value,
  max,
  have,
  todayLeft,
  onChange,
  step = 1,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  max: number;
  have: number;
  todayLeft: number;
  onChange: (n: number) => void;
  /** stepper increment (water moves in fives) */
  step?: number;
}) {
  // with a step of 5, the effective max is the largest reachable multiple
  const effMax = max - (max % step);
  const capNote =
    todayLeft === 0 ? "daily limit reached" : have === 0 ? "none left" : `you have ${have} · ${todayLeft} more today`;
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <span className="inline-flex items-center gap-1 text-xs font-bold">
          {icon} {label}
        </span>
        <span className="ml-1.5 text-[10px] text-[var(--rf-ink-soft)]">({capNote})</span>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={`Less ${label}`}
          disabled={value <= 0}
          onClick={() => onChange(Math.max(0, value - step))}
          className="pixel-btn pixel-btn--secondary px-2 py-0.5 text-xs disabled:opacity-40"
        >
          −
        </button>
        <span className="w-8 text-center text-sm font-extrabold tabular-nums">{value}</span>
        <button
          type="button"
          aria-label={`More ${label}`}
          disabled={value + step > effMax}
          onClick={() => onChange(Math.min(effMax, value + step))}
          className="pixel-btn pixel-btn--secondary px-2 py-0.5 text-xs disabled:opacity-40"
        >
          +
        </button>
      </div>
    </div>
  );
}
