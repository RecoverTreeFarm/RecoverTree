"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/pixel/ui";
import { passBasket, keepBasket } from "@/app/dashboard/actions";
import { playSfx } from "@/lib/sfx";

export type BasketRecipient = {
  user_id: string;
  username: string;
  display_name: string | null;
};

export type BasketState = {
  is_basket_day: boolean;
  has_chain: boolean;
  chain_id?: string;
  status?: "active" | "locked_in" | "kept" | "expired" | "cancelled";
  target?: number;
  participants?: number;
  contents?: { water: number; seed: number; fertilizer: number };
  i_hold_it?: boolean;
  i_touched_it?: boolean;
  holder_username?: string | null;
  keep_multiplier?: number;
  limits?: {
    water_per_pass: number;
    seed_per_pass: number;
    fertilizer_per_pass: number;
  };
  hold_expires_at?: string;
  auto_pass_water?: number;
  min_receive_water?: number;
  eligible_recipients?: BasketRecipient[];
  my_rewards?: { reward_type: string; amount: number }[];
};

const inputClass =
  "w-16 border-[3px] border-[var(--rf-ink)] bg-white px-2 py-1 text-xs rounded";

function ContentsLine({
  contents,
  mult = 1,
}: {
  contents: { water: number; seed: number; fertilizer: number };
  mult?: number;
}) {
  const parts: string[] = [];
  if (contents.water > 0) parts.push(`💧 ${contents.water * mult} water`);
  if (contents.seed > 0) parts.push(`🌱 ${contents.seed * mult} seed${contents.seed * mult === 1 ? "" : "s"}`);
  if (contents.fertilizer > 0) parts.push(`✨ ${contents.fertilizer * mult} fertilizer`);
  return <span className="font-bold">{parts.length ? parts.join(" + ") : "nothing yet"}</span>;
}

/**
 * Traveling Basket — a limited community event. The basket carries water,
 * seeds, and fertilizer between farmers (never Fruits). Keep it for double
 * the contents, or add an item and pass it along; if it reaches its target,
 * everyone who touched it gets the whole basket.
 */
