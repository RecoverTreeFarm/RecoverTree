"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/pixel/ui";
import { sendSeed } from "@/app/dashboard/actions";
import { announceReward } from "@/components/game/RewardBanner";
import { playSfx } from "@/lib/sfx";
import { ICON } from "@/lib/icons";

export type SeedMember = {
  user_id: string;
  username: string;
  display_name: string | null;
};

/** Starters the sender can tap instead of writing from scratch. */
const KUDO_PROMPTS: readonly string[] = [
  "Thanks for showing up — it made a difference.",
  "Proud of you for the work you're putting in.",
  "Your honesty in group today helped me.",
  "Congrats on the milestone. You earned it.",
  "Glad you're here. Keep going.",
];

const MAX_LEN = 300;

/**
 * The daily KudoSeed — a gift AND a note. One per day, picked from the member
 * list, with an optional encouraging message (thanks, praise, recognition).
 * The server enforces every rule (daily limit, no self-seeding, bans, length).
 */
export function SeedPanel({
  members,
  sentToday,
  sentToName,
}: {
  members: SeedMember[];
  /** has today's KudoSeed already been used? */
  sentToday: boolean;
  /** who received it (null if their profile isn't public) */
  sentToName: string | null;
}) {
  const router = useRouter();
  const [receiver, setReceiver] = useState(members[0]?.user_id ?? "");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSend() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await sendSeed(receiver, note);
      if (!result.ok) {
        playSfx("error");
        setError(result.message);
      } else {
        playSfx("seed");
        setMessage(
          `You sent a KudoSeed to @${result.receiver_username} — and earned ${ICON.water} ${result.water_earned} water!`,
        );
        announceReward(`${ICON.water} ${result.water_earned} — KudoSeed sent 🌱`);
        setNote("");
      }
      router.refresh();
    });
  }

  return (
    <Panel>
      <h2 className="pixel-heading mb-3 text-lg">Today’s KudoSeed</h2>

      {sentToday ? (
        <>
          <p className="text-sm font-bold">
            🌱 Sent{sentToName ? ` to @${sentToName}` : ""}!
          </p>
          <p className="mt-1 text-xs text-[var(--rf-ink-soft)]">
            One KudoSeed per day keeps the community growing. Your next one is
            ready tomorrow.
          </p>
        </>
      ) : members.length === 0 ? (
        <p className="text-xs text-[var(--rf-ink-soft)]">
          No other farmers to send to yet — invite your community! Your daily
          KudoSeed will be waiting.
        </p>
      ) : (
        <>
          <p className="mb-2 text-xs text-[var(--rf-ink-soft)]">
            Send one KudoSeed a day to encourage another farmer. They get a seed
            to plant a new tree; you earn {ICON.water} 10 water. Add a note to
            say thanks, share positive feedback, or recognize an achievement.
          </p>

          <label htmlFor="seed-receiver" className="mb-1 block text-[10px] font-bold uppercase tracking-wide">
            Choose a farmer
          </label>
          <select
            id="seed-receiver"
            value={receiver}
            onChange={(e) => setReceiver(e.target.value)}
            className="w-full rounded border-[3px] border-[var(--rf-ink)] bg-white px-2 py-2 font-mono text-sm"
          >
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                @{m.username}
                {m.display_name ? ` (${m.display_name})` : ""}
              </option>
            ))}
          </select>

          <label htmlFor="seed-note" className="mb-1 mt-3 block text-[10px] font-bold uppercase tracking-wide">
            Add an encouraging note <span className="font-normal normal-case opacity-70">(optional)</span>
          </label>
          <textarea
            id="seed-note"
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, MAX_LEN))}
            rows={3}
            maxLength={MAX_LEN}
            placeholder="Thanks for showing up today…"
            className="w-full rounded border-[3px] border-[var(--rf-ink)] bg-white px-2 py-1.5 text-sm"
          />
          <div className="mt-1 flex items-center justify-between">
            <span className="text-[10px] text-[var(--rf-ink-soft)]">
              They’ll see this with your KudoSeed.
            </span>
            <span className="text-[10px] font-bold text-[var(--rf-ink-soft)]">
              {note.length}/{MAX_LEN}
            </span>
          </div>

          <div className="mt-1.5 flex flex-wrap gap-1">
            {KUDO_PROMPTS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setNote(p)}
                className="rounded border-2 border-[var(--rf-ink)]/30 bg-[var(--rf-cream)] px-1.5 py-0.5 text-left text-[10px] hover:border-[var(--rf-ink)]"
                title="Use this note"
              >
                {p}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleSend}
            disabled={pending || !receiver}
            className="pixel-btn mt-3 w-full disabled:opacity-60"
          >
            {pending ? "Sending…" : "🌱 Send today’s KudoSeed"}
          </button>
        </>
      )}

      {message && (
        <p role="status" className="mt-3 rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-grass)] px-3 py-2 text-xs font-bold">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-gold)] px-3 py-2 text-xs font-bold">
          {error}
        </p>
      )}
    </Panel>
  );
}
