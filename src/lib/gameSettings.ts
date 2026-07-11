/**
 * Game settings — the single source of truth for tunable game parameters.
 *
 * Defaults live HERE, in code. The database `game_settings` table stores only
 * admin OVERRIDES: a key present in the DB means "customized"; absent means
 * "use the built-in default below". The SQL function `update_game_settings`
 * mirrors this key list and validates every write server-side (rewards can
 * only be water/seed/fertilizer — never Fruits; amounts can't go negative;
 * schedule values are range-checked).
 *
 * IMPORTANT: keep this list in sync with the allowed-key arrays in the LATEST
 * migration that recreates update_game_settings (currently
 * supabase/migrations/20260709230000_coins.sql).
 */

export const REWARD_TYPES = ["water", "seed", "fertilizer"] as const;
export type RewardType = (typeof REWARD_TYPES)[number];

export const SCHEDULE_MODES = ["random", "specific"] as const;
export type ScheduleMode = (typeof SCHEDULE_MODES)[number];

/** Community Garden cadence. TODO(garden-monthly): add "monthly" when built. */
export const GARDEN_FREQUENCIES = ["weekly", "manual"] as const;
export type GardenFrequency = (typeof GARDEN_FREQUENCIES)[number];

/** 0 = Sunday … 6 = Saturday (matches JS Date.getDay). */
export const WEEKDAYS = [
  { value: 0, short: "Sun", label: "Sunday" },
  { value: 1, short: "Mon", label: "Monday" },
  { value: 2, short: "Tue", label: "Tuesday" },
  { value: 3, short: "Wed", label: "Wednesday" },
  { value: 4, short: "Thu", label: "Thursday" },
  { value: 5, short: "Fri", label: "Friday" },
  { value: 6, short: "Sat", label: "Saturday" },
] as const;

export type SettingKind =
  | "reward_type"
  | "schedule_mode"
  | "garden_frequency"
  | "days_per_week"
  | "enabled_days"
  | "boolean"
  | "number"
  | "text";

export type SettingValue = RewardType | ScheduleMode | number | boolean | number[] | string;

export type SettingDef = {
  key: string;
  label: string;
  kind: SettingKind;
  default: SettingValue;
  help?: string;
  /** Client-side clamp for number inputs (server re-validates). */
  min?: number;
  max?: number;
};

export type SettingSection = {
  id: string;
  title: string;
  blurb?: string;
  /** Named sub-groups of fields, rendered as small clusters. */
  groups: { title: string; keys: string[] }[];
};

/**
 * Every tunable setting. `default` reproduces today's live economy exactly, so
 * an untouched install behaves identically to before this feature existed.
 */
