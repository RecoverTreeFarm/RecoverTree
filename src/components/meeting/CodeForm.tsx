"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Panel } from "@/components/pixel/ui";
import { redeemCode } from "@/app/meeting-code/actions";

type Result =
  | { ok: true; water_awarded: number; host_username: string | null }
  | { ok: false; message: string };

/** Four chunky digit boxes with auto-advance, submitting to the server. */
export function CodeForm() {
  const router = useRouter();
  const [digits, setDigits] = useState(["", "", "", ""]);
  const [result, setResult] = useState<Result | null>(null);
  const [pending, startTransition] = useTransition();
  const refs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];

  const code = digits.join("");
  const complete = code.length === 4 && digits.every((d) => /^[0-9]$/.test(d));

  function setDigit(i: number, value: string) {
    const v = value.replace(/[^0-9]/g, "").slice(-1);
    setDigits((prev) => {
      const next = [...prev];
      next[i] = v;
      return next;
    });
    if (v && i < 3) refs[i + 1].current?.focus();
  }

  function handleKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      refs[i - 1].current?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    const text = e.clipboardData.getData("text").replace(/[^0-9]/g, "").slice(0, 4);
    if (text.length === 4) {
      e.preventDefault();
      setDigits(text.split(""));
      refs[3].current?.focus();
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!complete) return;
    setResult(null);
    startTransition(async () => {
      const r = await redeemCode(code);
      setResult(r);
      if (r.ok) setDigits(["", "", "", ""]);
      router.refresh();
    });
  }

  if (result?.ok) {
    return (
      <Panel className="max-w-md text-center">
        <p className="text-3xl" aria-hidden>🎉</p>
        <h2 className="pixel-heading mt-1 text-xl">Checked in!</h2>
        <p className="mt-3 flex items-center justify-center gap-2 text-sm font-bold">
          💧 +{result.water_awarded} water
        </p>
        {result.host_username && (
          <p className="mt-1 text-xs text-[var(--rf-ink-soft)]">
            Meeting hosted by @{result.host_username}
          </p>
        )}
        <p className="mt-3 text-xs text-[var(--rf-ink-soft)]">
          Your farmer has water for the trees. Keep showing up. 🌱
        </p>
        <div className="mt-4 flex justify-center gap-3">
          <Link href="/dashboard" className="pixel-btn">
            Water your farm
          </Link>
          <button
            type="button"
            className="pixel-btn pixel-btn--secondary"
            onClick={() => setResult(null)}
          >
            Enter another code
          </button>
        </div>
      </Panel>
    );
  }

  return (
    <Panel className="max-w-md">
      <form onSubmit={handleSubmit}>
        <label className="mb-2 block text-xs font-bold uppercase tracking-wide">
          4-digit code
        </label>
        <div className="flex gap-2" onPaste={handlePaste}>
          {digits.map((d, i) => (
            <input
              key={i}
              ref={refs[i]}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={1}
              value={d}
              onChange={(e) => setDigit(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              aria-label={`code digit ${i + 1}`}
              className="h-14 w-14 rounded border-[3px] border-[var(--rf-ink)] bg-white text-center text-2xl font-extrabold"
            />
          ))}
        </div>

        <button
          type="submit"
          disabled={!complete || pending}
          className="pixel-btn mt-5 w-full disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Checking in…" : "Check in"}
        </button>

        {result && !result.ok && (
          <p role="alert" className="mt-3 rounded border-2 border-[var(--rf-ink)] bg-[var(--rf-gold)] px-3 py-2 text-xs font-bold">
            {result.message}
          </p>
        )}
      </form>
    </Panel>
  );
}
