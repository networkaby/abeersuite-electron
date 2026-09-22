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

import { ArrowRight } from "lucide-react";
import { formatWorked } from "@/shared/lib/hr/dutyTime";
import { cn } from "@/shared/lib/format/utils";
import type { PayRules } from "@/shared/lib/hr/payRules";
import { accountDay, type AccountLine, type DayBreakup, type SpanDto } from "../lib/attendanceBreakup";

const fmtTime = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—";

const fmtDay = (iso: string) =>
    new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });

/** Why a stretch finished, in words the reader does not have to decode. */
const ENDED_BY: Record<SpanDto["endedBy"], string> = {
    OPEN:         "still going",
    IDLE:         "left the counter",
    SIGNED_OUT:   "signed out",
    SHIFT_CLOSED: "shift closed",
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

export default function DayActivityCard({ day, rules, idleLimitMinutes, isToday }: {
    day: DayBreakup;
    rules: PayRules;
    /** The gap after which the clock stops counting — why "away" was not credited. */
    idleLimitMinutes: number;
    isToday: boolean;
}) {
    const first = day.spans[0]?.startedAt ?? null;
    const last = day.spans.length ? day.spans[day.spans.length - 1].endedAt : null;
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
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-4 lg:grid-cols-8">
                <Figure label="Duty window" value={`${day.dutyStart}–${day.dutyEnd}`} hint="The shop's hours on this very date — they move through the year" />
                <Figure label="Duty owed" value={formatWorked(day.dutyMinutes)} hint="What this day owed" />
                <Figure label="Worked" value={formatWorked(day.workedMinutes)} strong hint="Credited by the clock itself, stretch by stretch" />
                <Figure label="Times active" value={String(day.activeCount)} hint="Separate stretches at the machine" />
                <Figure label="Away" value={orDash(day.idleMinutes)} hint={`Between stretches. A gap past ${idleLimitMinutes} min stops the clock — not counted, not paid`} />
                <Figure label="Late by" value={orDash(day.lateBy)} tone={day.lateBy > 0 ? "warn" : undefined} hint={`Against ${day.dutyStart}, after ${rules.lateGraceMinutes} min of grace`} />
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
                    hint={shut ? "Not judged — every minute of a shut day is granted at its own rate" : "Against the duty owed, before the month is netted"}
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
                                {shut ? "paid at its own rate, outside the netting" : "the day on its own — before the month is netted"}
                            </td>
                        </tr>
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

            {/* The log — every stretch, in order */}
            {day.spans.length > 0 && (
                <div className="border-t border-border px-4 py-2">
                    <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                        Active {day.activeCount} {day.activeCount === 1 ? "time" : "times"}
                    </p>
                    <ul className="space-y-0.5 text-xs text-muted-foreground">
                        {day.spans.map((s, i) => (
                            <li key={`${s.startedAt}-${i}`} className="flex flex-wrap items-center gap-x-2">
                                <span className="w-4 shrink-0 tabular-nums">{i + 1}.</span>
                                <span className="font-mono tabular-nums whitespace-nowrap">{fmtTime(s.startedAt)} – {fmtTime(s.endedAt)}</span>
                                <span className="font-medium text-foreground">{formatWorked(s.minutes)}</span>
                                <span>· {ENDED_BY[s.endedBy]}</span>
                                {s.counterId ? <span>· counter {s.counterId}</span> : null}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* The sum said out loud, because "why is this a half day" is the
                question this whole screen exists to answer. */}
            <footer className="border-t border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
                {shut
                    ? <>Worked {formatWorked(day.workedMinutes)} on a day the shop was shut — no duty owed</>
                    : <>Worked {formatWorked(day.workedMinutes)} of {formatWorked(day.dutyMinutes)} owed ({day.dutyStart}–{day.dutyEnd})</>}
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
    const idle = line.minutes === 0 && line.accounted === 0;
    return (
        <tr className={cn(idle && "text-muted-foreground/60")}>
            <td className="py-0.5">{line.label}</td>
            <td className="py-0.5 text-right font-mono tabular-nums">{line.minutes > 0 ? formatWorked(line.minutes) : "—"}</td>
            <td className="py-0.5 text-right font-mono tabular-nums text-muted-foreground">{line.rateLabel}</td>
            <td className={cn(
                "py-0.5 text-right font-mono tabular-nums",
                line.accounted < 0 && "text-amber-600 dark:text-amber-400",
                line.accounted > 0 && line.key !== "duty" && "text-emerald-600 dark:text-emerald-400",
            )}>
                {line.key === "duty" ? (line.accounted > 0 ? formatWorked(line.accounted) : "—") : signed(line.accounted)}
            </td>
            <td className="hidden py-0.5 pl-3 text-[11px] text-muted-foreground sm:table-cell">{line.note ?? ""}</td>
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