export const SETTING_DEFS: SettingDef[] = [
  // --- Rewards (existing mechanics) ---------------------------------------
  {
    key: "meeting_attendance_reward_type",
    label: "Meeting attendance — reward type",
    kind: "reward_type",
    default: "water",
    help: "Amount takes effect immediately; type is honored by future/basket/goose mechanics.",
  },
  { key: "meeting_attendance_reward_amount", label: "Meeting attendance — amount", kind: "number", default: 10 },
  { key: "hosting_reward_type", label: "Hosting a meeting — reward type", kind: "reward_type", default: "water" },
  { key: "hosting_reward_amount", label: "Hosting a meeting — amount", kind: "number", default: 10 },
  { key: "giving_seed_reward_type", label: "Giving a Seed — giver reward type", kind: "reward_type", default: "water" },
  { key: "giving_seed_reward_amount", label: "Giving a Seed — giver amount", kind: "number", default: 10 },
  { key: "receiving_seed_reward_type", label: "Receiving a Seed — reward type", kind: "reward_type", default: "seed" },
  { key: "receiving_seed_reward_amount", label: "Receiving a Seed — amount", kind: "number", default: 1 },
  {
    key: "receiving_seed_bonus_water",
    label: "Receiving a Seed — bonus water",
    kind: "number",
    default: 0,
    help: "Optional extra water for the receiver, on top of the planted Seed.",
  },

  // --- House / barn display names (admin-renamable) -------------------------
  { key: "house_name_house_1", label: "House 1 name", kind: "text", default: "Cozy Cottage" },
  { key: "house_name_house_2", label: "House 2 name", kind: "text", default: "Old Barn" },
  { key: "house_name_house_3", label: "House 3 name", kind: "text", default: "Thatched Home" },
  { key: "house_name_house_4", label: "House 4 name", kind: "text", default: "Forest Lodge" },
  { key: "house_name_house_5", label: "House 5 name", kind: "text", default: "Bando Barn" },
  { key: "house_name_house_6", label: "House 6 name", kind: "text", default: "Blue Bungalow" },

  // --- Season cycle (admin-renamable names + per-season lengths) ------------
  { key: "season_name_1", label: "Season 1 name", kind: "text", default: "Sparch" },
  { key: "season_name_2", label: "Season 2 name", kind: "text", default: "Maypril" },
  { key: "season_name_3", label: "Season 3 name", kind: "text", default: "Junduly" },
  { key: "season_name_4", label: "Season 4 name", kind: "text", default: "Suntember" },
  { key: "season_name_5", label: "Season 5 name", kind: "text", default: "Octobrrr" },
  { key: "season_length_days_1", label: "Season 1 length (days)", kind: "number", default: 30, min: 1, max: 365 },
  { key: "season_length_days_2", label: "Season 2 length (days)", kind: "number", default: 30, min: 1, max: 365 },
  { key: "season_length_days_3", label: "Season 3 length (days)", kind: "number", default: 30, min: 1, max: 365 },
  { key: "season_length_days_4", label: "Season 4 length (days)", kind: "number", default: 30, min: 1, max: 365 },
  { key: "season_length_days_5", label: "Season 5 length (days)", kind: "number", default: 30, min: 1, max: 365 },

  // --- Trees / harvest ------------------------------------------------------
  {
    key: "blossom_chance_percent",
    label: "Pink blossom chance (%)",
    kind: "number",
    default: 15,
    max: 100,
    help: "Chance a tree becomes a rare pink blossom when it finishes growing (0–100).",
  },
  {
    key: "blossom_fruit_multiplier",
    label: "Blossom fruit multiplier",
    kind: "number",
    default: 3,
    min: 1,
    help: "A blossom tree pays this many times the normal Fruits on harvest (3 = 30 Fruits). Blossom harvests also gift +1 Seed and +1 Fertilizer.",
  },

  // --- Traveling Basket (live mechanic) ------------------------------------
  {
    key: "basket_enabled",
    label: "Traveling Basket enabled",
    kind: "boolean",
    default: true,
    help: "Master switch. When off, no basket days happen at all.",
  },
  { key: "basket_schedule_mode", label: "Basket schedule mode", kind: "schedule_mode", default: "random" },
  { key: "basket_random_days_per_week", label: "Basket — random days / week", kind: "days_per_week", default: 3 },
  { key: "basket_enabled_days", label: "Basket — specific days", kind: "enabled_days", default: [] },
  {
    key: "basket_hold_hours",
    label: "Hold time before auto-pass (hours)",
    kind: "number",
    default: 24,
    min: 1,
    help: "If the holder doesn’t act within this window, the basket auto-passes.",
  },
  {
    key: "basket_auto_pass_water",
    label: "Auto-pass / minimum-to-receive water",
    kind: "number",
    default: 5,
    help: "Water taken on a timed-out auto-pass. Also the minimum water a farmer needs to be able to receive the basket.",
  },
  {
    key: "basket_small_target_count",
    label: "Small basket — farmers to lock in",
    kind: "number",
    default: 5,
    min: 2,
    help: "The common basket size.",
  },
  {
    key: "basket_large_target_count",
    label: "Large basket — farmers to lock in",
    kind: "number",
    default: 10,
    min: 2,
    help: "The rare big basket.",
  },
  {
    key: "basket_large_basket_chance_percent",
    label: "Large basket chance (%)",
    kind: "number",
    default: 15,
    max: 100,
    help: "Chance each basket day rolls the big basket (0–100).",
  },
  {
    key: "basket_keep_multiplier",
    label: "Keep multiplier",
    kind: "number",
    default: 2,
    min: 1,
    help: "Keeping the basket awards contents × this.",
  },
  { key: "basket_max_water_per_pass", label: "Basket — max water per person (total)", kind: "number", default: 25 },
  { key: "basket_max_seed_per_pass", label: "Basket — max seed per person (total)", kind: "number", default: 1 },
  { key: "basket_max_fertilizer_per_pass", label: "Basket — max fertilizer per person (total)", kind: "number", default: 2 },
  { key: "basket_max_coin_per_pass", label: "Basket — max coins per person (total)", kind: "number", default: 25 },

  // --- Golden Goose (planned mechanic; settings only) ---------------------
  {
    key: "goose_enabled",
    label: "Golden Goose enabled",
    kind: "boolean",
    default: true,
    help: "Master switch. When off, no Golden Goose events happen.",
  },
  { key: "goose_schedule_mode", label: "Goose schedule mode", kind: "schedule_mode", default: "random" },
  { key: "goose_random_days_per_week", label: "Goose — random days / week", kind: "days_per_week", default: 7 },
  { key: "goose_enabled_days", label: "Goose — specific days", kind: "enabled_days", default: [] },
  { key: "goose_answer_collection_hours", label: "Goose — answer collection (hours)", kind: "number", default: 24 },
  { key: "goose_selection_hours", label: "Goose — selection window (hours)", kind: "number", default: 24 },
  { key: "goose_total_cycle_hours", label: "Goose — total cycle (hours)", kind: "number", default: 48 },
  {
    key: "goose_exclusion_months_on_missed_selection",
    label: "Goose — exclusion on missed selection (months)",
    kind: "number",
    default: 2,
  },
  { key: "goose_egg_seed_amount", label: "Goose egg — seed amount", kind: "number", default: 1 },
  { key: "goose_egg_fertilizer_amount", label: "Goose egg — fertilizer amount", kind: "number", default: 1 },
  { key: "goose_egg_water_amount", label: "Goose egg — water amount", kind: "number", default: 10 },
  { key: "goose_keeper_completion_reward_type", label: "Goose keeper completion — reward type", kind: "reward_type", default: "fertilizer" },
  { key: "goose_keeper_completion_reward_amount", label: "Goose keeper completion — amount", kind: "number", default: 1 },
  { key: "goose_auto_select_enabled", label: "Goose auto-select enabled", kind: "boolean", default: true },
  { key: "goose_pass_enabled", label: "Goose pass enabled", kind: "boolean", default: true },
  {
    key: "goose_opt_in_required_for_private_users",
    label: "Goose — opt-in required for private users",
    kind: "boolean",
    default: true,
  },

  // --- Community Garden (collaborative shared event) ------------------------
  {
    key: "garden_enabled",
    label: "Community Garden enabled",
    kind: "boolean",
    default: true,
    help: "Master switch. When off, no garden events start (an already-active one still finishes).",
  },
  {
    key: "garden_frequency",
    label: "Garden — event frequency",
    kind: "garden_frequency",
    default: "weekly",
    help: "Weekly starts a garden every Monday and ends it Sunday. Manual means admins start each event by hand.",
  },
  {
    key: "garden_event_duration_days",
    label: "Garden — manual event length (days)",
    kind: "number",
    default: 7,
    min: 1,
    help: "How long an admin-started (manual) garden runs. Weekly gardens always end on Sunday.",
  },
  { key: "garden_required_water", label: "Garden goal — water", kind: "number", default: 250, min: 1 },
  { key: "garden_required_seeds", label: "Garden goal — seeds", kind: "number", default: 25, min: 1 },
  { key: "garden_required_fertilizer", label: "Garden goal — fertilizer", kind: "number", default: 25, min: 1 },
  { key: "garden_daily_water_limit", label: "Daily limit — water per person", kind: "number", default: 50 },
  { key: "garden_daily_seed_limit", label: "Daily limit — seeds per person", kind: "number", default: 3 },
  { key: "garden_daily_fertilizer_limit", label: "Daily limit — fertilizer per person", kind: "number", default: 3 },
  { key: "garden_reward_water", label: "Garden Share Bundle — water", kind: "number", default: 50 },
  { key: "garden_reward_seeds", label: "Garden Share Bundle — seeds", kind: "number", default: 4 },
  { key: "garden_reward_fertilizer", label: "Garden Share Bundle — fertilizer", kind: "number", default: 2 },
  { key: "garden_reward_coins", label: "Garden Share Bundle — coins", kind: "number", default: 30 },
  {
    key: "garden_partial_reward_enabled",
    label: "Partial reward enabled",
    kind: "boolean",
    default: false,
    help: "When on, a garden that doesn’t fully bloom but reaches the threshold still gives contributors a small thank-you.",
  },
  {
    key: "garden_partial_threshold_percent",
    label: "Partial reward threshold (%)",
    kind: "number",
    default: 50,
    max: 100,
  },
  { key: "garden_partial_reward_water", label: "Partial reward — water", kind: "number", default: 10 },
  { key: "garden_partial_reward_coins", label: "Partial reward — coins", kind: "number", default: 5 },
  {
    key: "garden_show_names",
    label: "Show contributor names in the garden",
    kind: "boolean",
    default: true,
    help: "When off, everyone in the garden appears as “A neighbor”. Anonymous and hidden farmers are never named either way.",
  },
  {
    key: "garden_private_users_can_contribute",
    label: "Private users can contribute",
    kind: "boolean",
    default: true,
    help: "When on, anonymous/hidden farmers can still add supplies (they appear anonymously or not at all).",
  },

  // --- General Store (🏪 purchases spend Coins; never Fruits) --------------
  {
    key: "store_enabled",
    label: "General Store enabled",
    kind: "boolean",
    default: true,
    help: "Master switch. When off, the register is closed (the location still exists).",
  },
  {
    key: "store_water_amount",
    label: "Water bundle size",
    kind: "number",
    default: 25,
    min: 5,
    help: "How much Water one purchase grants. Must be a multiple of 5 (the app-wide water rule).",
  },
  // Prices are 50% above the original launch numbers (10/30/50/40) so Coins
  // stay meaningful now that several mechanics pay them out.
  { key: "store_water_price", label: "Water bundle price (coins)", kind: "number", default: 15, min: 1 },
  { key: "store_fertilizer_price", label: "Fertilizer price (coins)", kind: "number", default: 45, min: 1 },
  { key: "store_seed_price", label: "Seed price (coins)", kind: "number", default: 75, min: 1 },
  { key: "store_goose_entry_price", label: "Xtra Goose Entry price (coins)", kind: "number", default: 60, min: 1 },
  {
    key: "store_sale_enabled",
    label: "Daily sale enabled",
    kind: "boolean",
    default: true,
    help: "One random item per day at a 10–40% discount (deeper discounts are rarer).",
  },
  { key: "store_sale_min_percent", label: "Sale discount — minimum (%)", kind: "number", default: 10, max: 100 },
  { key: "store_sale_max_percent", label: "Sale discount — maximum (%)", kind: "number", default: 40, max: 100 },

  // --- Coins (🪙 spendable currency; never leaderboard score) --------------
  {
    key: "medal_coin_gold",
    label: "Gold medal — coins",
    kind: "number",
    default: 100,
    help: "Ceremony coin reward for 1st place (on top of the medal + fertilizer).",
  },
  { key: "medal_coin_silver", label: "Silver medal — coins", kind: "number", default: 60 },
  { key: "medal_coin_bronze", label: "Bronze medal — coins", kind: "number", default: 35 },
  {
    key: "coin_bonus_seed",
    label: "Coin bonus — rewards that give Seeds",
    kind: "number",
    default: 5,
    help: "Any reward that grants Seeds (Goose Egg, receiving the daily Seed) also grants this many Coins.",
  },
  {
    key: "reward_coin_bonus",
    label: "Coins paid with EVERY reward",
    kind: "number",
    default: 5,
    help: "A flat coin bonus added to every reward (meetings, KudoSeeds, basket, goose egg…). Rewards with their own coin amount — ceremony medals, garden bundles, checklist goals — use theirs instead and never stack this.",
  },
  {
    key: "coin_bonus_fertilizer",
    label: "Coin bonus — rewards that give Fertilizer",
    kind: "number",
    default: 10,
    help: "Any reward that grants Fertilizer (Goose Egg, Keeper completion, checklist goals, badges) also grants this many Coins. Medals use their own coin amounts instead.",
  },

  // --- Weekly Orchard Lottery (🎟️ Coins only — never Water/Seeds/Fert/Fruits)
  {
    key: "lottery_enabled",
    label: "Weekly Orchard Lottery enabled",
    kind: "boolean",
    default: true,
    help: "Master switch. When off, no new rounds open and tickets can't be bought.",
  },
  {
    key: "lottery_ticket_price_coins",
    label: "Ticket price (coins)",
    kind: "number",
    default: 20,
    min: 1,
    help: "Snapshotted onto each round when it opens — changes apply to future rounds.",
  },
  {
    key: "lottery_max_tickets_per_user",
    label: "Max tickets per farmer",
    kind: "number",
    default: 3,
    min: 1,
    max: 10,
    help: "Per weekly round. Hard cap 10.",
  },
  {
    key: "lottery_draw_weekday",
    label: "Drawing weekday (0=Sun … 6=Sat)",
    kind: "number",
    default: 0,
    max: 6,
    help: "Default Sunday. Values outside 0–6 are clamped when the round is created.",
  },
  {
    key: "lottery_draw_time",
    label: "Drawing time (HH:MM, 24h)",
    kind: "text",
    default: "18:00",
    help: "Local to the lottery timezone. Unparseable values fall back to 18:00.",
  },
  {
    key: "lottery_timezone",
    label: "Lottery timezone",
    kind: "text",
    default: "America/Los_Angeles",
    help: "IANA name (e.g. America/New_York). Unknown zones fall back to America/Los_Angeles.",
  },
  {
    key: "lottery_sales_cutoff_minutes",
    label: "Sales cutoff before drawing (minutes)",
    kind: "number",
    default: 15,
  },
  {
    key: "lottery_orchard_bonus_percent",
    label: "Orchard bonus (%)",
    kind: "number",
    default: 25,
    max: 100,
    help: "Added to the player-funded pot at the draw: bonus = floor(pot × % / 100). Snapshotted per round.",
  },
  {
    key: "lottery_auto_draw_enabled",
    label: "Automatic Sunday resolution",
    kind: "boolean",
    default: true,
    help: "The 10-minute game tick resolves due rounds. When off, use Force resolve in the Lottery tab.",
  },
  { key: "lottery_show_ticket_count", label: "Show total ticket count", kind: "boolean", default: true },
  { key: "lottery_show_participant_count", label: "Show farmers-entered count", kind: "boolean", default: true },
  { key: "lottery_show_pot", label: "Show pot & prize preview", kind: "boolean", default: true },
  {
    key: "lottery_show_winner_publicly",
    label: "Show the winner publicly",
    kind: "boolean",
    default: true,
    help: "When off, only the winner is told they won. Private-mode farmers always appear as “A farmer”.",
  },
  {
    key: "lottery_big_win_threshold",
    label: "“Big Orchard Win” badge threshold (coins)",
    kind: "number",
    default: 200,
    help: "A win at or above this prize counts toward the Big Orchard Win ceremony badge.",
  },

  // --- Fishing (Phase 1 preview) -------------------------------------------
  { key: "fishing_enabled", label: "Fishing enabled", kind: "boolean", default: true, help: "Master switch for the whole fishing module." },
  { key: "fishing_admin_only", label: "Admin only", kind: "boolean", default: true, help: "While on, only admins can reach the Fishing Lake, catch, or sell (preview mode)." },
  { key: "fish_sell_percent", label: "Fish sell multiplier (%)", kind: "number", default: 100, help: "Coins paid when selling fish, as a % of each fish's base value (100 = normal)." },
  { key: "fish_difficulty_percent", label: "Catch difficulty (%)", kind: "number", default: 100, help: "Higher = the catch meter drains faster when the fish escapes the bar (100 = normal)." },
  { key: "fishing_legendary_chance_percent", label: "Legendary chance (%)", kind: "number", default: 2, max: 100, help: "Chance a cast hooks a Legendary fish." },
  // Future placeholders — settings only; the mechanics are NOT built yet.
  { key: "fishing_seasonal_fish_enabled", label: "Seasonal fish (coming soon)", kind: "boolean", default: false, help: "Placeholder for a future update — no effect yet." },
  { key: "fishing_weather_enabled", label: "Weather effects (coming soon)", kind: "boolean", default: false, help: "Placeholder for a future update — no effect yet." },
  { key: "fishing_rod_durability_enabled", label: "Rod durability (coming soon)", kind: "boolean", default: false, help: "Placeholder for a future update — no effect yet." },

  // --- Debug (admin testing tools; off by default) -------------------------
  {
    key: "debug_settings_enabled",
    label: "Enabled Debug Settings",
    kind: "boolean",
    default: false,
    help: "When on, a Debug tab with admin-only testing tools appears in the admin console. Leave off in normal play.",
  },
];