export function BasketPanel({
  state,
  myWater,
  mySeeds,
  myFertilizer,
}: {
  state: BasketState;
  myWater: number;
  mySeeds: number;
  myFertilizer: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [water, setWater] = useState(0);
  const [seed, setSeed] = useState(0);
  const [fert, setFert] = useState(0);
  const [receiver, setReceiver] = useState(state.eligible_recipients?.[0]?.user_id ?? "");
  const [confirmKeep, setConfirmKeep] = useState(false);

  // Not a basket day and nothing to show → the basket rests.
  if (!state.is_basket_day && !state.has_chain) {
    return (
      <Panel>
        <h2 className="pixel-heading mb-2 text-lg">🧺 Traveling Basket</h2>
        <p className="text-xs text-[var(--rf-ink-soft)]">
          The Traveling Basket is resting today. On basket days it travels
          farmer to farmer, gathering water, seeds, and fertilizer.
        </p>
      </Panel>
    );
  }

  // Basket day, but the chain hasn't started (no eligible first holder yet).
  if (!state.has_chain) {
    return (
      <Panel>
        <h2 className="pixel-heading mb-2 text-lg">🧺 Traveling Basket</h2>
        <p className="text-xs text-[var(--rf-ink-soft)]">
          Today is a basket day! The basket is getting ready to travel — it
          may come your way. 🧺
        </p>
      </Panel>
    );
  }

  const contents = state.contents ?? { water: 0, seed: 0, fertilizer: 0 };
  const target = state.target ?? 5;
  const participants = state.participants ?? 0;
  const mult = state.keep_multiplier ?? 2;
  const limits = state.limits;
  const bigBasket = target >= 10;
  const recipients = state.eligible_recipients ?? [];
  const totalAdded = water + seed + fert;

  function handlePass() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const r = await passBasket(receiver, water, seed, fert);
      if (!r.ok) {
        playSfx("error");
        setError(r.message);
      } else {
        playSfx("seed");
        setNotice(
          r.locked_in
            ? `The basket reached ${target} farmers — everyone gets the whole basket! 🎉`
            : "You passed the basket along. 🧺",
        );
      }
      router.refresh();
    });
  }

  function handleKeep() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const r = await keepBasket();
      if (!r.ok) {
        playSfx("error");
        setError(r.message);
      } else {
        playSfx("harvest");
        setNotice(
          `You kept the basket and received 💧 ${r.water} water, 🌱 ${r.seed} seed${r.seed === 1 ? "" : "s"}, ✨ ${r.fertilizer} fertilizer.`,
        );
      }
      setConfirmKeep(false);
      router.refresh();
    });
  }

  return (
    <Panel>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="pixel-heading text-lg">🧺 Traveling Basket</h2>
        {state.status === "active" && (
          <span className="rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-gold)] px-1.5 py-0.5 text-[10px] font-extrabold uppercase">
            {participants} / {target} farmers
          </span>
        )}
      </div>

      {bigBasket && state.status === "active" && (
        <p className="mb-2 rounded border-2 border-dashed border-[var(--rf-ink)] bg-[var(--rf-gold)]/40 px-2 py-1 text-[11px] font-bold">
          🌟 Rare big basket! This one needs {target} farmers to lock in.
        </p>
      )}

      {/* ---- Ended states ---- */}
      {state.status === "locked_in" && (
        <>
          <p className="text-sm font-bold">The basket reached {target} farmers! 🎉</p>
          <p className="mt-1 text-xs">
            Everyone who touched it received: <ContentsLine contents={contents} />.
          </p>
          {state.i_touched_it && (
            <p className="mt-1 text-xs text-[var(--rf-ink-soft)]">
              That includes you — enjoy! 🧺
            </p>
          )}
        </>
      )}
      {state.status === "kept" && (
        <p className="text-xs">
          The basket found its home today and the chain ended. It’ll travel
          again on the next basket day. 🧺
        </p>
      )}
      {(state.status === "expired" || state.status === "cancelled") && (
        <p className="text-xs text-[var(--rf-ink-soft)]">
          Today’s basket has gone to rest. See you next basket day!
        </p>
      )}

      {/* ---- Active: I hold it ---- */}
      {state.status === "active" && state.i_hold_it && (
        <>
          <p className="text-sm font-bold">The basket is in your hands! 🧺</p>
          <p className="mt-1 text-xs">
            Inside right now: <ContentsLine contents={contents} />
          </p>
          <p className="mt-1 text-[11px] text-[var(--rf-ink-soft)]">
            If it reaches {target} farmers, everyone who touched it gets the
            full basket.
          </p>
          {state.hold_expires_at && (
            <p className="mt-1 text-[11px] font-bold text-[var(--rf-ink-soft)]">
              ⏳ Pass or keep it by{" "}
              {new Date(state.hold_expires_at).toLocaleString([], {
                weekday: "short",
                hour: "numeric",
                minute: "2-digit",
              })}
              , or it auto-passes 💧{state.auto_pass_water ?? 5} water to a
              random farmer.
            </p>
          )}

          {/* Option A: keep */}
          <div className="mt-3 rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] p-2.5">
            <p className="text-xs font-bold">Keep the basket</p>
            <p className="mt-0.5 text-[11px] text-[var(--rf-ink-soft)]">
              Receive double what’s inside: <ContentsLine contents={contents} mult={mult} />.
              The basket stops traveling today.
            </p>
            {confirmKeep ? (
              <div className="mt-2 flex items-center gap-2">
                <button type="button" disabled={pending} onClick={handleKeep}
                  className="pixel-btn text-[11px] disabled:opacity-50">
                  Yes, keep it
                </button>
                <button type="button" disabled={pending} onClick={() => setConfirmKeep(false)}
                  className="pixel-btn pixel-btn--secondary text-[11px]">
                  Not yet
                </button>
              </div>
            ) : (
              <button type="button" disabled={pending} onClick={() => setConfirmKeep(true)}
                className="pixel-btn pixel-btn--secondary mt-2 text-[11px]">
                Keep basket
              </button>
            )}
          </div>

          {/* Option B: add + pass */}
          <div className="mt-2 rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] p-2.5">
            <p className="text-xs font-bold">Add and pass it along</p>
            <p className="mt-0.5 text-[11px] text-[var(--rf-ink-soft)]">
              Add at least one item to pass it along. Passing feels good. 🌱
            </p>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="text-[10px] font-bold uppercase">
                💧 Water
                <input type="number" min={0} max={Math.min(limits?.water_per_pass ?? 25, myWater)}
                  value={String(water)} disabled={pending}
                  onChange={(e) => setWater(Math.max(0, Math.min(limits?.water_per_pass ?? 25, myWater, Math.floor(Number(e.target.value) || 0))))}
                  className={`${inputClass} mt-0.5 block`} />
              </label>
              <label className="text-[10px] font-bold uppercase">
                🌱 Seeds
                <input type="number" min={0} max={Math.min(limits?.seed_per_pass ?? 1, mySeeds)}
                  value={String(seed)} disabled={pending}
                  onChange={(e) => setSeed(Math.max(0, Math.min(limits?.seed_per_pass ?? 1, mySeeds, Math.floor(Number(e.target.value) || 0))))}
                  className={`${inputClass} mt-0.5 block`} />
              </label>
              <label className="text-[10px] font-bold uppercase">
                ✨ Fert.
                <input type="number" min={0} max={Math.min(limits?.fertilizer_per_pass ?? 2, myFertilizer)}
                  value={String(fert)} disabled={pending}
                  onChange={(e) => setFert(Math.max(0, Math.min(limits?.fertilizer_per_pass ?? 2, myFertilizer, Math.floor(Number(e.target.value) || 0))))}
                  className={`${inputClass} mt-0.5 block`} />
              </label>
            </div>
            <p className="mt-1 text-[10px] text-[var(--rf-ink-soft)]">
              Most you can add: 💧{limits?.water_per_pass ?? 25} · 🌱{limits?.seed_per_pass ?? 1} · ✨{limits?.fertilizer_per_pass ?? 2}. You have 💧{myWater} · 🌱{mySeeds} · ✨{myFertilizer}.
            </p>
            <p className="mt-0.5 text-[10px] text-[var(--rf-ink-soft)]">
              Farmers need at least 💧{state.min_receive_water ?? 5} water to
              receive the basket.
            </p>

            {recipients.length === 0 ? (
              <p className="mt-2 text-[11px] font-bold text-[var(--rf-ink-soft)]">
                No one else can receive the basket right now — you can keep it
                instead.
              </p>
            ) : (
              <>
                <label htmlFor="basket-receiver" className="mt-2 block text-[10px] font-bold uppercase tracking-wide">
                  Pass it to
                </label>
                <select id="basket-receiver" value={receiver} disabled={pending}
                  onChange={(e) => setReceiver(e.target.value)}
                  className="mt-0.5 w-full border-[3px] border-[var(--rf-ink)] bg-white px-2 py-1.5 text-xs rounded">
                  {recipients.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      @{m.username}{m.display_name ? ` (${m.display_name})` : ""}
                    </option>
                  ))}
                </select>
                <button type="button" disabled={pending || totalAdded < 1 || !receiver}
                  onClick={handlePass}
                  className="pixel-btn mt-2 w-full text-xs disabled:opacity-50">
                  {pending ? "Passing…" : "Pass basket"}
                </button>
                {totalAdded < 1 && (
                  <p className="mt-1 text-[10px] text-[var(--rf-ink-soft)]">
                    Add at least one item to pass.
                  </p>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* ---- Active: I already touched it ---- */}
      {state.status === "active" && !state.i_hold_it && state.i_touched_it && (
        <>
          <p className="text-sm font-bold">You already helped move the basket today. 🧺</p>
          <p className="mt-1 text-xs">
            It’s traveling on — {participants} / {target} farmers so far
            {state.holder_username ? (
              <> (now with @{state.holder_username})</>
            ) : null}
            . If it reaches {target}, everyone who touched it gets the full
            basket: <ContentsLine contents={contents} />.
          </p>
        </>
      )}

      {/* ---- Active: hasn't come my way ---- */}
      {state.status === "active" && !state.i_hold_it && !state.i_touched_it && (
        <p className="text-xs">
          The Traveling Basket is traveling today — it may come your way! 🧺
          {" "}({participants} / {target} farmers so far.)
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-red)] px-3 py-2 text-xs font-bold text-[var(--rf-cream)]">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-3 rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-grass)] px-3 py-2 text-xs font-bold">
          {notice}
        </p>
      )}
    </Panel>
  );
}
