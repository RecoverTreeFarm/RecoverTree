"use client";

import { useEffect, useRef, useState } from "react";
import { FarmPanel, type FarmPanelHandle, type FarmItemKind } from "@/components/pixel/FarmPanel";
import { SeedPanel, type SeedMember } from "@/components/pixel/SeedPanel";
import { BasketPanel, type BasketState } from "@/components/pixel/BasketPanel";
import { CodeForm } from "@/components/meeting/CodeForm";
import type { TreeView } from "@/components/pixel/FarmScene";
import { ProfilePanel, type ProfileInfo } from "./ProfilePanel";
import { ChecklistPanel, LeaderboardPanel, InventoryPanel, MailPanel } from "./panels";
import type { ChecklistItem, LeaderboardRow } from "./panels";
import { NotificationCenter, type FarmNotification } from "./NotificationCenter";
import { WikiHelp, WikiRoot } from "./WikiPanel";
import { useTutorial } from "./TutorialOverlay";
import { FeatureGuidePopup, type FeatureKey } from "./FeatureGuide";
import { GoosePanel } from "./GoosePanel";
import { GardenScene } from "./GardenPanel";
import { StoreScene } from "./GeneralStore";
import { FishingScene } from "./FishingLake";
import type { FishStack } from "@/lib/fish";
import { TravelCinematic } from "./TravelCinematic";
import { MapModalBody } from "./MapPanel";
import { CeremonyInvitePopup } from "./CeremonyInvite";
import { RewardBannerHost } from "./RewardBanner";
import type { GooseState } from "@/lib/goose";
import type { GardenState } from "@/lib/garden";
import type { StoreState } from "@/lib/store";
import type { LotteryState } from "@/lib/lottery";
import { LotteryPanel } from "./LotteryPanel";
import { HOUSE_SPRITES, seasonEmoji } from "@/lib/sprites";

type PanelId =
  | "inventory"
  | "code"
  | "seed"
  | "mail"
  | "map"
  | "basket"
  | "goose"
  | "lottery"
  | "checklist"
  | "leaderboard"
  | "profile";

/** Places the player can BE (walkable scenes, reached via the map). */
type LocationId = "farm" | "garden" | "store" | "lake";

/** 1 → "1st", 22 → "22nd", 23 → "23rd" — for the season date chip. */
function ordinal(n: number): string {
  const rem10 = n % 10;
  const rem100 = n % 100;
  if (rem10 === 1 && rem100 !== 11) return `${n}st`;
  if (rem10 === 2 && rem100 !== 12) return `${n}nd`;
  if (rem10 === 3 && rem100 !== 13) return `${n}rd`;
  return `${n}th`;
}

/**
 * The tiny season-date pill on the farm HUD. Tapping it opens a small
 * "there are N days left in the season" popup; tapping the pill again — or
 * anywhere else — closes it.
 */
function SeasonChip({
  emoji,
  dateLabel,
  daysLeft,
}: {
  emoji: string | null;
  dateLabel: string;
  daysLeft: number | null;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative flex flex-col items-center">
      <button
        type="button"
        aria-expanded={open}
        aria-label="Season date — tap for days remaining"
        onClick={() => setOpen((o) => !o)}
        className="flex flex-col items-center rounded border border-[var(--rf-ink)]/30 px-1.5 py-0.5 leading-none"
        style={{ background: "rgba(247,239,223,0.82)" }}
      >
        {emoji && (
          <span aria-hidden className="text-[13px] leading-none">
            {emoji}
          </span>
        )}
        <span className="mt-0.5 text-[8px] font-bold uppercase tracking-wide text-[var(--rf-ink-soft)]">
          {dateLabel}
        </span>
      </button>
      {open && (
        <div
          role="status"
          className="absolute top-full mt-1.5 w-max max-w-[240px] rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-3 py-2 text-center text-xs font-bold text-[var(--rf-ink)]"
          style={{ boxShadow: "2px 2px 0 rgba(58,42,26,0.35)" }}
        >
          {daysLeft !== null
            ? `There ${daysLeft === 1 ? "is" : "are"} ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left in the season. ${emoji ?? "🌱"}`
            : "A new season will begin soon. 🌱"}
        </div>
      )}
    </div>
  );
}

