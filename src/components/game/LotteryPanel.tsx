"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buyLotteryTickets } from "@/app/dashboard/actions";
import { playSfx } from "@/lib/sfx";
import type { LotteryState } from "@/lib/lottery";

/**
 * Weekly Orchard Lottery panel — a cozy community raffle, not a casino.
 * Everything money-shaped is Coins (never Water/Seeds/Fertilizer/Fruits, no
 * real money). All prices, pots, and the Sunday draw live server-side; this
 * panel only asks for a ticket count and always confirms the Coin cost first.
 * Statuses are labelled in words (never color alone) and there are no
 * jackpot flashes — reduced-motion users see exactly the same panel.
 */
export function LotteryPanel({ state, myCoins }: { state: LotteryState; myCoins: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmQty, setConfirmQty] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const round = state.round;
  const last = state.last_result;

  if (!state.enabled && !round) {
    return (
      <p className="text-sm text-[var(--rf-ink-soft)]">
        The Weekly Orchard Lottery is taking a break right now.
      </p>
    );
  }

  function fmt(iso: string): string {
    // Shown in the viewer's local time; the schedule itself is server-decided.
    return new Date(iso).toLocaleString(undefined, {
      weekday: "long",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function buy(qty: number) {
    setConfirmQty(null);
    setMsg(null);
    // one random key per confirmed tap — a retried request can never buy twice
    const key = `${round?.round_id}-${crypto.randomUUID()}`;
    startTransition(async () => {
      const r = await buyLotteryTickets(qty, key);
      if (!r.ok) {
        playSfx("error");
        setMsg({ ok: false, text: r.message });
        return;
      }
      playSfx("reveal");
      setMsg({
        ok: true,
        text:
          (r.my_tickets ?? 0) >= (round?.max_tickets_per_user ?? 3)
            ? `You’re entered in Sunday’s drawing — you have all ${round?.max_tickets_per_user} tickets for this week. 🪙 ${r.coins_left} left.`
            : `You’re entered in Sunday’s drawing. 🪙 ${r.coins_left} left.`,
      });
      router.refresh();
    });
  }

  const remaining = round ? round.max_tickets_per_user - round.my_tickets : 0;
  const price = round?.ticket_price_coins ?? 0;
  const statusLabel = !round
    ? ""
    : round.sales_open
      ? "Open"
      : round.status === "open" || round.status === "sales_closed"
        ? "Closed — drawing soon"
        : round.status === "drawn"
          ? "Drawn"
          : round.status === "refunded_single_participant"
            ? "Refunded"
            : round.status === "no_entries"
              ? "No entries"
              : round.status === "cancelled"
                ? "Cancelled"
                : round.status;

  const stat = (label: string, value: React.ReactNode) => (
    <div className="flex items-baseline justify-between gap-2 border-b border-dashed border-[var(--rf-ink)]/25 py-1">
      <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--rf-ink-soft)]">{label}</span>
      <span className="text-sm font-extrabold">{value}</span>
    </div>
  );

  return (
    <div>
      <p className="text-[12px] leading-relaxed text-[var(--rf-ink-soft)]">
        Every ticket adds its Coins to the community pot. On Sunday the Orchard
        adds a little extra, and one ticket is drawn. Coins only — never Fruits.
      </p>

      {round && (
        <div className="mt-2">
          <div className="flex items-center justify-between">
            <h3 className="pixel-heading text-sm">🎟️ This week’s drawing</h3>
            <span className="rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-1.5 py-0.5 text-[10px] font-extrabold uppercase">
              {statusLabel}
            </span>
          </div>

          <div className="mt-1.5">
            {stat("Ticket price", <>🪙 {price}</>)}
            {stat("Your tickets", `${round.my_tickets} / ${round.max_tickets_per_user}`)}
            {state.show_ticket_count && stat("Total tickets", round.total_tickets)}
            {state.show_participant_count && stat("Farmers entered", round.distinct_participant_count)}
            {state.show_pot && (
              <>
                {stat("Community pot", <>🪙 {round.player_funded_pot_coins}</>)}
                {stat(`Orchard bonus (${round.orchard_bonus_percent}%)`, <>+🪙 {round.orchard_bonus_preview}</>)}
                {stat("Sunday prize", <>🪙 {round.final_prize_preview}</>)}
              </>
            )}
            {stat("Ticket sales close", fmt(round.sales_close_at))}
            {stat("Drawing", fmt(round.draw_at))}
          </div>

          {/* purchase controls */}
          {round.sales_open ? (
            remaining > 0 ? (
              <div className="mt-3">
                {confirmQty === null ? (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={pending} onClick={() => setConfirmQty(1)}
                      className="pixel-btn flex-1 whitespace-nowrap text-xs disabled:opacity-50">
                      Buy 1 Ticket
                    </button>
                    {remaining >= 2 && (
                      <button type="button" disabled={pending} onClick={() => setConfirmQty(2)}
                        className="pixel-btn flex-1 whitespace-nowrap text-xs disabled:opacity-50">
                        Buy 2 Tickets
                      </button>
                    )}
                    {remaining >= 2 && (
                      <button type="button" disabled={pending} onClick={() => setConfirmQty(remaining)}
                        className="pixel-btn pixel-btn--secondary flex-1 whitespace-nowrap text-xs disabled:opacity-50">
                        Buy Remaining ({remaining})
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-gold)]/20 p-2.5">
                    <p className="text-sm font-extrabold">
                      Spend 🪙 {price * confirmQty} for {confirmQty}{" "}
                      {confirmQty === 1 ? "ticket" : "tickets"}?
                    </p>
                    <p className="mt-0.5 text-[11px] text-[var(--rf-ink-soft)]">You have 🪙 {myCoins}.</p>
                    <div className="mt-2 flex gap-2">
                      <button type="button" disabled={pending} onClick={() => buy(confirmQty)}
                        className="pixel-btn flex-1 text-xs disabled:opacity-50">
                        {pending ? "…" : "Yes, enter the drawing"}
                      </button>
                      <button type="button" disabled={pending} onClick={() => setConfirmQty(null)}
                        className="pixel-btn pixel-btn--secondary flex-1 text-xs disabled:opacity-50">
                        Not now
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-3 rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-2.5 py-1.5 text-xs font-bold">
                You have all {round.max_tickets_per_user} tickets for this week. Good luck on Sunday! 🍀
              </p>
            )
          ) : (
            <p className="mt-3 rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] px-2.5 py-1.5 text-xs font-bold">
              Ticket sales are closed. Sunday’s result will be announced soon.
            </p>
          )}

          {msg && (
            <p role="status"
              className={`mt-2 rounded border-2 border-[var(--rf-ink)] px-2.5 py-1.5 text-xs font-bold ${
                msg.ok ? "bg-[var(--rf-cream)]" : "bg-[var(--rf-red)]/15"
              }`}>
              {msg.text}
            </p>
          )}
        </div>
      )}

      {/* most recent result (stays visible until the next round opens) */}
      {last && <LastResult last={last} />}
    </div>
  );
}

function LastResult({ last }: { last: NonNullable<LotteryState["last_result"]> }) {
  let text: string;
  if (last.status === "drawn") {
    if (last.i_won) {
      text = `Your ticket was drawn! The 🪙 ${last.final_prize_coins} Sunday prize has been added to your balance.`;
    } else if (last.winner_name) {
      text = `${last.winner_name}’s ticket was drawn — this week’s prize was 🪙 ${last.final_prize_coins}. A new round opens soon.`;
    } else {
      text = `Sunday’s drawing is complete. This week’s prize was 🪙 ${last.final_prize_coins}. A new round opens soon.`;
    }
  } else if (last.status === "refunded_single_participant") {
    text = last.i_was_refunded
      ? `You were the only farmer entered this week, so your 🪙 ${last.my_coins_back} were returned.`
      : "Only one farmer entered this week, so their Coins were returned. A new drawing opens soon.";
  } else if (last.status === "cancelled") {
    text = last.i_was_refunded
      ? `That round was cancelled — your 🪙 ${last.my_coins_back} were returned.`
      : "The last round was cancelled and all tickets were returned.";
  } else {
    text = "No tickets were entered this week. A new drawing opens soon.";
  }

  return (
    <div className="mt-3 rounded border-2 border-dashed border-[var(--rf-ink)]/40 bg-[var(--rf-cream)] p-2.5">
      <p className="text-[10px] font-extrabold uppercase tracking-wide text-[var(--rf-ink-soft)]">
        Latest result · {last.week_key}
      </p>
      <p className="mt-0.5 text-xs font-bold">{text}</p>
    </div>
  );
}