/** How the Game Settings UI is grouped into tabs/sections. */
export const SETTING_SECTIONS: SettingSection[] = [
  {
    id: "houses",
    title: "House & barn names",
    blurb: "Display names for the selectable farmhouses. Players keep their selection; only the label changes.",
    groups: [
      { title: "Names", keys: ["house_name_house_1", "house_name_house_2", "house_name_house_3", "house_name_house_4", "house_name_house_5", "house_name_house_6"] },
    ],
  },
  {
    id: "seasons",
    title: "Seasons",
    blurb:
      "Five seasons cycle forever: Sparch → Maypril → Junduly → Suntember → Octobrrr → back to Sparch. Every community starts on season 1. Name and length edits apply to the season currently running (its end date is recomputed from its start).",
    groups: [
      { title: "Names", keys: ["season_name_1", "season_name_2", "season_name_3", "season_name_4", "season_name_5"] },
      { title: "Lengths (days)", keys: ["season_length_days_1", "season_length_days_2", "season_length_days_3", "season_length_days_4", "season_length_days_5"] },
    ],
  },
  {
    id: "trees",
    title: "Trees & harvest",
    blurb: "Pink blossom trees are a rare bonus — they pay double Fruits on harvest, then revert to green. Fruits still come only from harvesting.",
    groups: [{ title: "Blossom", keys: ["blossom_chance_percent", "blossom_fruit_multiplier"] }],
  },
  {
    id: "rewards",
    title: "Reward settings",
    blurb: "Amounts take effect immediately. Rewards can only be water, seed, or fertilizer — never Fruits.",
    groups: [
      { title: "Meetings", keys: ["meeting_attendance_reward_type", "meeting_attendance_reward_amount", "hosting_reward_type", "hosting_reward_amount"] },
      { title: "Seeds", keys: ["giving_seed_reward_type", "giving_seed_reward_amount", "receiving_seed_reward_type", "receiving_seed_reward_amount", "receiving_seed_bonus_water"] },
    ],
  },
  {
    id: "basket",
    title: "Traveling Basket",
    blurb: "A community basket travels between farmers on basket days. Contents are only water, seeds, and fertilizer — never Fruits.",
    groups: [
      { title: "Schedule", keys: ["basket_enabled", "basket_schedule_mode", "basket_random_days_per_week", "basket_enabled_days", "basket_hold_hours"] },
      { title: "Basket size & behavior", keys: ["basket_small_target_count", "basket_large_target_count", "basket_large_basket_chance_percent", "basket_keep_multiplier", "basket_auto_pass_water"] },
      { title: "Contribution limits (per person, total)", keys: ["basket_max_water_per_pass", "basket_max_seed_per_pass", "basket_max_fertilizer_per_pass", "basket_max_coin_per_pass"] },
    ],
  },
  {
    id: "goose",
    title: "Golden Goose",
    blurb: "Planned mechanic — these settings are saved for the future feature to read. No gameplay is active yet.",
    groups: [
      { title: "Schedule", keys: ["goose_enabled", "goose_schedule_mode", "goose_random_days_per_week", "goose_enabled_days"] },
      { title: "Timing", keys: ["goose_answer_collection_hours", "goose_selection_hours", "goose_total_cycle_hours", "goose_exclusion_months_on_missed_selection"] },
      { title: "Egg reward", keys: ["goose_egg_seed_amount", "goose_egg_fertilizer_amount", "goose_egg_water_amount"] },
      { title: "Keeper + rules", keys: ["goose_keeper_completion_reward_type", "goose_keeper_completion_reward_amount", "goose_auto_select_enabled", "goose_pass_enabled", "goose_opt_in_required_for_private_users"] },
    ],
  },
  {
    id: "garden",
    title: "Community Garden",
    blurb:
      "The whole group tends ONE shared garden together — no winners, no leaderboard. Contributions spend water/seeds/fertilizer; the Garden Share Bundle pays only water/seeds/fertilizer — never Fruits.",
    groups: [
      { title: "Schedule", keys: ["garden_enabled", "garden_frequency", "garden_event_duration_days"] },
      { title: "Goals", keys: ["garden_required_water", "garden_required_seeds", "garden_required_fertilizer"] },
      { title: "Daily limits (per person)", keys: ["garden_daily_water_limit", "garden_daily_seed_limit", "garden_daily_fertilizer_limit"] },
      { title: "Completion reward", keys: ["garden_reward_water", "garden_reward_seeds", "garden_reward_fertilizer", "garden_reward_coins"] },
      { title: "Partial reward", keys: ["garden_partial_reward_enabled", "garden_partial_threshold_percent", "garden_partial_reward_water", "garden_partial_reward_coins"] },
      { title: "Privacy", keys: ["garden_show_names", "garden_private_users_can_contribute"] },
    ],
  },
  {
    id: "store",
    title: "General Store",
    blurb:
      "🏪 The shop on the map. Purchases spend Coins and grant Water/Seeds/Fertilizer or an Xtra Goose Entry — never Fruits. Water is sold in multiples of 5.",
    groups: [
      { title: "Store", keys: ["store_enabled", "store_water_amount"] },
      { title: "Prices (coins)", keys: ["store_water_price", "store_fertilizer_price", "store_seed_price", "store_goose_entry_price"] },
      { title: "Daily sale", keys: ["store_sale_enabled", "store_sale_min_percent", "store_sale_max_percent"] },
    ],
  },
  {
    id: "coins",
    title: "Coins",
    blurb:
      "🪙 Coins are a spendable currency for future shop goodies. They can be awarded directly (unlike Fruits) but never count toward the leaderboard — that still ranks harvested Fruits only.",
    groups: [
      { title: "Ceremony medals", keys: ["medal_coin_gold", "medal_coin_silver", "medal_coin_bronze"] },
      { title: "Automatic bonuses", keys: ["reward_coin_bonus", "coin_bonus_seed", "coin_bonus_fertilizer"] },
    ],
  },
  {
    id: "lottery",
    title: "Weekly Orchard Lottery",
    blurb:
      "🎟️ A weekly community drawing. Tickets and prizes are Coins ONLY — never Water, Seeds, Fertilizer, or Fruits, and no real money. Price, max tickets, bonus %, and schedule are snapshotted onto each round when it opens.",
    groups: [
      { title: "Round", keys: ["lottery_enabled", "lottery_ticket_price_coins", "lottery_max_tickets_per_user", "lottery_orchard_bonus_percent"] },
      { title: "Schedule", keys: ["lottery_draw_weekday", "lottery_draw_time", "lottery_timezone", "lottery_sales_cutoff_minutes", "lottery_auto_draw_enabled"] },
      { title: "Display & privacy", keys: ["lottery_show_ticket_count", "lottery_show_participant_count", "lottery_show_pot", "lottery_show_winner_publicly"] },
      { title: "Awards", keys: ["lottery_big_win_threshold"] },
    ],
  },
  {
    id: "fishing",
    title: "Fishing",
    blurb:
      "🎣 The Fishing Lake (Phase 1 preview). Cast → catch minigame → sell fish for Coins at the hut. Fish are a separate inventory and never touch Water/Seeds/Fertilizer/Fruits; sales pay Coins only. Admin-only while previewing.",
    groups: [
      { title: "Access", keys: ["fishing_enabled", "fishing_admin_only"] },
      { title: "Balance", keys: ["fish_sell_percent", "fish_difficulty_percent", "fishing_legendary_chance_percent"] },
      { title: "Coming soon (no effect yet)", keys: ["fishing_seasonal_fish_enabled", "fishing_weather_enabled", "fishing_rod_durability_enabled"] },
    ],
  },
  {
    id: "debug",
    title: "Debug",
    blurb:
      "Admin-only testing tools. Turn this on and save to reveal a Debug tab in the admin console; turn it off before normal play.",
    groups: [{ title: "Debug", keys: ["debug_settings_enabled"] }],
  },
];