const LOCATION_LABELS: Record<LocationId, string> = {
  farm: "your farm",
  garden: "the Community Garden",
  store: "the General Store",
  lake: "the Fishing Lake",
};

export type GameShellProps = {
  /** house key → display name (admin-renamable) */
  houseNames: Record<string, string>;
  avatarSrc: string;
  houseKey: string;
  trees: TreeView[];
  farm: {
    seasonName: string;
    fruitTotal: number;
    water: number;
    seeds: number;
    fertilizer: number;
    /** 🪙 spendable currency — never counts toward the leaderboard */
    coins: number;
    treeCount: number;
  };
  /** whole days until the current season ends (null if unknown) */
  seasonDaysLeft: number | null;
  /** 1-based day within the current season ("8th of Maypril") */
  seasonDayOfMonth: number | null;
  /** 1..5 position in the season cycle — picks the header icon */
  seasonCyclePosition: number | null;
  members: SeedMember[];
  sentToday: boolean;
  sentToName: string | null;
  /** KudoSeeds sent TO me lately, with their encouraging notes */
  kudoseeds: { from: string; message: string | null; given_on_date: string }[];
  basket: BasketState | null;
  goose: GooseState | null;
  garden: GardenState | null;
  store: StoreState | null;
  lottery: LotteryState | null;
  /** Fishing (Phase 1, admin-only preview): whether this user may fish, their
   *  fish inventory, and the admin difficulty knob. */
  canFish: boolean;
  fishInventory: FishStack[];
  fishDifficultyPercent: number;
  /** a completed season whose ceremony this user hasn't seen/dismissed yet */
  ceremonyInvite: { season_id: string; season_name: string } | null;
  checklist: ChecklistItem[];
  leaderboard: LeaderboardRow[];
  profile: ProfileInfo;
  /** first-time tutorial + feature-guide state (from the profile) */
  tutorial: {
    completed: boolean;
    featureIntroSeen: Record<string, boolean>;
  };
};

/**
 * The dashboard as a cozy game screen: the farm is the canvas, a fixed
 * bottom menu opens everything else in small windows (bottom sheets on
 * mobile, centered windows on desktop).
 */
