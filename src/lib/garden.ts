/** Community Garden — client state shapes + shared copy. */

export type GardenReward = {
  reward_type: "seed" | "water" | "fertilizer" | "coin";
  amount: number;
  reward_kind: "completion" | "partial";
};

/** A visitor shown idle in the garden (privacy already applied server-side:
 *  public → username + avatar; everyone else → "A neighbor", no avatar;
 *  hidden farmers are never listed). `key` is a presence-row id, not a user. */
export type GardenNeighbor = {
  key: string;
  name: string;
  avatar_sprite: string | null;
};

export type GardenState =
  | {
      enabled: boolean;
      has_event: false;
      last_event: {
        event_id: string;
        status: "active" | "completed" | "expired" | "cancelled";
        ends_at: string;
        progress_percent: number;
        my_rewards: GardenReward[];
      } | null;
    }
  | {
      enabled: boolean;
      has_event: true;
      event_id: string;
      status: "active" | "completed" | "expired" | "cancelled";
      starts_at: string;
      ends_at: string;
      required_water: number;
      required_seeds: number;
      required_fertilizer: number;
      current_water: number;
      current_seeds: number;
      current_fertilizer: number;
      progress_percent: number;
      completed: boolean;
      i_contributed: boolean;
      my_water: number;
      my_seed: number;
      my_fertilizer: number;
      today_water_left: number;
      today_seed_left: number;
      today_fertilizer_left: number;
      my_rewards: GardenReward[];
      others: GardenNeighbor[];
    };

/** Giant-tree visual stage (1..5) from combined progress percent. */
export function gardenTreeStage(progressPercent: number, completed: boolean): number {
  if (completed || progressPercent >= 100) return 5; // fully bloomed
  if (progressPercent >= 75) return 4; // budding / magical
  if (progressPercent >= 50) return 3; // fuller tree
  if (progressPercent >= 25) return 2; // bigger tree with leaves
  return 1; // bare young tree
}