/** Effective value of the debug switch from settings override rows. */
export function debugSettingsEnabled(
  overrides: Pick<SettingOverrideRow, "key" | "value_json">[],
): boolean {
  const o = overrides.find((r) => r.key === "debug_settings_enabled");
  return o ? o.value_json === true : false;
}

export const SETTING_DEFS_BY_KEY: Record<string, SettingDef> = Object.fromEntries(
  SETTING_DEFS.map((d) => [d.key, d]),
);

/** Just the defaults, as { key: value }. */
export const DEFAULT_GAME_SETTINGS: Record<string, SettingValue> = Object.fromEntries(
  SETTING_DEFS.map((d) => [d.key, d.default]),
);

/** DB rows as returned by get_game_settings(). value_json is already parsed. */
export type SettingOverrideRow = {
  key: string;
  value_json: SettingValue;
  updated_at: string;
  updated_by: string | null;
};

export type EffectiveSetting = {
  key: string;
  def: SettingDef;
  value: SettingValue;
  isCustomized: boolean;
};

/**
 * Merge code defaults with DB overrides. Overrides for unknown keys are
 * ignored (defense against stale rows). Returns one entry per known setting.
 */
export function mergeSettings(overrides: SettingOverrideRow[]): Record<string, EffectiveSetting> {
  const overrideMap = new Map(overrides.map((o) => [o.key, o.value_json]));
  const result: Record<string, EffectiveSetting> = {};
  for (const def of SETTING_DEFS) {
    const has = overrideMap.has(def.key);
    result[def.key] = {
      key: def.key,
      def,
      value: has ? (overrideMap.get(def.key) as SettingValue) : def.default,
      isCustomized: has,
    };
  }
  return result;
}

/**
 * Resolve house display names (house key → label) from settings override
 * rows: admin override if present, otherwise the built-in default.
 */
export function houseDisplayNames(
  overrides: Pick<SettingOverrideRow, "key" | "value_json">[],
): Record<string, string> {
  const names: Record<string, string> = {};
  for (const def of SETTING_DEFS) {
    if (!def.key.startsWith("house_name_")) continue;
    const houseKey = def.key.replace("house_name_", "");
    const o = overrides.find((r) => r.key === def.key);
    names[houseKey] =
      o && typeof o.value_json === "string" ? o.value_json : (def.default as string);
  }
  return names;
}

export function formatSettingValue(def: SettingDef, value: SettingValue): string {
  switch (def.kind) {
    case "boolean":
      return value ? "On" : "Off";
    case "enabled_days":
      return Array.isArray(value) && value.length
        ? (value as number[]).map((d) => WEEKDAYS[d]?.short ?? d).join(", ")
        : "None";
    default:
      return String(value);
  }
}
