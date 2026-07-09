import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Container, PageHeader } from "@/components/pixel/ui";
import { AuthForm } from "@/components/auth/AuthForm";
import { Sprite } from "@/components/pixel/Sprite";
import { SPRITES } from "@/lib/sprites";

export default async function SignupPage() {
  // Already logged in? Straight to the farm.
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) redirect("/dashboard");

  return (
    <Container className="flex flex-col items-center">
      <div className="mb-2">
        <Sprite src={SPRITES.villagerVariants[0]} size={[32, 32]} scale={5} alt="" />
      </div>
      <PageHeader
        title="Start your farm"
        subtitle="Create an account to grow trees, earn Fruits, and cheer on your community."
        route="/signup"
      />
      <AuthForm mode="signup" />
    </Container>
  );
}
