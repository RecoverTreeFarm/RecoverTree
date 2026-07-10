import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOwnProfile } from "@/lib/profile";
import { Container, PageHeader, Panel, PixelLink } from "@/components/pixel/ui";
import { AdminConsole } from "@/components/admin/AdminConsole";
import type {
  AdminUser,
  AdminMeetingSession,
  AdminAuditLog,
  AdminChecklistGoal,
} from "@/lib/admin";
import { debugSettingsEnabled, type SettingOverrideRow } from "@/lib/gameSettings";
import type { DebugInventoryRow, DebugEventStates } from "@/components/admin/DebugTools";
import type { AdminBulletinPost } from "@/lib/bulletin";
import type { AdminGardenEvent } from "@/components/admin/GardenAdmin";

/**
 * Admin console. Access is enforced SERVER-SIDE here (non-admins get an
 * unauthorized message, never the controls) AND again in every database
 * function (each re-checks is_admin()), so the client can't be tricked into
 * privileged writes.
 */
export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const profile = await getOwnProfile(supabase, user.id);
  if (!profile) redirect("/setup-profile");

  if (profile.role !== "admin") {
    return (
      <Container className="flex flex-col items-center text-center">
        <PageHeader
          title="Admins only"
          subtitle="This area is for community admins. If you think you should have access, ask an existing admin to grant it."
        />
        <Panel className="max-w-md">
          <p className="text-sm">Nothing to see here for now. 🌱</p>
          <div className="mt-4">
            <PixelLink href="/dashboard">Back to your farm</PixelLink>
          </div>
        </Panel>
      </Container>
    );
  }

  // Pull everything the console needs via the admin RPCs (each re-checks
  // is_admin() in the DB). If the migration hasn't been applied yet the RPCs
  // won't exist — surface that clearly instead of crashing.
  const [usersRes, sessionsRes, logsRes, goalsRes, settingsRes, bulletinRes, gardenRes] =
    await Promise.all([
      supabase.rpc("list_admin_users"),
      supabase.rpc("list_admin_meeting_sessions"),
      supabase.rpc("list_admin_audit_logs"),
      supabase.rpc("list_admin_checklist_goals"),
      supabase.rpc("get_game_settings"),
      supabase.rpc("list_admin_bulletin_posts"),
      supabase.rpc("list_admin_community_garden"),
    ]);

  const missingFn =
    usersRes.error?.message?.includes("does not exist") ||
    usersRes.error?.message?.includes("Could not find") ||
    settingsRes.error?.message?.includes("does not exist");

  if (missingFn) {
    return (
      <Container>
        <PageHeader title="Admin" subtitle="For admin users only." route="/admin" />
        <Panel>
          <h2 className="pixel-heading mb-2 text-lg">Almost there</h2>
          <p className="text-sm text-[var(--rf-ink-soft)]">
            The admin database functions aren’t installed yet. Apply the
            migration{" "}
            <code className="text-xs">
              supabase/migrations/20260709100000_admin_and_game_settings.sql
            </code>{" "}
            (Supabase SQL editor or MCP), then reload this page.
          </p>
        </Panel>
      </Container>
    );
  }

  // Debug tab data — only fetched when the admin has switched the
  // `debug_settings_enabled` game setting on (the RPCs also re-check it).
  const overrides = (settingsRes.data ?? []) as SettingOverrideRow[];
  let debug: { players: DebugInventoryRow[]; events: DebugEventStates | null } | null = null;
  if (debugSettingsEnabled(overrides)) {
    const [invRes, eventsRes] = await Promise.all([
      supabase.rpc("debug_list_inventories"),
      supabase.rpc("debug_event_states"),
    ]);
    debug = {
      players: (invRes.data ?? []) as DebugInventoryRow[],
      events: eventsRes.error ? null : ((eventsRes.data ?? null) as DebugEventStates | null),
    };
  }

  return (
    <Container>
      <PageHeader
        title="Admin"
        subtitle="Manage members, meetings, awards, and the game’s default parameters. Every action here is recorded in the audit log."
        route="/admin"
      />
      <AdminConsole
        currentUserId={user.id}
        users={(usersRes.data ?? []) as AdminUser[]}
        sessions={(sessionsRes.data ?? []) as AdminMeetingSession[]}
        logs={(logsRes.data ?? []) as AdminAuditLog[]}
        goals={(goalsRes.data ?? []) as AdminChecklistGoal[]}
        overrides={overrides}
        debug={debug}
        bulletin={(bulletinRes.data ?? []) as AdminBulletinPost[]}
        garden={(gardenRes.data ?? []) as AdminGardenEvent[]}
      />
    </Container>
  );
}
