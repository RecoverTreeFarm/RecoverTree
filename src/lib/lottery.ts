/** Weekly Orchard Lottery — client state shapes (mirrors get_weekly_lottery_state). */

export type LotteryRoundStatus =
  | "scheduled"
  | "open"
  | "sales_closed"
  | "drawn"
  | "no_entries"
  | "refunded_single_participant"
  | "cancelled";

export type LotteryRound = {
  round_id: string;
  week_key: string;
  status: LotteryRoundStatus;
  /** server-decided: status is open AND the cutoff hasn't passed */
  sales_open: boolean;
  opens_at: string;
  sales_close_at: string;
  draw_at: string;
  timezone: string;
  ticket_price_coins: number;
  max_tickets_per_user: number;
  my_tickets: number;
  total_tickets: number;
  distinct_participant_count: number;
  player_funded_pot_coins: number;
  /** preview only — the real bonus is computed server-side at the draw */
  orchard_bonus_preview: number;
  final_prize_preview: number;
  orchard_bonus_percent: number;
};

export type LotteryLastResult = {
  round_id: string;
  week_key: string;
  status: LotteryRoundStatus;
  final_prize_coins: number;
  player_funded_pot_coins: number;
  orchard_bonus_coins: number;
  /** privacy-safe: display name only when public + admin allows; else "A farmer"; null = hidden */
  winner_name: string | null;
  i_won: boolean;
  i_entered: boolean;
  i_was_refunded: boolean;
  my_coins_back: number;
};

export type LotteryState = {
  enabled: boolean;
  show_ticket_count: boolean;
  show_participant_count: boolean;
  show_pot: boolean;
  round: LotteryRound | null;
  last_result: LotteryLastResult | null;
};