export function GameShell(props: GameShellProps) {
  const [open, setOpen] = useState<PanelId | null>(null);
  const house = HOUSE_SPRITES[props.houseKey] ?? HOUSE_SPRITES.house_1;
  const farmRef = useRef<FarmPanelHandle | null>(null);

  // Where the player IS (farm / garden) + an in-flight trip. Traveling plays
  // the walking cinematic, then swaps the scene.
  const [location, setLocation] = useState<LocationId>("farm");
  const [traveling, setTraveling] = useState<LocationId | null>(null);

  function travel(to: LocationId) {
    setOpen(null);
    if (traveling || to === location) return;
    setTraveling(to);
  }

  // Seed notification cadence: once per day — dismissed stays dismissed —
  // UNLESS seeds ran all the way to 0 and came back, which starts a new
  // "cycle" so the notification returns. Tracked per-browser.
  const [seedNotifId, setSeedNotifId] = useState("seeds-pending");
  useEffect(() => {
    let cycle = 0;
    try {
      const prevRaw = window.localStorage.getItem("rf-prev-seeds");
      const prev = prevRaw === null ? null : Number(prevRaw);
      cycle = Number(window.localStorage.getItem("rf-seed-cycle") ?? "0") || 0;
      if (prev === 0 && props.farm.seeds > 0) {
        cycle += 1;
        window.localStorage.setItem("rf-seed-cycle", String(cycle));
      }
      window.localStorage.setItem("rf-prev-seeds", String(props.farm.seeds));
    } catch {
      /* private mode etc. — falls back to the daily id */
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSeedNotifId(`seeds-${new Date().toISOString().slice(0, 10)}-c${cycle}`);
  }, [props.farm.seeds]);

  // Mailbox read-state: the envelope shows for UNREAD mail only. Opening the
  // Mailbox window records the current batch (count + newest date) so the
  // envelope disappears — and reappears the moment a NEW KudoSeed arrives
  // (the batch key changes). Persisted per browser.
  const mailKey =
    props.kudoseeds.length > 0
      ? `${props.kudoseeds.length}-${props.kudoseeds[0]?.given_on_date ?? ""}`
      : "";
  const [mailReadKey, setMailReadKey] = useState<string | null>(null);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMailReadKey(window.localStorage.getItem("rf-mail-read"));
    } catch {
      /* private mode — envelope just stays visible */
    }
  }, []);
  function openMailbox() {
    setOpen("mail");
    setMailReadKey(mailKey);
    try {
      window.localStorage.setItem("rf-mail-read", mailKey);
    } catch {
      /* ignore */
    }
  }

  // A "!" sits on the Goals button whenever a goal has been completed that
  // the player hasn't looked at yet. Opening the Goals window marks the
  // current set of completed goals as seen (persisted per browser).
  const completedGoalKeys = props.checklist
    .filter((g) => g.completed)
    .map((g) => g.key)
    .sort()
    .join(",");
  const [seenGoalKeys, setSeenGoalKeys] = useState<string>("");
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSeenGoalKeys(window.localStorage.getItem("rf-goals-seen") ?? "");
    } catch {
      /* private mode — the badge just shows until the window is opened */
    }
  }, []);
  const hasNewGoal = completedGoalKeys.length > 0 && completedGoalKeys !== seenGoalKeys;

  function markGoalsSeen() {
    setSeenGoalKeys(completedGoalKeys);
    try {
      window.localStorage.setItem("rf-goals-seen", completedGoalKeys);
    } catch {
      /* no-op */
    }
  }

  // Backpack item click → close the window and run the confirmed action on
  // the farm (which then shows its in-place skip control).
  function useItemFromBackpack(kind: FarmItemKind) {
    setOpen(null);
    farmRef.current?.useItem(kind);
  }

  const menu: {
    id: PanelId | "home";
    label: string;
    icon: React.ReactNode;
  }[] = [
    {
      id: "home",
      label: "Farm",
      icon: (
        <img src={house.src} alt="" className="pixelated h-7 w-auto" />
      ),
    },
    { id: "inventory", label: "Items", icon: <span aria-hidden className="text-xl">🎒</span> },
    { id: "code", label: "Code", icon: <span aria-hidden className="text-xl">🔢</span> },
    {
      id: "seed",
      label: "Kudos",
      icon: <img src="/sprites/icons/seed_packet.png" alt="" className="pixelated h-7 w-7" />,
    },
    // Basket and Goose left the menu — they now appear ON the farm during
    // their events. Map takes a permanent slot here instead.
    { id: "map", label: "Map", icon: <span aria-hidden className="text-xl">🗺️</span> },
    { id: "checklist", label: "Goals", icon: <span aria-hidden className="text-xl">📋</span> },
    {
      id: "leaderboard",
      label: "Leaders",
      icon: <img src="/awards/medal_gold.png" alt="" className="pixelated h-7 w-auto" />,
    },
    {
      id: "profile",
      label: "Profile",
      icon: <img src={props.avatarSrc} alt="" className="pixelated h-8 w-8" />,
    },
  ];

  const windowTitle: Record<PanelId, string> = {
    inventory: "Your items",
    code: "Enter meeting code",
    seed: "Today’s KudoSeed",
    mail: "📬 Mailbox",
    map: "🗺️ World map",
    basket: "Traveling Basket",
    goose: "Golden Goose",
    lottery: "🎟️ Weekly Orchard Lottery",
    checklist: "Monthly checklist",
    leaderboard: "Leaderboard",
    profile: "Your farmer",
  };

  /* ---- on-farm event objects -------------------------------------------- */
  const g = props.goose;
  const gooseEvent = !!g && g.has_event;
  // First 24h = answers open; afterwards the Keeper reviews the submissions.
  const answersOpen = gooseEvent && g.status === "answer_collection";
  const selectionOpen = gooseEvent && g.status === "selection_open";
  const iAmKeeper = gooseEvent && g.i_am_keeper;

  // The goose itself only visits the Keeper while answers are being collected.
  const showGoose = answersOpen && iAmKeeper;

  // The Keeper's box stays until the event is COMPLETELY over — i.e. until the
  // selection deadline passes — so they can reopen the review screen and
  // CHANGE their pick. The pick is provisional: the egg is delivered to
  // whatever pick is saved when the deadline passes (auto_close pays it).
  const keeperReviewOpen =
    gooseEvent &&
    iAmKeeper &&
    (selectionOpen ||
      (["completed", "auto_completed"].includes(g.status) &&
        // the deadline is server-supplied and hours away; a per-render read of
        // the clock is precise enough to decide whether the event is over
        // eslint-disable-next-line react-hooks/purity
        new Date(g.selection_deadline_at).getTime() > Date.now()));

  // Non-Keepers drop answers in during phase 1; afterwards it's the Keeper's.
  const submissionBox: "submit" | "review" | null =
    answersOpen && !iAmKeeper ? "submit" : keeperReviewOpen ? "review" : null;

  const basketOnFarm =
    !!props.basket?.has_chain && props.basket.status === "active" && !!props.basket.i_hold_it;

  /* ---- first-time tutorial ---------------------------------------------- */
  const tutorial = useTutorial({
    required: !props.tutorial.completed,
    trees: props.trees,
    fruitTotal: props.farm.fruitTotal,
  });

  /* ---- first-time feature guides ---------------------------------------- */
  // Shown once each, only after the required tutorial is finished so the two
  // never collide. "Seen" persists on the profile; seenLocal hides one the
  // instant it's dismissed (before the server refresh lands).
  const [seenLocal, setSeenLocal] = useState<Set<FeatureKey>>(new Set());
  const [featureToShow, setFeatureToShow] = useState<FeatureKey | null>(null);
  const canShowGuides = props.tutorial.completed && !tutorial.active && !traveling;
  const isFeatureSeen = (k: FeatureKey) =>
    seenLocal.has(k) || Boolean(props.tutorial.featureIntroSeen[k]);

  useEffect(() => {
    if (!canShowGuides || featureToShow) return;
    let key: FeatureKey | null = null;
    if (open === "code") key = "meeting_code";
    else if (open === "lottery") key = "lottery";
    else if (location === "store") key = "store";
    else if (location === "lake") key = "fishing_lake";
    else if (location === "garden") key = "community_garden";
    else if (basketOnFarm || open === "basket") key = "traveling_basket";
    else if (gooseEvent || open === "goose") key = "golden_goose";
    // deriving the popup to show from where the player navigated is the point
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (key && !isFeatureSeen(key)) setFeatureToShow(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, location, basketOnFarm, gooseEvent, canShowGuides, featureToShow]);

  // Compact season date: floats on the farm HUD (no row of its own, so
  // nothing scrolls). Tap it for the days-left popup.
  const seasonChip = (
    <SeasonChip
      emoji={seasonEmoji(props.seasonCyclePosition) || null}
      dateLabel={
        props.seasonDayOfMonth !== null
          ? `${ordinal(props.seasonDayOfMonth)} of ${props.farm.seasonName}`
          : props.farm.seasonName
      }
      daysLeft={props.seasonDaysLeft}
    />
  );

  return (
    <div className="pb-20">
      {/* THE CURRENT LOCATION — your farm, or the shared Community Garden */}
      <div className="relative">
        {location === "farm" ? (
          <FarmPanel
            trees={props.trees}
            water={props.farm.water}
            seeds={props.farm.seeds}
            fertilizer={props.farm.fertilizer}
            coins={props.farm.coins}
            fruitTotal={props.farm.fruitTotal}
            house={{ src: house.src, w: house.w, h: house.h }}
            avatarSrc={props.avatarSrc}
            handleRef={farmRef}
            showGoose={showGoose}
            onOpenGoose={() => setOpen("goose")}
            onOpenBasket={() => setOpen("basket")}
            basketOnFarm={basketOnFarm}
            submissionBoxRole={submissionBox}
            tutorialActive={tutorial.active}
            tutorialTreeId={tutorial.tutorialTreeId}
            hasMail={props.kudoseeds.length > 0 && mailKey !== mailReadKey}
            onOpenMail={openMailbox}
            seasonSlot={seasonChip}
            notificationSlot={
              <>
                <NotificationCenter notifications={buildNotifications(props, seedNotifId)} />
                <WikiHelp />
              </>
            }
          />
        ) : location === "store" ? (
          <StoreScene
            state={props.store}
            avatarSrc={props.avatarSrc}
            onOpenLottery={() => setOpen("lottery")}
            notificationSlot={
              <>
                <NotificationCenter notifications={buildNotifications(props, seedNotifId)} />
                <WikiHelp />
              </>
            }
          />
        ) : location === "lake" ? (
          <FishingScene
            avatarSrc={props.avatarSrc}
            fishInventory={props.fishInventory}
            fishDifficultyPercent={props.fishDifficultyPercent}
            notificationSlot={
              <>
                <NotificationCenter notifications={buildNotifications(props, seedNotifId)} />
                <WikiHelp />
              </>
            }
          />
        ) : props.garden ? (
          <GardenScene
            state={props.garden}
            myWater={props.farm.water}
            mySeeds={props.farm.seeds}
            myFertilizer={props.farm.fertilizer}
            avatarSrc={props.avatarSrc}
            notificationSlot={
              <>
                <NotificationCenter notifications={buildNotifications(props, seedNotifId)} />
                <WikiHelp />
              </>
            }
          />
        ) : (
          <p className="text-sm text-[var(--rf-ink-soft)]">
            The Community Garden isn’t set up yet.
          </p>
        )}
      </div>

      {/* Season-end ceremony invitation (once per season, own farm only) —
          held back while the mandatory tutorial is running. */}
      {props.ceremonyInvite && !traveling && !tutorial.active && (
        <CeremonyInvitePopup invite={props.ceremonyInvite} />
      )}

      {/* Travel cinematic between locations */}
      {traveling && (
        <TravelCinematic
          farmerSrc={props.avatarSrc}
          destinationLabel={LOCATION_LABELS[traveling]}
          onDone={() => {
            setLocation(traveling);
            setTraveling(null);
          }}
        />
      )}

      {/* Window over the farm */}
      {open && (
        <GameWindow title={windowTitle[open]} onClose={() => setOpen(null)}>
          {open === "inventory" && (
            <InventoryPanel farm={props.farm} onUseItem={useItemFromBackpack} />
          )}
          {open === "code" && <CodeForm />}
          {open === "map" && (
            <MapModalBody
              onOpenGarden={() => travel("garden")}
              onOpenStore={() => travel("store")}
              onOpenLake={() => travel("lake")}
              onGoHome={() => travel("farm")}
              canFish={props.canFish}
            />
          )}
          {open === "lottery" &&
            (props.lottery ? (
              <LotteryPanel state={props.lottery} myCoins={props.farm.coins} />
            ) : (
              <p className="text-sm text-[var(--rf-ink-soft)]">
                The Weekly Orchard Lottery isn’t set up yet.
              </p>
            ))}
          {open === "seed" && (
            <SeedPanel
              members={props.members}
              sentToday={props.sentToday}
              sentToName={props.sentToName}
            />
          )}
          {open === "mail" && (
            <MailPanel
              kudoseeds={props.kudoseeds}
              sentToday={props.sentToday}
              onSend={() => setOpen("seed")}
            />
          )}
          {open === "basket" &&
            (props.basket ? (
              <BasketPanel
                state={props.basket}
                myWater={props.farm.water}
                mySeeds={props.farm.seeds}
                myFertilizer={props.farm.fertilizer}
                myCoins={props.farm.coins}
              />
            ) : (
              <p className="text-sm text-[var(--rf-ink-soft)]">
                The Traveling Basket isn’t set up yet.
              </p>
            ))}
          {open === "goose" &&
            (props.goose ? (
              <GoosePanel state={props.goose} />
            ) : (
              <p className="text-sm text-[var(--rf-ink-soft)]">
                The Golden Goose isn’t set up yet.
              </p>
            ))}
          {open === "checklist" && <ChecklistPanel checklist={props.checklist} />}
          {open === "leaderboard" && <LeaderboardPanel rows={props.leaderboard} />}
          {open === "profile" && (
            <ProfilePanel
              profile={props.profile}
              houseKey={props.houseKey}
              houseNames={props.houseNames}
            />
          )}
        </GameWindow>
      )}

      {/* Fixed bottom game menu */}
      {/* z-[60] keeps the menu tappable above an open window's backdrop, so
          tapping another icon switches panels directly (mobile-game feel). */}
      <nav
        aria-label="Game menu"
        className="rf-fixed-game-w fixed bottom-0 z-[60]"
        style={{
          background: "var(--rf-grass)",
          borderTop: "3px solid var(--rf-ink)",
          // keep the menu clear of the iPhone home indicator
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <div className="mx-auto flex items-stretch justify-around px-1 py-1.5">
          {menu.map((m) => {
            const active = m.id !== "home" && open === m.id;
            return (
              <button
                key={m.id}
                type="button"
                data-tutorial={m.id === "leaderboard" ? "menu-leaderboard" : undefined}
                aria-label={m.label}
                aria-pressed={active}
                onClick={() => {
                  if (m.id === "home") {
                    // "Farm" always brings you home — traveling back if you're
                    // out at the Community Garden.
                    if (location !== "farm") travel("farm");
                    else setOpen(null);
                    return;
                  }
                  if (m.id === "checklist") markGoalsSeen();
                  setOpen(active ? null : (m.id as PanelId));
                }}
                className="ui-btn-plate relative flex min-w-0 flex-1 flex-col items-center justify-end gap-0.5 px-0.5 py-1"
              >
                {m.id === "checklist" && hasNewGoal && (
                  <span
                    aria-label="A goal was completed"
                    className="rf-throb absolute right-1 top-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-[var(--rf-ink)] bg-[var(--rf-gold)] text-[9px] font-black leading-none text-[var(--rf-ink)]"
                  >
                    !
                  </span>
                )}
                <span className="flex h-8 items-end justify-center">{m.icon}</span>
                <span className="text-[9px] font-extrabold uppercase tracking-wide">
                  {m.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* "You received …" banners, styled like the travel plate */}
      <RewardBannerHost />

      {/* The single Guidebook panel (every "?" button + deep links route here) */}
      <WikiRoot canReplayTutorial={props.tutorial.completed} />

      {/* First-time feature guide popup (after the tutorial is done) */}
      {featureToShow && (
        <FeatureGuidePopup
          feature={featureToShow}
          onSeen={() => {
            setSeenLocal((s) => new Set(s).add(featureToShow));
            setFeatureToShow(null);
          }}
        />
      )}

      {/* The mandatory first-time tutorial (coach marks over the farm) */}
      {tutorial.overlay}
    </div>
  );
}

/**
 * Derive notifications from current app state (MVP — no notification table).
 * Ids embed the relevant counts/ids so a dismissed notification resurfaces
 * only when the underlying state actually changes.
 */
function buildNotifications(props: GameShellProps, seedNotifId: string): FarmNotification[] {
  const out: FarmNotification[] = [];

  if (props.farm.seeds > 0) {
    out.push({
      // Daily id (+ a 0→positive "cycle" bump) — dismissing it holds for the
      // whole day and count changes don't resurface it.
      id: seedNotifId,
      text:
        props.farm.seeds === 1
          ? "You received a KudoSeed — it’s ready to plant. 🌰"
          : `You have ${props.farm.seeds} KudoSeeds ready to plant. 🌰`,
    });
  }

  // A KudoSeed with a note is worth surfacing on its own.
  for (const k of props.kudoseeds) {
    if (!k.message) continue;
    out.push({
      id: `kudo-${k.given_on_date}-${k.from}`,
      text: `${k.from} sent you a KudoSeed: “${k.message}”`,
    });
  }

  const ready = props.trees.filter((t) => t.stage === 5).length;
  if (ready > 0) {
    out.push({
      id: `ready-${ready}`,
      text:
        ready === 1
          ? "A tree is ready to harvest. 🧺"
          : `${ready} trees are ready to harvest. 🧺`,
    });
  }

  for (const goal of props.checklist) {
    if (goal.completed) {
      out.push({
        id: `goal-${goal.key}`,
        text: `Goal reached: ${goal.name}. Your farm got a little boost. ✨`,
      });
    }
  }

  const b = props.basket;
  if (b?.has_chain && b.status === "active") {
    // Basket day begins: everyone hears about it once.
    out.push({
      id: `basket-day-${b.chain_id}`,
      text: "The Traveling Basket is moving today. It may come your way.",
    });
    if (b.i_hold_it) {
      out.push({
        id: `basket-held-${b.chain_id}`,
        text: "The Traveling Basket is in your hands! Keep it or pass it along.",
      });
    } else if (b.holder_username) {
      // The basket moved — the id embeds the holder, so each pass is new.
      out.push({
        id: `basket-pass-${b.chain_id}-${b.holder_username}`,
        text: `The Traveling Basket was passed to @${b.holder_username}.`,
      });
    }
  }
  if (b?.my_rewards && b.my_rewards.length > 0) {
    out.push({
      id: `basket-reward-${b.chain_id}`,
      text: "The Traveling Basket brought you a little gift. 🧺",
    });
  }

  // Golden Goose
  const g = props.goose;
  if (g?.has_event) {
    if (g.my_rewards.some((r) => r.reason.startsWith("golden_goose_egg"))) {
      out.push({
        id: `goose-egg-${g.assignment_id}`,
        text: "Your answer won the Golden Goose Egg — a seed, fertilizer, water, and a few Coins! 🥚",
      });
    }
    // Day 1: everyone is told to look for the question in the group chat…
    if (g.status === "answer_collection") {
      out.push({
        id: `goose-day1-${g.assignment_id}`,
        text: "The Golden Goose is visiting! Check the group chat for today’s question, then drop your answer in the Submission Box on your farm.",
      });
    }
    // …and the Keeper is told to post it there.
    if (g.i_am_keeper && g.status === "answer_collection") {
      out.push({
        id: `goose-keeper-${g.assignment_id}`,
        text: "You’re the Golden Goose Keeper! Post your question in the group chat — then tap the goose on your farm.",
      });
    }
    if (g.i_am_keeper && g.status === "selection_open") {
      out.push({
        id: `goose-pick-${g.assignment_id}`,
        text: "It’s time to pick your favorite Golden Goose answer before the goose flies away.",
      });
    }
    if (!g.i_am_keeper && g.status === "answer_collection" && !g.i_submitted) {
      out.push({
        id: `goose-open-${g.assignment_id}`,
        text: "A Golden Goose Request is open — check the chat, then submit your answer.",
      });
    }
  }

  // Community Garden
  const cg = props.garden;
  if (cg?.has_event) {
    // event started: everyone hears about it once per event
    out.push({
      id: `garden-open-${cg.event_id}`,
      text: "The Community Garden is open this week. Everyone’s care helps it grow. 🌳",
    });
    // milestone notifications (ids embed the threshold, so each fires once)
    const pct = cg.progress_percent;
    if (!cg.completed && pct >= 25 && pct < 50) {
      out.push({
        id: `garden-ms-${cg.event_id}-25`,
        text: "The Community Tree is starting to sprout. 🌱",
      });
    }
    if (!cg.completed && pct >= 50 && pct < 75) {
      out.push({
        id: `garden-ms-${cg.event_id}-50`,
        text: "The Community Tree is growing tall. 🌿",
      });
    }
    if (!cg.completed && pct >= 75) {
      out.push({
        id: `garden-ms-${cg.event_id}-75`,
        text: "The Community Tree is almost blooming. ✨",
      });
    }
    if (cg.completed) {
      out.push({
        id: `garden-bloom-${cg.event_id}`,
        text: "The Community Garden bloomed! Contributors received a Garden Share Bundle. 🌸",
      });
    }
    if (cg.my_rewards.length > 0) {
      out.push({
        id: `garden-reward-${cg.event_id}`,
        text: "Your Garden Share Bundle arrived — check your items. 🧺",
      });
    }
  } else if (cg?.last_event && cg.last_event.status !== "active") {
    // the week wrapped up (gentle, once per event)
    if (cg.last_event.status === "expired") {
      out.push({
        id: `garden-ended-${cg.last_event.event_id}`,
        text: "The Community Garden wrapped up for the week. Every bit of care helped. 🌱",
      });
    }
    if (cg.last_event.my_rewards.length > 0) {
      out.push({
        id: `garden-reward-${cg.last_event.event_id}`,
        text: "Your Garden Share Bundle arrived — check your items. 🧺",
      });
    }
  }

  // Weekly Orchard Lottery
  const lot = props.lottery;
  if (lot?.enabled && lot.round) {
    const r = lot.round;
    if (r.sales_open && r.my_tickets === 0) {
      out.push({
        id: `lottery-open-${r.round_id}`,
        text: "A new Weekly Orchard Lottery is open. 🎟️",
      });
    }
    if (!r.sales_open && ["open", "sales_closed"].includes(r.status) && r.my_tickets > 0) {
      out.push({
        id: `lottery-soon-${r.round_id}`,
        text: `Sunday’s drawing is coming up. You have ${r.my_tickets} ${r.my_tickets === 1 ? "ticket" : "tickets"} entered.`,
      });
    }
  }
  const lr = lot?.last_result;
  if (lr) {
    if (lr.status === "drawn" && lr.i_won) {
      out.push({
        id: `lottery-won-${lr.round_id}`,
        text: `Your ticket was drawn! You received 🪙 ${lr.final_prize_coins}. 🎉`,
      });
    } else if (lr.status === "drawn" && lr.i_entered) {
      out.push({
        id: `lottery-result-${lr.round_id}`,
        text: `Sunday’s drawing is complete. This week’s prize was 🪙 ${lr.final_prize_coins}.`,
      });
    } else if (lr.status === "refunded_single_participant" && lr.i_was_refunded) {
      out.push({
        id: `lottery-refund-${lr.round_id}`,
        text: `You were the only farmer entered, so your 🪙 ${lr.my_coins_back} were returned.`,
      });
    } else if (lr.status === "cancelled" && lr.i_was_refunded) {
      out.push({
        id: `lottery-cancel-${lr.round_id}`,
        text: `The lottery round was cancelled — your 🪙 ${lr.my_coins_back} were returned.`,
      });
    } else if (lr.status === "no_entries" && lot?.round?.round_id === lr.round_id) {
      out.push({
        id: `lottery-none-${lr.round_id}`,
        text: "No tickets were entered this week. A new drawing opens soon.",
      });
    }
  }

  return out;
}

/** Small game window: a bottom sheet inside the phone-width game frame.
 *  Every player panel lives within --game-w — never the full desktop width —
 *  so the game reads as one contained mobile experience everywhere. */
function GameWindow({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div
        className="ui-frame rf-fixed-game-w absolute bottom-16 flex max-h-[72vh] flex-col bg-[var(--rf-cream)] p-0 sm:max-h-[76vh]"
      >
        <div
          className="flex items-center justify-between px-4 py-2"
          style={{ borderBottom: "2px solid var(--rf-ink)" }}
        >
          <h2 className="pixel-heading text-base">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close window"
            className="rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-2 py-0.5 text-xs font-extrabold hover:bg-[var(--rf-gold)]"
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

