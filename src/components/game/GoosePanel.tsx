"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GooseSprite } from "@/components/pixel/GooseSprite";
import { PixelIcon } from "@/components/pixel/Sprite";
import { SPRITES } from "@/lib/sprites";
import { GOOSE_QUESTIONS, type GooseState } from "@/lib/goose";
import {
  submitGooseAnswer,
  selectGooseWinner,
  passGoose,
  setGooseOptIn,
} from "@/app/dashboard/actions";
import { playSfx } from "@/lib/sfx";

/** "3h 20m" / "45m" / "any moment" from a future ISO timestamp. Computed off
 *  the render path (SSR-safe) — starts empty, fills in after mount. */
function useCountdown(iso: string | undefined): string {
  const [label, setLabel] = useState("");
  useEffect(() => {
    if (!iso) return; // initial state is already ""
    const compute = () => {
      const rem = new Date(iso).getTime() - Date.now();
      if (rem <= 0) {
        setLabel("any moment");
        return;
      }
      const h = Math.floor(rem / 3_600_000);
      const m = Math.floor((rem % 3_600_000) / 60_000);
      setLabel(h > 0 ? `${h}h ${m}m` : `${m}m`);
    };
    compute();
    const iv = setInterval(compute, 30_000);
    return () => clearInterval(iv);
  }, [iso]);
  return label;
}

