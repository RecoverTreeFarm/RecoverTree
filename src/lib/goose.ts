/** Golden Goose — suggested questions + the client state shape. */

/** Suggested questions the Keeper can copy into the group chat (or write their
 *  own). The app never posts these itself. */
export const GOOSE_QUESTIONS: readonly string[] = [
  "Golden Goose is visiting! What’s a strategy you use to reduce cravings?",
  "What’s one small thing that helped you today?",
  "What do you do when your brain starts bargaining with you?",
  "What helps you get through a hard hour?",
  "What’s a comfort activity that doesn’t make things worse?",
  "What would you tell someone on day one?",
  "What’s one tiny win from this week?",
  "What helps you reset when you feel overwhelmed?",
  "What’s something you’re grateful for today?",
  "What’s one thing you can do today to help future you?",
];

export type GooseReward = {
  reward_type: "seed" | "water" | "fertilizer";
  amount: number;
  reason: string;
};

export type GooseState =
  | {
      is_goose_day: boolean;
      has_event: false;
      opt_in: boolean;
      excluded_until: string | null;
    }
  | {
      is_goose_day: boolean;
      has_event: true;
      assignment_id: string;
      status:
        | "answer_collection"
        | "selection_open"
        | "completed"
        | "auto_completed"
        | "expired_no_submissions"
        | "passed"
        | "cancelled";
      phase: "answer_collection" | "selection" | "ended";
      i_am_keeper: boolean;
      i_submitted: boolean;
      my_answer: string | null;
      submission_count: number;
      anonymous_answers: { id: string; answer_text: string }[];
      my_rewards: GooseReward[];
      answer_collection_ends_at: string;
      selection_deadline_at: string;
      pass_enabled: boolean;
      opt_in: boolean;
      excluded_until: string | null;
    };
