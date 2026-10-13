"use client";

// One person's stretch of days, a card each — the main area of Employee Activity.
//
// Owner, 2026-09-22: "let select date range, or one day/date, every day one
// card, in the card day activity report, like auto granted hours, late penalty
// etc." So the range is the reader's choice and the day is the unit: one card
// per day (DayActivityCard), newest first, with the range's own summary above.
//
// The summary is NOT the cards added up. A day's extra hour is not money on its
// own — it first pays back the hours fallen short on other days, and only what
// survives is paid. That netting is payroll's, run on the server by the same
// function the payslip uses, and it belongs to the range, never to a day.

import { useMemo } from "react";
import { QueryStateBlock } from "@/shared/components/QueryStateBlock";
import { useApiResource } from "@/shared/hooks";
import { formatWorked } from "@/shared/lib/hr/dutyTime";
import { todayIso } from "@/shared/lib/format/formatDate";
import { toast } from "sonner";
import { cn } from "@/shared/lib/format/utils";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { totalBreakup } from "../lib/attendanceBreakup";
import type { HoursPayload } from "../lib/attendanceHoursTypes";
import { saveCorrection } from "../lib/attendanceDayClient";
import DayActivityCard, { type CorrectableField } from "./DayActivityCard";

export default function AttendanceBreakup({ userId, from, to, canEdit }: {
    userId: number;
    /** May correct the till's figures on a finished day's card. Off on the staff portal. */
    canEdit?: boolean;
    /** The range to show, owned by the explorer so the list beside it agrees. */
    from: string;
    to: string;
}) {
    const { data, loading, error, reload } = useApiResource<HoursPayload>(
        `/api/hr/attendance/hours?userId=${userId}&from=${from}&to=${to}`,
    );

    const today = todayIso();
    const days = useMemo(() => data?.days ?? [], [data]);
    const rules = data?.rules;
    const totals = useMemo(() => totalBreakup(days, rules), [days, rules]);
    // Newest first: the day being asked about is nearly always a recent one, and
    // a month of cards is a long way to scroll to reach it.
    const ordered = useMemo(() => [...days].reverse(), [days]);
    const effect = data?.effect;

    const correct = (date: string) => async (field: CorrectableField, minutes: number | null) => {
        try {
            await saveCorrection(userId, date, field, minutes);
            await reload();
        } catch (e) {
            toast.error(extractApiError(e, "Could not save the correction"));
            throw e;
        }
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <QueryStateBlock loading={loading} error={error} hasData={!!data} onRetry={reload} />

            {data && days.length === 0 && (
                <div className="py-10 text-center text-sm text-muted-foreground">Nothing on the register in these days.</div>
            )}

            {data && rules && days.length > 0 && (
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pb-6">
                    {/* The range, netted — what payroll would actually pay */}
                    {effect && (
                        <section className="rounded-lg border border-border bg-card px-4 py-3">
                            <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4 lg:grid-cols-7">
                                <Tally label="Days measured" value={String(totals.days)} hint="Days the clock actually recorded stretches for" />
                                <Tally label="Times active" value={String(totals.activeCount)} hint="Separate stretches across all these days" />
                                <Tally label="Worked" value={formatWorked(totals.worked)} strong hint={`Of ${formatWorked(totals.duty)} duty`} />
                                <Tally
                                    label="Accounted"
                                    value={formatWorked(totals.accounted)}
                                    hint="Every day's own total added up — normal at 1×, made-up pending at 1×, overtime at its rate. Short duty and penalties go to pending instead"
                                />
                                <Tally
                                    label="Overtime payable"
                                    value={effect.payableMinutes > 0 ? formatWorked(effect.payableMinutes) : "—"}
                                    tone={effect.payableMinutes > 0 ? "good" : undefined}
                                    hint="Each day's extra left after the pending duty was made up"
                                />
                                <Tally
                                    label="Pending duty"
                                    value={effect.owedMinutes > 0 ? formatWorked(effect.owedMinutes) : "—"}
                                    tone={effect.owedMinutes > 0 ? "warn" : undefined}
                                    hint="Short duty and penalties not yet made up — what is left at month end is cut"
                                />
                                <Tally
                                    label="Late days"
                                    value={effect.lateDays === 0 ? "—" : `${effect.lateDays}${effect.chargedLateDays ? ` · ${effect.chargedLateDays} charged` : " · all free"}`}
                                    tone={effect.chargedLateDays > 0 ? "warn" : undefined}
                                    hint={`The first ${rules.lateFreeDays} late days of the period cost nothing`}
                                />
                            </div>

                            {/* Granted on their own — hours the rules hand over without
                                anybody asking, and an absence nobody granted. */}
                            {(effect.weeklyOffMinutes > 0 || effect.holidayMinutes > 0 || effect.unaskedAbsentDays > 0) && (
                                <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
                                    {effect.weeklyOffMinutes > 0 && (
                                        <span className="text-emerald-700 dark:text-emerald-400">
                                            Weekly-off duty {formatWorked(effect.weeklyOffMinutes)} at {rules.weeklyOffRate}×
                                        </span>
                                    )}
                                    {effect.weeklyOffMinutes > 0 && (effect.holidayMinutes > 0 || effect.unaskedAbsentDays > 0) && " · "}
                                    {effect.holidayMinutes > 0 && (
                                        <span className="text-emerald-700 dark:text-emerald-400">
                                            Holiday duty {formatWorked(effect.holidayMinutes)} at {rules.holidayRate}×
                                        </span>
                                    )}
                                    {effect.holidayMinutes > 0 && effect.unaskedAbsentDays > 0 && " · "}
                                    {effect.unaskedAbsentDays > 0 && (
                                        <span className="text-amber-700 dark:text-amber-400">
                                            {effect.unaskedAbsentDays} day{effect.unaskedAbsentDays === 1 ? "" : "s"} absent with no leave granted
                                        </span>
                                    )}
                                </p>
                            )}
                        </section>
                    )}

                    {ordered.map((d) => (
                        <DayActivityCard
                            key={d.date} day={d} rules={rules} idleLimitMinutes={data.idleLimitMinutes} isToday={d.date === today}
                            onCorrect={canEdit && d.tracked && d.date < today ? correct(d.date) : undefined}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function Tally({ label, value, hint, strong, tone }: {
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
