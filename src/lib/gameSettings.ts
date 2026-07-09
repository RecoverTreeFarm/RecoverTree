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
 * supabase/migrations/20260709170000_named_season_cycle_and_close_repair.sql).
 */

export const REWARD_TYPES = ["water", "seed", "fertilizer"] as const;
export type RewardType = (typeof REWARD_TYPES)[number];

export const SCHEDULE_MODES = ["random", "specific"] as const;
export type ScheduleMode = (typeof SCHEDULE_MODES)[number];

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
    default: 2,
    min: 1,
    help: "A blossom tree pays this many times the normal Fruits on harvest.",
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
      { title: "Contribution limits (per person, total)", keys: ["basket_max_water_per_pass", "basket_max_seed_per_pass", "basket_max_fertilizer_per_pass"] },
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
