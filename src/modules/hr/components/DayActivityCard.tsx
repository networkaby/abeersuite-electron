"use client";

// One day, one card — the day's activity report.
//
// Owner, 2026-09-22: *"every day one card, in the card day activity report, like
// auto granted hours, late penalty etc."* So the card is not a prettier table
// row: it carries the whole working for that day, in the order a person argues
// about it — when they came and went, how many separate stretches, what was
// owed, what was credited, what was granted automatically, what the lateness
// cost, and the one-line sum at the bottom.
//
// Nothing is computed here. The minutes, the grade and the late penalty all
// arrive from the server, worked out by the very functions payroll uses — a card
// that did its own arithmetic would be a second opinion, and the whole point is
// that there is only one.
//
// Owner, 2026-10-13: the card is the AUTO side of the day, and a wrong figure is
// corrected right here rather than the whole day being refused. Given
// `onCorrect`, Worked and Late by are editable; a corrected figure shows the
// till's own beside it and can be handed back. The server re-works the day.

import { useState } from "react";
import { ArrowRight, Check, Pencil, Undo2, X } from "lucide-react";
import { NumericInput } from "@/shared/components/NumericInput";
import { formatWorked } from "@/shared/lib/hr/dutyTime";
import { cn } from "@/shared/lib/format/utils";
import { pendingTotal, type PayRules } from "@/shared/lib/hr/payRules";
import { accountDay, pendingBreakup, type AccountLine, type DayBreakup, type TimelineRow } from "../lib/attendanceBreakup";

const fmtTime = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—";

const fmtDay = (iso: string) =>
    new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });

/** Each line of the day, in plain words. */
const TIMELINE_LABEL: Record<TimelineRow["kind"], string> = {
    late:  "Not yet came",
    on:    "On duty",
    off:   "Off duty",
    early: "Left early",
};

/** "HALF_DAY" → "half day". The words are for a reader, not for a database. */
const inWords = (s: string) => s.toLowerCase().replace(/_/g, " ");

/** A dash rather than a zero: a column of noughts is harder to read than a gap. */
const orDash = (minutes: number) => (minutes > 0 ? formatWorked(minutes) : "—");

const GRADE_TONE: Record<string, string> = {
    PRESENT:     "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
    HALF_DAY:    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    ABSENT:      "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    LEAVE:       "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
    WEEKLY_OFF:  "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    HOLIDAY:     "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
};

/** Which of the till's figures a person may correct on the card. */
export type CorrectableField = "worked" | "late";

