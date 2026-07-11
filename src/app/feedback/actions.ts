"use server";

import { createClient } from "@/lib/supabase/server";
import { SUPPORT_EMAIL, FEEDBACK_TYPES, type FeedbackType } from "@/lib/wiki";

/**
 * Leave Feedback: the submission is SAVED to feedback_reports first (source
 * of truth — submit_feedback validates + rate-limits server-side), then
 * emailed to SUPPORT_EMAIL via Resend as a best-effort extra. A missing
 * RESEND_API_KEY or a failed send never loses feedback and never fails the
 * action — the row is already in the database.
 */
export async function submitFeedback(formData: FormData) {
  const type = String(formData.get("type") ?? "");
  const message = String(formData.get("message") ?? "").trim();
  const contact = String(formData.get("contact") ?? "").trim();

  if (!(type in FEEDBACK_TYPES)) {
    return { ok: false as const, message: "Please pick a feedback type." };
  }
  if (message.length < 3) {
    return { ok: false as const, message: "Tell us a little more — the message is empty." };
  }
  if (message.length > 2000) {
    return { ok: false as const, message: "That's a lot! Please keep it under 2000 characters." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_feedback", {
    p_type: type,
    p_message: message,
    p_contact: contact || null,
  });

  if (error) {
    const m = error.message;
    if (m.includes("RATE_LIMITED"))
      return { ok: false as const, message: "You've sent a lot of feedback today — thank you! Please try again tomorrow." };
    if (m.includes("NOT_AUTHENTICATED") || m.includes("NO_PROFILE"))
      return { ok: false as const, message: "Please log in to send feedback." };
    if (m.includes("BANNED"))
      return { ok: false as const, message: "Your account can't do that right now." };
    return { ok: false as const, message: "Couldn't send that just now — please try again." };
  }

  // Best-effort email notification (fire inside the action so it runs on the
  // server; never let it fail the save).
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (apiKey) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const subject = `${FEEDBACK_TYPES[type as FeedbackType]} — RecoverTree feedback`;
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.FEEDBACK_FROM_EMAIL ?? `RecoverTree <feedback@recovertree.farm>`,
          to: [SUPPORT_EMAIL],
          subject,
          text: [
            `Type: ${FEEDBACK_TYPES[type as FeedbackType]}`,
            `From user: ${user?.email ?? "unknown"}`,
            contact ? `Contact: ${contact}` : null,
            "",
            message,
          ]
            .filter((l) => l !== null)
            .join("\n"),
        }),
      });
    }
  } catch {
    // swallow — the report is safely stored in feedback_reports either way
  }

  return { ok: true as const };
}
