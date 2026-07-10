"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/pixel/ui";
import {
  REWARD_TYPES,
  SCHEDULE_MODES,
  GARDEN_FREQUENCIES,
  WEEKDAYS,
  SETTING_SECTIONS,
  SETTING_DEFS_BY_KEY,
  mergeSettings,
  formatSettingValue,
  type SettingDef,
  type SettingValue,
  type SettingOverrideRow,
} from "@/lib/gameSettings";
import type { AdminChecklistGoal } from "@/lib/admin";
import {
  updateGameSettings,
  resetGameSettings,
  updateChecklistReward,
} from "@/app/admin/actions";

const inputClass =
  "border-[3px] border-[var(--rf-ink)] bg-white px-2 py-1.5 text-xs rounded";

const eq = (a: SettingValue, b: SettingValue) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------
// A single setting field, rendered by kind.
// ---------------------------------------------------------------------------
function Field({
  def,
  value,
  dirty,
  onChange,
}: {
  def: SettingDef;
  value: SettingValue;
  dirty: boolean;
  onChange: (v: SettingValue) => void;
}) {
  const customized = !eq(value, def.default);

  let control: React.ReactNode = null;
  if (def.kind === "reward_type") {
    control = (
      <select className={inputClass} value={value as string} onChange={(e) => onChange(e.target.value as SettingValue)}>
        {REWARD_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    );
  } else if (def.kind === "boolean") {
    control = (
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`pixel-btn text-[11px] ${value ? "" : "pixel-btn--secondary"}`}
      >
        {value ? "On" : "Off"}
      </button>
    );
  } else if (def.kind === "number" || def.kind === "days_per_week") {
    const min = def.min ?? 0;
    const max = def.kind === "days_per_week" ? 7 : def.max;
    control = (
      <input
        type="number"
        min={min}
        max={max}
        className={`${inputClass} w-24`}
        value={String(value)}
        onChange={(e) => {
          const n = Math.max(min, Math.floor(Number(e.target.value) || 0));
          onChange(max !== undefined ? Math.min(max, n) : n);
        }}
      />
    );
  } else if (def.kind === "enabled_days") {
    const days = (value as number[]) ?? [];
    control = (
      <div className="flex flex-wrap gap-1">
        {WEEKDAYS.map((d) => {
          const on = days.includes(d.value);
          return (
            <button
              key={d.value}
              type="button"
              onClick={() =>
                onChange(
                  on ? days.filter((x) => x !== d.value) : [...days, d.value].sort((a, b) => a - b),
                )
              }
              className={`rounded border-2 border-[var(--rf-ink)] px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                on ? "bg-[var(--rf-gold)]" : "bg-[var(--rf-cream)] text-[var(--rf-ink-soft)]"
              }`}
            >
              {d.short}
            </button>
          );
        })}
      </div>
    );
  } else if (def.kind === "text") {
    control = (
      <input
        type="text"
        maxLength={40}
        className={`${inputClass} w-44`}
        value={value as string}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  } else if (def.kind === "schedule_mode") {
    control = (
      <select className={inputClass} value={value as string} onChange={(e) => onChange(e.target.value as SettingValue)}>
        {SCHEDULE_MODES.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    );
  } else if (def.kind === "garden_frequency") {
    control = (
      <select className={inputClass} value={value as string} onChange={(e) => onChange(e.target.value as SettingValue)}>
        {GARDEN_FREQUENCIES.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--rf-ink)]/10 py-1.5 last:border-0">
      <div className="min-w-0">
        <span className="text-xs font-bold">{def.label}</span>
        {dirty && <span className="ml-1 text-[10px] font-bold text-[var(--rf-blue)]">● changed</span>}
        {!dirty && customized && (
          <span className="ml-1 text-[10px] font-bold text-[var(--rf-ink-soft)]">customized</span>
        )}
        <span className="ml-1 text-[10px] text-[var(--rf-ink-soft)]">
          (default: {formatSettingValue(def, def.default)})
        </span>
        {def.help && <p className="text-[10px] text-[var(--rf-ink-soft)]">{def.help}</p>}
      </div>
      {control}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Schedule control: mode + (random days-per-week OR specific weekday picker).
// ---------------------------------------------------------------------------
function ScheduleControl({
  prefix,
  valueOf,
  dirtyOf,
  onChange,
}: {
  prefix: string;
  valueOf: (k: string) => SettingValue;
  dirtyOf: (k: string) => boolean;
  onChange: (k: string, v: SettingValue) => void;
}) {
  const modeKey = `${prefix}_schedule_mode`;
  const dpwKey = `${prefix}_random_days_per_week`;
  const daysKey = `${prefix}_enabled_days`;
  const mode = valueOf(modeKey) as string;

  return (
    <div className="space-y-1">
      <Field def={SETTING_DEFS_BY_KEY[modeKey]} value={valueOf(modeKey)} dirty={dirtyOf(modeKey)} onChange={(v) => onChange(modeKey, v)} />
      {mode === "random" ? (
        <Field def={SETTING_DEFS_BY_KEY[dpwKey]} value={valueOf(dpwKey)} dirty={dirtyOf(dpwKey)} onChange={(v) => onChange(dpwKey, v)} />
      ) : (
        <Field def={SETTING_DEFS_BY_KEY[daysKey]} value={valueOf(daysKey)} dirty={dirtyOf(daysKey)} onChange={(v) => onChange(daysKey, v)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Checklist goal reward editor (water + fertilizer per goal).
// ---------------------------------------------------------------------------
function ChecklistGoalRow({ g }: { g: AdminChecklistGoal }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [water, setWater] = useState(g.water_reward);
  const [fert, setFert] = useState(g.fertilizer_reward);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = water !== g.water_reward || fert !== g.fertilizer_reward;

  function save() {
    setMsg(null);
    startTransition(async () => {
      const r = await updateChecklistReward(g.id, water, fert);
      if (!r.ok) setMsg({ ok: false, text: r.message });
      else {
        setMsg({ ok: true, text: "Saved." });
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--rf-ink)]/10 py-1.5 last:border-0">
      <div className="min-w-0">
        <span className="text-xs font-bold">{g.name}</span>
        {!g.active && <span className="ml-1 text-[10px] text-[var(--rf-ink-soft)]">(inactive)</span>}
        {msg && (
          <span className={`ml-2 text-[10px] font-bold ${msg.ok ? "text-[var(--rf-grass-dark)]" : "text-[var(--rf-red)]"}`}>
            {msg.text}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <label className="text-[10px] font-bold uppercase text-[var(--rf-ink-soft)]">💧</label>
        <input type="number" min={0} value={String(water)} disabled={pending}
          onChange={(e) => setWater(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
          className={`${inputClass} w-16`} />
        <label className="text-[10px] font-bold uppercase text-[var(--rf-ink-soft)]">🌰</label>
        <input type="number" min={0} value={String(fert)} disabled={pending}
          onChange={(e) => setFert(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
          className={`${inputClass} w-16`} />
        <button type="button" disabled={!dirty || pending} onClick={save}
          className="pixel-btn pixel-btn--blue text-[11px] disabled:opacity-50">
          Save
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function GameSettings({
  overrides,
  goals,
}: {
  overrides: SettingOverrideRow[];
  goals: AdminChecklistGoal[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [edits, setEdits] = useState<Record<string, SettingValue>>({});
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const effective = useMemo(() => mergeSettings(overrides), [overrides]);

  const valueOf = (k: string): SettingValue => (k in edits ? edits[k] : effective[k].value);
  const dirtyOf = (k: string): boolean => k in edits && !eq(edits[k], effective[k].value);

  const dirtyKeys = Object.keys(edits).filter((k) => dirtyOf(k));

  function onChange(k: string, v: SettingValue) {
    setEdits((prev) => ({ ...prev, [k]: v }));
  }

  function save() {
    if (dirtyKeys.length === 0) return;
    setBanner(null);
    const payload: Record<string, SettingValue> = {};
    for (const k of dirtyKeys) payload[k] = valueOf(k);
    startTransition(async () => {
      const r = await updateGameSettings(payload);
      if (!r.ok) setBanner({ ok: false, text: r.message });
      else {
        setEdits({});
        setBanner({ ok: true, text: "Settings saved." });
        router.refresh();
      }
    });
  }

  function reset() {
    setBanner(null);
    startTransition(async () => {
      const r = await resetGameSettings();
      if (!r.ok) setBanner({ ok: false, text: r.message });
      else {
        setEdits({});
        setBanner({ ok: true, text: "Reset to defaults." });
        router.refresh();
      }
      setConfirmReset(false);
    });
  }

  return (
    <div className="space-y-4">
      {/* Sticky-ish action bar */}
      <Panel className="flex flex-wrap items-center justify-between gap-2 !p-3">
        <p className="text-xs text-[var(--rf-ink-soft)]">
          {dirtyKeys.length > 0
            ? `${dirtyKeys.length} unsaved change${dirtyKeys.length === 1 ? "" : "s"}.`
            : "All settings match what’s saved."}{" "}
          Rewards can only be water, seed, or fertilizer — never Fruits.
        </p>
        <div className="flex gap-2">
          {confirmReset ? (
            <>
              <span className="self-center text-[11px] font-bold">Reset all to defaults?</span>
              <button type="button" disabled={pending} onClick={reset}
                className="pixel-btn text-[11px] disabled:opacity-50"
                style={{ background: "var(--rf-red)", color: "var(--rf-cream)" }}>
                Yes, reset
              </button>
              <button type="button" disabled={pending} onClick={() => setConfirmReset(false)}
                className="pixel-btn pixel-btn--secondary text-[11px]">
                Cancel
              </button>
            </>
          ) : (
            <button type="button" disabled={pending} onClick={() => setConfirmReset(true)}
              className="pixel-btn pixel-btn--secondary text-[11px]">
              Reset to defaults
            </button>
          )}
          <button type="button" disabled={pending || dirtyKeys.length === 0} onClick={save}
            className="pixel-btn text-[11px] disabled:opacity-50">
            {pending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </Panel>

      {banner && (
        <p role={banner.ok ? "status" : "alert"}
          className={`rounded border-2 border-[var(--rf-ink)] px-3 py-2 text-xs font-bold ${
            banner.ok ? "bg-[var(--rf-grass)]" : "bg-[var(--rf-red)] text-[var(--rf-cream)]"
          }`}>
          {banner.text}
        </p>
      )}

      {SETTING_SECTIONS.map((section) => (
        <Panel key={section.id}>
          <h2 className="pixel-heading text-lg">{section.title}</h2>
          {section.blurb && (
            <p className="mb-2 text-[11px] text-[var(--rf-ink-soft)]">{section.blurb}</p>
          )}
          <div className="space-y-3">
            {section.groups.map((group) => {
              const scheduleKey = group.keys.find((k) => k.endsWith("_schedule_mode"));
              const scheduleKeys = scheduleKey
                ? new Set([
                    scheduleKey,
                    scheduleKey.replace("_schedule_mode", "_random_days_per_week"),
                    scheduleKey.replace("_schedule_mode", "_enabled_days"),
                  ])
                : new Set<string>();
              const prefix = scheduleKey?.replace("_schedule_mode", "") ?? "";
              return (
                <div key={group.title}>
                  <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[var(--rf-ink-soft)]">
                    {group.title}
                  </h3>
                  {scheduleKey && (
                    <ScheduleControl prefix={prefix} valueOf={valueOf} dirtyOf={dirtyOf} onChange={onChange} />
                  )}
                  {group.keys
                    .filter((k) => !scheduleKeys.has(k))
                    .map((k) => (
                      <Field key={k} def={SETTING_DEFS_BY_KEY[k]} value={valueOf(k)} dirty={dirtyOf(k)} onChange={(v) => onChange(k, v)} />
                    ))}
                </div>
              );
            })}
          </div>
        </Panel>
      ))}

      {/* Checklist goal rewards (water + fertilizer per goal; never Fruits) */}
      <Panel>
        <h2 className="pixel-heading text-lg">Checklist goal rewards</h2>
        <p className="mb-2 text-[11px] text-[var(--rf-ink-soft)]">
          Each monthly goal grants 💧 water and 🌰 fertilizer when completed.
          Edits apply the next time a goal is completed.
        </p>
        <div>
          {goals.map((g) => (
            <ChecklistGoalRow key={g.id} g={g} />
          ))}
          {goals.length === 0 && (
            <p className="text-sm text-[var(--rf-ink-soft)]">No checklist goals defined.</p>
          )}
        </div>
      </Panel>
    </div>
  );
}