export default function DayActivityCard({ day, rules, idleLimitMinutes, isToday, onCorrect }: {
    day: DayBreakup;
    rules: PayRules;
    /** The gap after which the clock stops counting — why "away" was not credited. */
    idleLimitMinutes: number;
    isToday: boolean;
    /** Correct (minutes) or hand back to the till (null). Absent = read-only card. */
    onCorrect?: (field: CorrectableField, minutes: number | null) => Promise<void>;
}) {
    // First in and last out from the day in order, not the raw stretches: old
    // ledgers can hold overlapping stretches, and the last one is not the latest.
    const onLines = day.timeline.filter((r) => r.kind === "on");
    const first = onLines[0]?.from ?? null;
    const lastOn = onLines[onLines.length - 1];
    const last = lastOn && !lastOn.open ? lastOn.to : null;
    const reads = day.status || day.grade;
    const shut = day.weeklyOff || !!day.holidayName;
    const account = accountDay(day, rules);

    // A day with no stretches is not a day with no hours — it is a day from
    // before this was recorded, or one nobody worked. A card full of zeroes would
    // read as an absence, so it stays a single honest line.
    if (!day.tracked) {
        return (
            <article className="rounded-lg border border-border bg-card px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="font-medium">{fmtDay(day.date)}</span>
                    {/* Only a mark somebody actually made. The clock's grade for a day
                        it never measured is ABSENT — arithmetically true, and a lie to
                        put on screen: nought minutes of a day nobody recorded is not
                        evidence that nobody came. */}
                    {day.status && <Chip tone={GRADE_TONE[day.status]}>{inWords(day.status)}</Chip>}
                    {day.holidayName && <Chip tone={GRADE_TONE.HOLIDAY}>{day.holidayName}</Chip>}
                    {!day.holidayName && day.weeklyOff && <Chip tone={GRADE_TONE.WEEKLY_OFF}>weekly off</Chip>}
                    {day.leaveKind && <Chip tone={GRADE_TONE.LEAVE}>{inWords(day.leaveKind)} leave</Chip>}
                    <span className="text-xs text-muted-foreground italic">not tracked in detail</span>
                    {day.manual && <span className="text-xs text-muted-foreground">· marked by office</span>}
                    <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
                        duty {day.dutyStart}–{day.dutyEnd}
                    </span>
                </div>
                {day.note && <p className="mt-1 text-xs text-muted-foreground">Note: {day.note}</p>}
                {/* An absence penalty lands on a day with no stretches, and it is
                    exactly the line a person asks about later. */}
                {day.pending && day.pending.added.length > 0 && (
                    <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                        +{formatWorked(pendingTotal(day.pending.added))} → pending ({pendingBreakup(day.pending.added)}) · pending after today: {formatWorked(pendingTotal(day.pending.after))}
                    </p>
                )}
            </article>
        );
    }

    return (
        <article className={cn("rounded-lg border bg-card", isToday ? "border-primary/60" : "border-border")}>
            {/* Head — the day, and what it reads as */}
            <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-2">
                <span className="text-sm font-semibold">{fmtDay(day.date)}</span>
                {isToday && <span className="text-[11px] font-medium text-primary">today</span>}
                <Chip tone={GRADE_TONE[reads] ?? GRADE_TONE.PRESENT}>{inWords(reads)}</Chip>
                {day.holidayName && <Chip tone={GRADE_TONE.HOLIDAY}>{day.holidayName}</Chip>}
                {!day.holidayName && day.weeklyOff && <Chip tone={GRADE_TONE.WEEKLY_OFF}>weekly off</Chip>}
                {day.leaveKind && <Chip tone={GRADE_TONE.LEAVE}>{inWords(day.leaveKind)} leave</Chip>}
                {/* An override that hides what it overrode is how a dispute becomes
                    unanswerable, so the clock's own answer stays beside it. */}
                {day.manual && (
                    <span className="text-xs text-muted-foreground">
                        marked by office{!shut && day.status !== day.grade && ` · clock said ${inWords(day.grade)}`}
                    </span>
                )}
                <span className="ml-auto flex items-center gap-1.5 font-mono text-xs tabular-nums text-muted-foreground">
                    {fmtTime(first)} <ArrowRight size={11} /> {fmtTime(last)}
                </span>
            </header>

            {/* The figures the day was arrived at from */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-4 lg:grid-cols-9">
                <Figure label="Duty window" value={`${day.dutyStart}–${day.dutyEnd}`} hint="The shop's hours on this very date — they move through the year" />
                <Figure label="Expected Duty Hours" value={formatWorked(day.dutyMinutes)} hint="The full duty as per the Duty window — not the time he was present" />
                {/* Owner, 2026-10-13: "actual worked, adjusted worked" — the till's
                    own measurement always shows, even on a Manual day that pays on
                    the office's mark; the adjusted figure is the one pay uses. */}
                <Figure label="Actual Worked" value={formatWorked(day.till.workedMinutes)} hint="What the counter measured — never changed by hand" />
                <CorrectableFigure
                    label="Adjusted Worked" minutes={day.workedMinutes} till={day.till.workedMinutes} corrected={day.corrected.worked}
                    strong hint="What pay uses on an Auto day — the counter's figure unless it was corrected"
                    onCorrect={onCorrect && ((m) => onCorrect("worked", m))}
                />
                <Figure label="Times active" value={String(day.activeCount)} hint="Separate stretches at the machine" />
                <Figure label="Away" value={orDash(day.idleMinutes)} hint={`Between stretches. A gap past ${idleLimitMinutes} min stops the clock — not counted, not paid`} />
                <CorrectableFigure
                    label="Late by" minutes={day.lateBy} till={day.till.lateBy} corrected={day.corrected.late}
                    tone={day.lateBy > 0 ? "warn" : undefined} dashZero
                    hint={`Against ${day.dutyStart}, after ${rules.lateGraceMinutes} min of grace`}
                    onCorrect={onCorrect && ((m) => onCorrect("late", m))}
                />
                {/* A day the shop was shut owes nothing, so it cannot be left early
                    and cannot fall short. The rules agree — `attendanceEffectFor`
                    takes such a day out of the netting entirely and pays every
                    minute of it at its own rate. Showing "7h short" against a duty
                    nobody owed would be the screen inventing a debt. */}
                <Figure
                    label="Left early"
                    value={shut ? "—" : orDash(day.leftEarlyBy)}
                    tone={!shut && day.leftEarlyBy > 0 ? "warn" : undefined}
                    hint={shut ? "Not judged — the shop was shut" : `Short of ${day.dutyEnd}. A day still running shows a dash`}
                />
                <Figure
                    label="Over / short"
                    value={shut ? "—" : day.overtimeMinutes > 0 ? `+${formatWorked(day.overtimeMinutes)}` : day.shortMinutes > 0 ? `−${formatWorked(day.shortMinutes)}` : "—"}
                    tone={shut ? undefined : day.overtimeMinutes > 0 ? "good" : day.shortMinutes > 0 ? "warn" : undefined}
                    hint={shut ? "Not judged — every minute of a shut day is granted at its own rate" : "Against the day's duty — extra first makes up pending duty, short goes to pending"}
                />
            </div>

            {/* The accounting — every line with its rate, and the column added up.
                Owner, 2026-09-22: "normal day @1, overtime @1.5, late penalty real
                late × x = accounted penalty time … then we sum to get the day total."
                A line that costs nothing still shows, greyed: the reader sees the
                free late day being spent rather than finding out on a payslip. */}
            <div className="border-t border-border px-4 py-2">
                <p className="mb-1 text-[11px] font-medium text-muted-foreground">How the day is accounted</p>
                <table className="w-full text-xs">
                    <thead>
                        <tr className="text-[11px] text-muted-foreground">
                            <th className="py-0.5 text-left font-normal">Line</th>
                            <th className="py-0.5 text-right font-normal">Minutes</th>
                            <th className="py-0.5 text-right font-normal">Rate</th>
                            <th className="py-0.5 text-right font-normal">Accounted</th>
                            <th className="hidden py-0.5 pl-3 text-left font-normal sm:table-cell">Why</th>
                        </tr>
                    </thead>
                    <tbody>
                        {account.lines.map((l) => <AccountRow key={l.key} line={l} />)}
                    </tbody>
                    <tfoot>
                        <tr className="border-t border-border font-medium text-foreground">
                            <td className="py-1">Day total</td>
                            <td />
                            <td />
                            <td className="py-1 text-right font-mono tabular-nums">{signed(account.total)}</td>
                            <td className="hidden py-1 pl-3 text-[11px] font-normal text-muted-foreground sm:table-cell">
                                {shut ? "paid at its own rate, outside pending duty" : "duty − penalty + extra time"}
                            </td>
                        </tr>
                        {/* Owner, 2026-10-13: the short is neither today's time nor a
                            penalty, so it sits below the total and is never part of it —
                            expected − day total, carried forward when it falls short. */}
                        {!shut && (
                            <>
                                <tr className={cn("text-[11px]", account.carry.minutes > 0 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground/60")}>
                                    <td className="pt-1.5">Short of duty — carried forward</td>
                                    <td className="pt-1.5 text-right font-mono tabular-nums">{orDash(account.carry.minutes)}</td>
                                    <td />
                                    <td />
                                    <td className="hidden pt-1.5 pl-3 sm:table-cell">{account.carry.note ?? ""}</td>
                                </tr>
                                <tr className="text-[11px] text-muted-foreground">
                                    <td>Pending after today</td>
                                    <td className="text-right font-mono tabular-nums">
                                        {orDash(day.pending ? pendingTotal(day.pending.after) : 0)}
                                    </td>
                                    <td />
                                    <td />
                                    <td className="hidden pl-3 sm:table-cell">made up by a later day&apos;s extra, or cut at month end</td>
                                </tr>
                            </>
                        )}
                    </tfoot>
                </table>
            </div>

            {/* Whatever the office wrote on the day. It is the one part of a card
                nobody can work out from the clock, so it is never a tooltip. */}
            {day.note && (
                <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
                    <span className="font-medium">Note:</span> {day.note}
                </p>
            )}

            {/* The day in order — owner, 2026-10-13: "full day in the list, on
                duty, off duty in sequence." Off-duty lines are red, so the gaps
                that cost him are the first thing the eye lands on. */}
            {day.timeline.length > 0 && (
                <div className="border-t border-border px-4 py-2">
                    <p className="mb-1 text-[11px] font-medium text-muted-foreground">The day in order</p>
                    <ul className="space-y-0.5 text-xs">
                        {day.timeline.map((r, i) => {
                            const away = r.kind !== "on";
                            return (
                                <li
                                    key={`${r.kind}-${r.from ?? r.to}-${i}`}
                                    className={cn("flex flex-wrap items-center gap-x-2", away ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}
                                >
                                    <span className="font-mono tabular-nums whitespace-nowrap">
                                        {r.from ? fmtTime(r.from) : day.dutyStart} – {r.open ? "now" : r.to ? fmtTime(r.to) : day.dutyEnd}
                                    </span>
                                    <span className={cn("w-24 shrink-0", !away && "text-foreground")}>{TIMELINE_LABEL[r.kind]}</span>
                                    <span className={cn("font-medium tabular-nums", !away && "text-foreground")}>{formatWorked(r.minutes)}</span>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}

            {/* The sum said out loud, because "why is this a half day" is the
                question this whole screen exists to answer. */}
            <footer className="border-t border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
                {shut
                    ? <>Worked {formatWorked(day.workedMinutes)} on a day the shop was shut — no duty due</>
                    : <>Worked {formatWorked(day.workedMinutes)} of {formatWorked(day.dutyMinutes)} due ({day.dutyStart}–{day.dutyEnd})</>}
                {day.idleMinutes > 0 && <> · away {formatWorked(day.idleMinutes)} in between, not counted</>}
                {!shut && day.lateBy > 0 && <> · late by {formatWorked(day.lateBy)}</>}
                {!shut && day.leftEarlyBy > 0 && <> · left {formatWorked(day.leftEarlyBy)} early</>}
                {/* A shut day is not graded. The clock would call 3h against a
                    ten-hour duty an absence, which on a holiday is nonsense: there
                    was no duty to fall short of. */}
                {" "}· accounted <span className="font-medium text-foreground">{signed(account.total)}</span>
                {!shut && <>{" "}→ <span className="font-medium text-foreground">{inWords(day.grade)}</span></>}
                {!shut && day.manual && day.status !== day.grade && <> · office says {inWords(day.status)}</>}
            </footer>
        </article>
    );
}

/** "+1h 08m", "−46m", "—" for nought. The sign is the whole point of the column. */
const signed = (minutes: number) =>
    minutes === 0 ? "—" : minutes < 0 ? `−${formatWorked(-minutes)}` : formatWorked(minutes);

function AccountRow({ line }: { line: AccountLine }) {
    // A carried pending figure is read in its label, so it is never greyed.
    const carried = line.key === "pending" && !!line.note;
    const idle = line.minutes === 0 && line.accounted === 0 && !carried;
    return (
        <tr className={cn(idle && "text-muted-foreground/60", carried && "text-amber-600 dark:text-amber-400")}>
            <td className="py-0.5">{line.label}</td>
            <td className="py-0.5 text-right font-mono tabular-nums">{line.minutes > 0 ? formatWorked(line.minutes) : "—"}</td>
            <td className="py-0.5 text-right font-mono tabular-nums text-muted-foreground">{line.rateLabel}</td>
            <td className={cn(
                "py-0.5 text-right font-mono tabular-nums whitespace-nowrap",
                line.accounted < 0 && "text-amber-600 dark:text-amber-400",
                line.accounted > 0 && line.key !== "duty" && "text-emerald-600 dark:text-emerald-400",
            )}>
                {line.key === "duty" ? (line.accounted > 0 ? formatWorked(line.accounted) : "—") : signed(line.accounted)}
            </td>
            <td className="hidden py-0.5 pl-3 text-[11px] text-muted-foreground sm:table-cell">
                {line.note ?? ""}
            </td>
        </tr>
    );
}

function Chip({ tone, children }: { tone?: string; children: React.ReactNode }) {
    return (
        <span className={cn("rounded px-1.5 py-px text-[11px] font-medium", tone ?? "bg-muted text-muted-foreground")}>
            {children}
        </span>
    );
}

function Figure({ label, value, hint, strong, tone }: {
    label: string;
    value: string;
    hint?: string;
    strong?: boolean;
    tone?: "good" | "warn";
}) {
    return (
        <div title={hint}>
            <div className="text-[11px] text-muted-foreground">{label}</div>
            <div className={cn(
                "font-mono text-sm tabular-nums",
                strong && "font-semibold",
                tone === "good" && "text-emerald-600 dark:text-emerald-400",
                tone === "warn" && "text-amber-600 dark:text-amber-400",
            )}>
                {value}
            </div>
        </div>
    );
}

/**
 * A figure the till measured that a person may correct. Shows the corrected
 * value with the till's own beside it, so the override never hides what it
 * overrode; ↺ hands the figure back to the till.
 */
function CorrectableFigure({ label, minutes, till, corrected, hint, strong, tone, dashZero, onCorrect }: {
    label: string;
    minutes: number;
    till: number;
    corrected: boolean;
    hint?: string;
    strong?: boolean;
    tone?: "good" | "warn";
    dashZero?: boolean;
    onCorrect?: (minutes: number | null) => Promise<void>;
}) {
    const [editing, setEditing] = useState(false);
    const [h, setH] = useState("");
    const [m, setM] = useState("");
    const [saving, setSaving] = useState(false);

    const start = () => {
        setH(String(Math.floor(minutes / 60)));
        setM(String(minutes % 60));
        setEditing(true);
    };
    const save = async (value: number | null) => {
        if (!onCorrect) return;
        setSaving(true);
        try {
            await onCorrect(value);
            setEditing(false);
        } finally {
            setSaving(false);
        }
    };

    if (editing) {
        return (
            <div title={hint}>
                <div className="text-[11px] text-muted-foreground">{label}</div>
                <form
                    className="flex items-center gap-1"
                    onSubmit={(e) => { e.preventDefault(); void save((Number(h) || 0) * 60 + (Number(m) || 0)); }}
                >
                    <NumericInput value={h} onValueChange={setH} min={0} max={24} className="h-7 w-12 px-1.5 text-center text-xs" aria-label={`${label} hours`} autoFocus />
                    <span className="text-xs text-muted-foreground">h</span>
                    <NumericInput value={m} onValueChange={setM} min={0} max={59} className="h-7 w-12 px-1.5 text-center text-xs" aria-label={`${label} minutes`} />
                    <span className="text-xs text-muted-foreground">m</span>
                    <button type="submit" disabled={saving} className="rounded p-0.5 text-emerald-600 hover:bg-muted" aria-label="Save the correction"><Check size={13} /></button>
                    <button type="button" disabled={saving} onClick={() => setEditing(false)} className="rounded p-0.5 text-muted-foreground hover:bg-muted" aria-label="Cancel"><X size={13} /></button>
                </form>
            </div>
        );
    }

    const show = dashZero ? orDash(minutes) : formatWorked(minutes);
    return (
        <div title={hint}>
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                {label}
                {corrected && <span className="rounded bg-sky-500/15 px-1 text-[10px] font-medium text-sky-700 dark:text-sky-400">corrected</span>}
            </div>
            <div className="flex items-center gap-1">
                <span className={cn(
                    "font-mono text-sm tabular-nums",
                    strong && "font-semibold",
                    corrected ? "text-sky-700 dark:text-sky-400" : tone === "good" ? "text-emerald-600 dark:text-emerald-400" : tone === "warn" && "text-amber-600 dark:text-amber-400",
                )}>
                    {show}
                </span>
                {onCorrect && (
                    <button type="button" onClick={start} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Correct ${label}`} title="Correct the till's figure">
                        <Pencil size={11} />
                    </button>
                )}
                {onCorrect && corrected && (
                    <button type="button" disabled={saving} onClick={() => void save(null)} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Hand ${label} back to the till`} title="Use the till's figure again">
                        <Undo2 size={11} />
                    </button>
                )}
            </div>
            {corrected && <div className="font-mono text-[10px] tabular-nums text-muted-foreground">till: {dashZero ? orDash(till) : formatWorked(till)}</div>}
        </div>
    );
}
