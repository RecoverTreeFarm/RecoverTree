import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOwnProfile } from "@/lib/profile";
import { Container, PageHeader, Panel, PixelLink } from "@/components/pixel/ui";
import { HostPanel } from "@/components/host/HostPanel";

/**
 * Host page. Access is checked SERVER-SIDE twice over:
 *  - this page only renders controls for meeting_host / admin profiles
 *  - the database functions independently verify the role again, so even a
 *    hand-crafted request can't start a code without the role
 */
export default async function HostPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const profile = await getOwnProfile(supabase, user.id);
  if (!profile) redirect("/setup-profile");

  const isHost = profile.role === "meeting_host" || profile.role === "admin";

  if (!isHost) {
    return (
      <Container className="flex flex-col items-center text-center">
        <PageHeader
          title="Hosts only"
          subtitle="This page is for Meeting Hosts. Meetings themselves happen on Google Meet or your group’s usual tools — hosts just generate the attendance code here."
        />
        <Panel className="max-w-md">
          <p className="text-sm">
            Want to host meetings for your community? Ask an admin to make you
            a Meeting Host. 🌱
          </p>
          <div className="mt-4">
            <PixelLink href="/dashboard">Back to your farm</PixelLink>
          </div>
        </Panel>
      </Container>
    );
  }

  // Current active session, with its code (RLS: only the host can read it).
  // An expired-but-not-yet-flipped session is treated as gone; the next
  // start_meeting() call tidies its status.
  const { data: sessionRow } = await supabase
    .from("meeting_sessions")
    .select("id, code, starts_at, expires_at")
    .eq("host_user_id", user.id)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  let attendance = 0;
  if (sessionRow) {
    const { count } = await supabase
      .from("meeting_attendance")
      .select("id", { count: "exact", head: true })
      .eq("meeting_session_id", sessionRow.id);
    attendance = count ?? 0;
  }

  return (
    <Container>
      <PageHeader
        title="Host a Meeting"
        subtitle="Start your meeting on your usual platform, then generate a 4-digit code and read it aloud. The code runs for 90 minutes — one at a time."
        route="/host"
      />
      <HostPanel
        session={
          sessionRow ? { ...sessionRow, attendance } : null
        }
      />
    </Container>
  );
}
