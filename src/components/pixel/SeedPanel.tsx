"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/pixel/ui";
import { sendSeed } from "@/app/dashboard/actions";
import { playSfx } from "@/lib/sfx";

export type SeedMember = {
  user_id: string;
  username: string;
  display_name: string | null;
};

/**
 * Daily Seed of encouragement. One per day, picked from the member list;
 * the server enforces every rule (daily limit, no self-seeding, bans).
 */
export function SeedPanel({
  members,
  sentToday,
  sentToName,
}: {
  members: SeedMember[];
  /** has today's Seed already been used? */
  sentToday: boolean;
  /** who received it (null if their profile isn't public) */
  sentToName: string | null;
}) {
  const router = useRouter();
  const [receiver, setReceiver] = useState(members[0]?.user_id ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSend() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await sendSeed(receiver);
      if (!result.ok) {
        playSfx("error");
        setError(result.message);
      } else {
        playSfx("seed");
        setMessage(
          `You gave a Seed to @${result.receiver_username} — and earned 💧 ${result.water_earned} water!`,
        );
      }
      router.refresh();
    });
  }

  return (
    <Panel>
      <h2 className="pixel-heading mb-3 text-lg">Today’s Seed</h2>

      {sentToday ? (
        <>
          <p className="text-sm font-bold">
            🌱 Sent{sentToName ? ` to @${sentToName}` : ""}!
          </p>
          <p className="mt-1 text-xs text-[var(--rf-ink-soft)]">
            One Seed per day keeps the community growing. Your next Seed is
            ready tomorrow.
          </p>
        </>
      ) : members.length === 0 ? (
        <p className="text-xs text-[var(--rf-ink-soft)]">
          No other farmers to Seed yet — invite your community! Your daily
          Seed will be waiting.
        </p>
      ) : (
        <>
          <p className="mb-2 text-xs text-[var(--rf-ink-soft)]">
            Send one Seed a day to encourage another farmer. They get a seed
            to plant a new tree; you earn 💧 10 water.
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
          <button
            type="button"
            onClick={handleSend}
            disabled={pending || !receiver}
            className="pixel-btn mt-3 w-full disabled:opacity-60"
          >
            {pending ? "Sending…" : "🌱 Send today’s Seed"}
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