function Banner({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return (
    <p
      role={msg.ok ? "status" : "alert"}
      className={`mt-2 rounded border-2 border-[var(--rf-ink)] px-3 py-2 text-xs font-bold ${
        msg.ok ? "bg-[var(--rf-grass)]" : "bg-[var(--rf-red)] text-[var(--rf-cream)]"
      }`}
    >
      {msg.text}
    </p>
  );
}

export function GoosePanel({ state }: { state: GooseState }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [answer, setAnswer] = useState(
    state.has_event && state.my_answer ? state.my_answer : "",
  );
  // the Xtra Goose Entry (bought at the General Store) unlocks a SECOND box
  const [answer2, setAnswer2] = useState(
    state.has_event && state.my_answer_2 ? state.my_answer_2 : "",
  );
  const [showSecondBox, setShowSecondBox] = useState(
    Boolean(state.has_event && (state.my_answer_2 || state.extra_entry_status === "used")),
  );
  const [confirmPass, setConfirmPass] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);

  const answerDeadline = state.has_event ? state.answer_collection_ends_at : undefined;
  const selectionDeadline = state.has_event ? state.selection_deadline_at : undefined;
  const answerLeft = useCountdown(answerDeadline);
  const selectionLeft = useCountdown(selectionDeadline);

  function run(fn: () => Promise<{ ok: boolean; message?: string }>, okText: string) {
    setMsg(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        playSfx("error");
        setMsg({ ok: false, text: r.message ?? "Something went wrong." });
      } else {
        setMsg({ ok: true, text: okText });
        router.refresh();
      }
    });
  }

  // ---- No event today -----------------------------------------------------
  if (!state.has_event) {
    return (
      <div className="text-center">
        <div className="mb-2 flex justify-center opacity-70">
          {/* still: this goose sits inside a panel, not on the farm */}
          <GooseSprite flying scale={1.2} />
        </div>
        <p className="text-sm font-bold">The Golden Goose is away today.</p>
        <p className="mt-1 text-xs text-[var(--rf-ink-soft)]">
          On a Golden Goose day, one farmer becomes the Keeper and invites the
          community to answer a supportive question. Check back!
        </p>
        <OptInToggle optIn={state.opt_in} excludedUntil={state.excluded_until} run={run} pending={pending} />
      </div>
    );
  }

  const myEgg = state.my_rewards;
  const wonEgg = myEgg.some((r) => r.reason.startsWith("golden_goose_egg"));

  return (
    <div>
      {/* E. You received a Golden Goose Egg ----------------------------------*/}
      {wonEgg && <EggReveal rewards={myEgg} />}

      {/* B. Keeper — Answer Collection --------------------------------------*/}
      {state.i_am_keeper && state.status === "answer_collection" && (
        <div>
          <div className="mb-2 flex items-center gap-3">
            <GooseSprite scale={1.4} />
            <div>
              <p className="text-sm font-bold">The Golden Goose is visiting you! 🪿</p>
              <p className="text-[11px] text-[var(--rf-ink-soft)]">
                Answers coming in for {answerLeft} · {state.submission_count} so far
              </p>
            </div>
          </div>
          <p className="text-xs text-[var(--rf-ink-soft)]">
            Post a supportive question in your community chat (Signal/WhatsApp).
            Pick one below or write your own — the app won’t post it for you.
          </p>
          <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
            {GOOSE_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(q).then(
                    () => setMsg({ ok: true, text: "Question copied — paste it in your chat." }),
                    () => setMsg({ ok: false, text: "Couldn’t copy — select and copy it manually." }),
                  );
                }}
                className="block w-full rounded border-2 border-[var(--rf-ink)]/30 bg-[var(--rf-cream)] px-2 py-1.5 text-left text-[11px] hover:border-[var(--rf-ink)]"
                title="Copy this question"
              >
                {q}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-[var(--rf-ink-soft)]">
            When answers close you’ll pick your favorite (anonymously). Finish in
            time and the Golden Goose leaves you a fertilizer.
          </p>

          {state.pass_enabled &&
            (confirmPass ? (
              <div className="mt-3 rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] p-2">
                <p className="text-[11px] font-bold">
                  Not feeling up to it today? You can let the Golden Goose visit
                  someone else. No worries.
                </p>
                <div className="mt-2 flex gap-2">
                  <button type="button" disabled={pending}
                    onClick={() => run(passGoose, "Passed along — the goose will visit someone else.")}
                    className="pixel-btn pixel-btn--secondary text-[11px]">
                    Yes, pass the egg
                  </button>
                  <button type="button" disabled={pending} onClick={() => setConfirmPass(false)}
                    className="pixel-btn pixel-btn--secondary text-[11px]">
                    Keep it
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmPass(true)}
                className="pixel-btn pixel-btn--secondary mt-3 text-[11px]">
                Not today
              </button>
            ))}
        </div>
      )}

      {/* D. Keeper — Selection Phase ----------------------------------------*/}
      {state.i_am_keeper && state.status === "selection_open" && (
        <div>
          <p className="text-sm font-bold">
            Time to pick your favorite answer. 🥚
          </p>
          <p className="mt-1 text-xs text-[var(--rf-ink-soft)]">
            The Golden Goose Egg goes to whichever answer is your pick when the
            goose flies away ({selectionLeft} left) — you can change your mind
            until then.
          </p>
          <div className="mt-2 space-y-2">
            {state.anonymous_answers.length === 0 && (
              <p className="text-xs text-[var(--rf-ink-soft)]">
                No answers came in this time — the goose will move on.
              </p>
            )}
            {state.anonymous_answers.map((a, i) => {
              const isPick = state.my_pick_submission_id === a.id;
              return (
                <div
                  key={a.id}
                  className={`rounded border-2 border-[var(--rf-ink)] p-2 ${
                    isPick ? "bg-[var(--rf-gold)]/40" : "bg-[var(--rf-cream)]"
                  }`}
                >
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--rf-ink-soft)]">
                    Anonymous Answer #{i + 1}
                    {isPick && <span className="ml-1 text-[var(--rf-ink)]">★ your pick</span>}
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap text-xs">{a.answer_text}</p>
                  {isPick ? (
                    <p className="mt-1 text-[11px] font-bold text-[var(--rf-grass-dark)]">
                      ✓ This answer gets the egg when the goose leaves.
                    </p>
                  ) : picking === a.id ? (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-[11px] font-bold">
                        {state.my_pick_submission_id ? "Change your pick to this answer?" : "Pick this answer?"}
                      </span>
                      <button type="button" disabled={pending}
                        onClick={() => run(() => selectGooseWinner(a.id), "Pick saved — you can still change it until the goose flies away. 🥚")}
                        className="pixel-btn text-[11px]">
                        Yes, pick this
                      </button>
                      <button type="button" disabled={pending} onClick={() => setPicking(null)}
                        className="pixel-btn pixel-btn--secondary text-[11px]">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setPicking(a.id)}
                      className="pixel-btn pixel-btn--secondary mt-2 text-[11px]">
                      {state.my_pick_submission_id ? "Make this my pick" : "Pick favorite"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* C. Regular member — Answer Collection ------------------------------*/}
      {!state.i_am_keeper && state.status === "answer_collection" && (
        <div>
          <p className="text-sm font-bold">Golden Goose Request 🪿</p>
          <p className="mt-1 text-xs text-[var(--rf-ink-soft)]">
            The Golden Goose Keeper posted a question in the community chat.
            Check Signal/WhatsApp, then submit your answer here.
          </p>
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            maxLength={800}
            rows={4}
            placeholder="Your answer…"
            className="mt-2 w-full rounded border-[3px] border-[var(--rf-ink)] bg-white px-2 py-1.5 text-sm"
          />
          <div className="mt-1 flex items-center justify-between">
            <span className="text-[10px] text-[var(--rf-ink-soft)]">
              Answers are anonymous during review · {answerLeft} left
            </span>
            <button type="button" disabled={pending || answer.trim().length < 1}
              onClick={() => run(() => submitGooseAnswer(answer), state.i_submitted ? "Answer updated." : "Answer submitted — thank you! 🌱")}
              className="pixel-btn text-xs disabled:opacity-50">
              {state.i_submitted ? "Update answer" : "Submit answer"}
            </button>
          </div>
          {state.i_submitted && (
            <p className="mt-1 text-[11px] font-bold text-[var(--rf-grass-dark)]">
              ✓ You’ve answered — you can edit until answers close.
            </p>
          )}

          {/* Xtra Goose Entry: a ticket below the box unlocks a 2nd answer.
              Max 2 answers — the ticket never stacks. */}
          {(state.extra_entry_status === "available" || state.extra_entry_status === "used") &&
            !showSecondBox && (
              <button
                type="button"
                onClick={() => setShowSecondBox(true)}
                className="mt-2 flex items-center gap-1.5 rounded border-2 border-dashed border-[var(--rf-gold)] bg-[var(--rf-gold)]/20 px-2 py-1 text-[11px] font-bold hover:bg-[var(--rf-gold)]/40"
                title="Xtra Goose Entry ready."
              >
                <span aria-hidden>🎟️🪿</span> Use your Xtra Goose Entry — add a second answer
              </button>
            )}
          {showSecondBox && (
            <div className="mt-3 rounded border-2 border-[var(--rf-gold)] bg-[var(--rf-gold)]/10 p-2">
              <p className="text-[11px] font-bold">
                🎟️ Xtra Goose Entry {state.extra_entry_status === "used" ? "— used ✓" : "in play"}
              </p>
              <textarea
                value={answer2}
                onChange={(e) => setAnswer2(e.target.value)}
                maxLength={800}
                rows={3}
                placeholder="Your second answer…"
                className="mt-1 w-full rounded border-[3px] border-[var(--rf-ink)] bg-white px-2 py-1.5 text-sm"
              />
              <div className="mt-1 flex items-center justify-between">
                <span className="text-[10px] text-[var(--rf-ink-soft)]">
                  Also anonymous — the Keeper can’t tell your two answers apart.
                </span>
                <button
                  type="button"
                  disabled={pending || answer2.trim().length < 1}
                  onClick={() =>
                    run(
                      () => submitGooseAnswer(answer2, 2),
                      state.my_answer_2 ? "Second answer updated." : "Second answer submitted! 🎟️",
                    )
                  }
                  className="pixel-btn text-xs disabled:opacity-50"
                >
                  {state.my_answer_2 ? "Update 2nd answer" : "Submit 2nd answer"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Selection phase, non-keeper --------------------------------------- */}
      {!state.i_am_keeper && state.status === "selection_open" && !wonEgg && (
        <p className="text-sm">
          Answers are in! The Golden Goose Keeper is choosing a favorite now.
          {state.i_submitted ? " Fingers crossed for your answer. 🍀" : ""}
        </p>
      )}

      {/* F. Ended states ---------------------------------------------------- */}
      {(state.status === "completed" || state.status === "auto_completed") && !wonEgg && (
        <p className="text-sm">
          The Golden Goose Egg has been sent. Thanks for taking part — the goose
          will visit again on another Golden Goose day. 🪿
        </p>
      )}
      {state.status === "expired_no_submissions" && (
        <p className="text-sm">
          The Golden Goose moved on this time. See you on the next Golden Goose day.
        </p>
      )}

      <OptInToggle optIn={state.opt_in} excludedUntil={state.excluded_until} run={run} pending={pending} />
      <Banner msg={msg} />
    </div>
  );
}

function EggReveal({ rewards }: { rewards: { reward_type: string; amount: number }[] }) {
  const water = rewards.filter((r) => r.reward_type === "water").reduce((s, r) => s + r.amount, 0);
  const seed = rewards.filter((r) => r.reward_type === "seed").reduce((s, r) => s + r.amount, 0);
  const fert = rewards.filter((r) => r.reward_type === "fertilizer").reduce((s, r) => s + r.amount, 0);
  const coin = rewards.filter((r) => r.reward_type === "coin").reduce((s, r) => s + r.amount, 0);
  return (
    <div className="mb-4 rounded-lg border-2 border-[var(--rf-ink)] bg-[var(--rf-cream)] p-3 text-center">
      <p className="text-sm font-bold">Your answer was chosen! 🎉</p>
      <div className="my-2 flex justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={SPRITES.gooseEgg} alt="Golden Goose Egg" className="rf-egg-wiggle pixelated" style={{ height: 56 }} />
      </div>
      <p className="text-xs text-[var(--rf-ink-soft)]">The Golden Goose Egg opened:</p>
      <div className="mt-1 flex justify-center gap-3 text-sm font-extrabold">
        {water > 0 && <span className="rf-reward-pop inline-flex items-center gap-1" style={{ animationDelay: "0.05s" }}><PixelIcon name="water" size={16} /> {water}</span>}
        {seed > 0 && <span className="rf-reward-pop inline-flex items-center gap-1" style={{ animationDelay: "0.2s" }}><PixelIcon name="seed" size={16} /> {seed}</span>}
        {fert > 0 && <span className="rf-reward-pop inline-flex items-center gap-1" style={{ animationDelay: "0.35s" }}><PixelIcon name="fertilizer" size={16} /> {fert}</span>}
        {coin > 0 && <span className="rf-reward-pop inline-flex items-center gap-1" style={{ animationDelay: "0.5s" }}><PixelIcon name="coin" size={16} /> {coin}</span>}
      </div>
    </div>
  );
}

function OptInToggle({
  optIn,
  excludedUntil,
  run,
  pending,
}: {
  optIn: boolean;
  excludedUntil: string | null;
  run: (fn: () => Promise<{ ok: boolean; message?: string }>, okText: string) => void;
  pending: boolean;
}) {
  const excluded = excludedUntil && new Date(excludedUntil) > new Date();
  return (
    <div className="mt-4 border-t-2 border-dashed border-[var(--rf-ink)]/30 pt-3">
      <label className="flex items-center gap-2 text-[11px] font-bold">
        <input
          type="checkbox"
          checked={optIn}
          disabled={pending}
          onChange={(e) => run(() => setGooseOptIn(e.target.checked), "Golden Goose setting saved.")}
        />
        Include me in Golden Goose Keeper selection
      </label>
      {excluded && (
        <p className="mt-1 text-[11px] text-[var(--rf-ink-soft)]">
          The Golden Goose moved on before a pick last time, so you’ll take a
          short break from being selected again. You can still answer future
          requests.
        </p>
      )}
    </div>
  );
}
