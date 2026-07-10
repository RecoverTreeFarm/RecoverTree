/** Row shapes returned by the admin SECURITY DEFINER read functions. */

export type AdminUser = {
  user_id: string;
  username: string;
  display_name: string | null;
  email: string | null;
  role: "member" | "meeting_host" | "admin";
  is_banned: boolean;
  banned_reason: string | null;
  created_at: string;
};

export type AdminMeetingSession = {
  id: string;
  host_user_id: string | null;
  host_username: string | null;
  status: "active" | "ended" | "invalidated";
  starts_at: string;
  expires_at: string;
  ended_at: string | null;
  attendance_count: number;
};

export type AdminAuditLog = {
  id: string;
  created_at: string;
  actor_user_id: string | null;
  actor_username: string | null;
  target_user_id: string | null;
  target_username: string | null;
  action: string;
  metadata_json: Record<string, unknown>;
};

export type AdminChecklistGoal = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  water_reward: number;
  fertilizer_reward: number;
  coin_reward: number;
  active: boolean;
  sort_order: number;
};

export type AdminGooseRow = {
  id: string;
  assigned_date: string;
  keeper_username: string | null;
  status: string;
  submission_count: number;
  auto_selected: boolean;
  assigned_at: string;
  selection_deadline_at: string;
};

export const ROLE_LABELS: Record<AdminUser["role"], string> = {
  member: "Member",
  meeting_host: "Meeting Host",
  admin: "Admin",
};

/** Turn an audit action slug + metadata into a short human sentence. */
export function describeAuditAction(log: AdminAuditLog): string {
  switch (log.action) {
    case "role_changed":
      return `Changed role: ${log.metadata_json.old_role} → ${log.metadata_json.new_role}`;
    case "user_banned":
      return "Banned user";
    case "user_unbanned":
      return "Unbanned user";
    case "meeting_code_invalidated":
      return "Invalidated a meeting code";
    case "game_settings_updated": {
      const changes = (log.metadata_json.changes ?? {}) as Record<string, unknown>;
      const n = Object.keys(changes).length;
      return `Updated game settings (${n} change${n === 1 ? "" : "s"})`;
    }
    case "game_settings_reset":
      return "Reset game settings to defaults";
    case "checklist_reward_updated":
      return `Edited checklist reward: ${log.metadata_json.key ?? ""}`;
    default:
      return log.action;
  }
}
