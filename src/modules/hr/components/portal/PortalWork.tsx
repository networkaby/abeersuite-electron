"use client";

// Work — the month day by day, the activity behind it, and what the pay rules
// make of it in rupees. Every figure is read through the register's own
// `readDay` / `summarise` and payroll's own `payRuleLines`, so this page and
// the office can never tell two stories about a day.

import { Activity, CalendarDays, Clock, TriangleAlert } from "lucide-react";
import { QueryStateBlock } from "@/shared/components/QueryStateBlock";
import { Fact, Section, StatCard } from "@/shared/components/StatCard";
import { useApiResource } from "@/shared/hooks";
import { formatDate } from "@/shared/lib/format/formatDate";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { formatWorked } from "@/shared/lib/hr/dutyTime";
import { ATTENDANCE_STATUS_META } from "@/shared/lib/schemas/hrAttendanceSchema";
import { isoDaysBetween, readDay, summarise, weekdayOf } from "../../lib/attendanceCalendar";
import { CELL, DOW } from "../../lib/attendanceStyles";
import type { MyHrPayload } from "../../lib/myHrTypes";
import AttendanceBreakup from "../AttendanceBreakup";
import { monthLabel } from "../MyTargetCard";
import MonthNav from "./MonthNav";
import SubTabs from "./SubTabs";
import { VIEWS, type PortalNav } from "./portalNav";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function PortalWork({ userId, me, month, onMonth, nav }: {
    userId: number; me: ReturnType<typeof useApiResource<MyHrPayload>>;
    month: string; onMonth: (m: string) => void; nav: PortalNav;
}) {
    const data = me.data;
    const view = nav.view ?? "attendance";

    return (
        <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
                <SubTabs tabs={VIEWS.work} active={view} onChange={(v) => nav.go("work", v)} />
                <div className="mb-4"><MonthNav month={month} onMonth={onMonth} /></div>
            </div>

            <QueryStateBlock loading={me.loading} error={me.error} hasData={!!data} onRetry={me.reload} />

            {data && view === "attendance" && <AttendanceView data={data} />}

            {data && view === "activity" && (
                <Section title="My activity" icon={<Activity size={15} />}>
                    <p className="mb-2 text-xs text-muted-foreground">
                        Every stretch you were active in {monthLabel(month)}, how each day was accounted, and what
                        the month nets to — the working behind the salary slip.
                    </p>
                    <AttendanceBreakup userId={userId} from={data.from} to={data.to} />
                </Section>
            )}

            {data && view === "penalties" && <PenaltiesView data={data} />}
        </div>
    );
}

function AttendanceView({ data }: { data: MyHrPayload }) {
    const days = isoDaysBetween(data.from, data.to);
    const holidayDates = new Set(data.holidays.map((h) => h.date));
    const totals = summarise(data.person, days, holidayDates);
    return (
        <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <StatCard label="Present" value={`${totals.present + totals.half * 0.5} days`} hint={`${totals.present} full · ${totals.half} half`} />
                <StatCard label="Absent" value={String(totals.absent)} hint="No leave granted" tone={totals.absent > 0 ? "warn" : undefined} />
                <StatCard label="Incomplete duty" value={String(totals.incomplete)} hint="Came, under 40% — unpaid, no penalty" tone={totals.incomplete > 0 ? "warn" : undefined} />
                <StatCard label="On leave" value={String(totals.leave)} />
                <StatCard label="Days lost" value={data.lostDays === 0 ? "None" : String(data.lostDays)} hint={data.lostDays === 0 ? "Nothing cut" : "Absent and half days"} />
            </div>

            <Section title="Day by day" icon={<CalendarDays size={15} />}>
                <div className="flex flex-wrap gap-1.5">
                    {days.map((iso) => {
                        const r = readDay(data.person, iso, holidayDates);
                        if (r.kind === "outside") {
                            return <div key={iso} className="h-12 w-12 rounded-md border border-dashed border-border/60" aria-hidden />;
                        }
                        const cls = r.kind === "unmarked" ? "border border-border text-muted-foreground" : CELL[r.status];
                        const title = r.kind === "unmarked"
                            ? `${formatDate(iso)} — not marked`
                            : [
                                `${formatDate(iso)} — ${ATTENDANCE_STATUS_META[r.status].label}`,
                                r.workedMinutes ? `${formatWorked(r.workedMinutes)} worked` : null,
                                r.lateBy ? `${r.lateBy} min late` : null,
                            ].filter(Boolean).join(", ");
                        return (
                            <div key={iso} title={title} className={`flex h-12 w-12 flex-col items-center justify-center rounded-md text-xs ${cls}`}>
                                <span className="text-[10px] opacity-70">{DOW[weekdayOf(iso)]}</span>
                                <span className="font-medium tabular-nums">{Number(iso.slice(8, 10))}</span>
                                <span className="text-[10px]">{r.kind === "unmarked" ? "·" : ATTENDANCE_STATUS_META[r.status].short}</span>
                            </div>
                        );
                    })}
                </div>
            </Section>

            <Section title="My working rules" icon={<Clock size={15} />}>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Fact label="Duty hours" value={`${data.person.dutyStart} – ${data.person.dutyEnd}`} />
                    <Fact label="A full day" value={formatWorked(data.person.dutyMinutes)} />
                    <Fact label="Weekly off" value={data.person.weeklyOff.length ? data.person.weeklyOff.map((d) => WEEKDAY_NAMES[d]).join(", ") : "None"} />
                    <Fact label="Joined on" value={data.person.joinedOn ? formatDate(data.person.joinedOn) : "—"} />
                </div>
            </Section>
        </div>
    );
}

