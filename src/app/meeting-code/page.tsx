import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOwnProfile } from "@/lib/profile";
import { Container, PageHeader } from "@/components/pixel/ui";
import { CodeForm } from "@/components/meeting/CodeForm";

export default async function MeetingCodePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const profile = await getOwnProfile(supabase, user.id);
  if (!profile) redirect("/setup-profile");

  return (
    <Container>
      <PageHeader
        title="Enter Meeting Code"
        subtitle="Your host reads a 4-digit code aloud during the meeting. Type it here to check in — you’ll earn Fruits and water for your farm."
        route="/meeting-code"
      />
      <CodeForm />
    </Container>
  );
}