/** The rule lines for the month so far, with the counts behind them. */
function PenaltiesView({ data }: { data: MyHrPayload }) {
    const { lines, counts, rules, reason } = data.effect;
    const earnings = lines?.filter((l) => l.kind === "EARNING") ?? [];
    const cuts = lines?.filter((l) => l.kind === "DEDUCTION") ?? [];
    const sum = (xs: { amountPaise: number }[]) => xs.reduce((s, l) => s + l.amountPaise, 0);

    return (
        <div className="space-y-6">
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
                An estimate, worked the way payroll will work it, from the month so far. The salary slip is the final word.
            </p>

            {reason && !lines && (
                <p className="text-sm text-muted-foreground">{reason}</p>
            )}

            {lines && (
                <div className="grid gap-6 md:grid-cols-2">
                    <Section title="Extras earned" icon={<Clock size={15} />}>
                        <Lines rows={earnings} empty="No extra earned so far." total={sum(earnings)} tone="good" />
                    </Section>
                    <Section title="Penalties" icon={<TriangleAlert size={15} />}>
                        <Lines rows={cuts} empty="No penalty so far." total={sum(cuts)} tone="warn" />
                    </Section>
                </div>
            )}

            {counts && rules && (
                <Section title="How it was counted" icon={<Activity size={15} />}>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <Fact label="Overtime (after pending duty made up)" value={counts.payableMinutes > 0 ? `${formatWorked(counts.payableMinutes)} at ${rules.overtimeRate}×` : "—"} />
                        <Fact label="Pending duty" value={counts.owedMinutes > 0 ? `${formatWorked(counts.owedMinutes)} at ${rules.shortHoursRate}×` : "—"} />
                        <Fact label="Late days" value={counts.lateDays === 0 ? "—" : `${counts.lateDays} · ${counts.chargedLateDays} charged (first ${rules.lateFreeDays} free)`} />
                        <Fact label="Absent with no leave" value={counts.unaskedAbsentDays === 0 ? "—" : `${counts.unaskedAbsentDays} day${counts.unaskedAbsentDays === 1 ? "" : "s"} · ${rules.absentPenaltyDays} day${rules.absentPenaltyDays === 1 ? "" : "s"} of duty to pending each`} />
                        <Fact label="Weekly-off duty" value={counts.weeklyOffMinutes > 0 ? `${formatWorked(counts.weeklyOffMinutes)} at ${rules.weeklyOffRate}×` : "—"} />
                        <Fact label="Holiday duty" value={counts.holidayMinutes > 0 ? `${formatWorked(counts.holidayMinutes)} at ${rules.holidayRate}×` : "—"} />
                        <Fact label="Late grace" value={`${rules.lateGraceMinutes} min`} />
                        <Fact label="Late charge" value={rules.latePenaltyStyle === "pay" ? `${rules.latePenaltyDays} day${rules.latePenaltyDays === 1 ? "" : "s"} of duty to pending per charged day` : "Penalty minutes go to pending duty"} />
                    </div>
                </Section>
            )}
        </div>
    );
}

function Lines({ rows, empty, total, tone }: { rows: { name: string; amountPaise: number }[]; empty: string; total: number; tone: "good" | "warn" }) {
    if (rows.length === 0) return <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">{empty}</p>;
    const toneCls = tone === "good" ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400";
    return (
        <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {rows.map((l) => (
                <li key={l.name} className="flex items-center justify-between px-3 py-2">
                    <span>{l.name}</span>
                    <span className="tabular-nums">{formatRupeesFromPaise(l.amountPaise)}</span>
                </li>
            ))}
            <li className={`flex items-center justify-between px-3 py-2 font-semibold ${toneCls}`}>
                <span>Total</span>
                <span className="tabular-nums">{formatRupeesFromPaise(total)}</span>
            </li>
        </ul>
    );
}
