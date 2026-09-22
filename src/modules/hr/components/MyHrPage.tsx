"use client";

// "My Info" — one staff member's own working life, on one page and one tick.
//
// Owner, 2026-09-22: the HR module gets a page where a person sees his own data
// and applies for leave, on ONE page permission and not the whole module. So this
// page shows one person — whoever is signed in — and nobody else, ever. It reads
// `/api/hr/me`, which never accepts a userId, and the payslip route, which already
// lets a person read their own and refuses anyone who is neither them nor HR.
//
// Every figure is read through the register's own `readDay` / `summarise`, so what
// a cashier sees about his day is the same reading the office sees about it.

import { useMemo, useState } from "react";
import {
    CalendarDays, ChevronLeft, ChevronRight, Clock, IdCard, Palmtree, Plus, ReceiptIndianRupee, Timer,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataPageHeader } from "@/shared/components/DataPageHeader";
import { QueryStateBlock } from "@/shared/components/QueryStateBlock";
import { TableEmptyRow } from "@/shared/components/DataTableStates";
import { useApiResource, useRealtimeTopics } from "@/shared/hooks";
import { formatDate, todayIso } from "@/shared/lib/format/formatDate";
import { formatWorked } from "@/shared/lib/hr/dutyTime";
import { ATTENDANCE_STATUS_META, LEAVE_KIND_LABELS, type LeaveStatus } from "@/shared/lib/schemas/hrAttendanceSchema";
import { isoDaysBetween, readDay, summarise, weekdayOf } from "../lib/attendanceCalendar";
import { CELL, DOW } from "../lib/attendanceStyles";
import type { MyHrPayload } from "../lib/myHrTypes";
import { LeaveDialog } from "./LeaveBoard";
import StaffPayslips from "./StaffPayslips";

const STATUS_BADGE: Record<LeaveStatus, string> = {
    PENDING:   "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300",
    APPROVED:  "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300",
    REJECTED:  "border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300",
    CANCELLED: "text-muted-foreground",
};

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const monthLabel = (month: string) =>
    new Date(`${month}-01T00:00:00.000Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

/** Step a YYYY-MM string by whole months, in UTC so a timezone cannot slip a day. */
function shiftMonth(month: string, by: number): string {
    const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default function MyHrPage({ userId }: { userId: number }) {
    const [month, setMonth] = useState(() => todayIso().slice(0, 7));
    const { data, loading, refreshing, error, reload } = useApiResource<MyHrPayload>(`/api/hr/me?month=${month}`);
    useRealtimeTopics(["settings"], reload);
    const [filing, setFiling] = useState(false);

    const view = useMemo(() => {
        if (!data) return null;
        const days = isoDaysBetween(data.from, data.to);
        const holidayDates = new Set(data.holidays.map((h) => h.date));
        return {
            days,
            holidayDates,
            totals: summarise(data.person, days, holidayDates),
            // A past month has no "today" in it; the card that used it is hidden.
            today: data.isCurrentMonth ? readDay(data.person, data.today, holidayDates) : null,
        };
    }, [data]);

    // A month that has not happened has nothing to say, so the forward arrow
    // stops at the current one rather than drawing an empty grid.
    const atLatest = month >= todayIso().slice(0, 7);

    return (
        <ScrollArea className="h-full" type="always">
            <div className="px-6 pt-3 pb-6">
                <DataPageHeader
                    title="My Info"
                    subtitle={data
                        ? `${data.person.name}${data.staffCode ? ` · ${data.staffCode}` : ""}${refreshing ? " · refreshing…" : ""}`
                        : "Reading your record…"}
                    icon={<IdCard size={20} />}
                    actions={<Button type="button" onClick={() => setFiling(true)}><Plus size={16} /> Request leave</Button>}
                />

                <QueryStateBlock loading={loading} error={error} hasData={!!data} onRetry={reload} />

                {data && view && (
                    <div className="space-y-6">
                        {/* Today, and the month so far. */}
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            {data.isCurrentMonth && (
                                <StatCard
                                    icon={<Clock size={15} />}
                                    label="Today"
                                    value={view.today?.kind === "marked" ? ATTENDANCE_STATUS_META[view.today.status].label : "Not marked yet"}
                                    hint={view.today?.kind === "marked" && view.today.workedMinutes
                                        ? `${formatWorked(view.today.workedMinutes)} worked`
                                        : `Duty ${data.person.dutyStart} – ${data.person.dutyEnd}`}
                                />
                            )}
                            <StatCard
                                icon={<CalendarDays size={15} />}
                                label={data.isCurrentMonth ? "This month" : "That month"}
                                value={`${view.totals.present + view.totals.half * 0.5} days`}
                                hint={`${view.totals.present} full · ${view.totals.half} half · ${view.totals.absent} absent · ${view.totals.leave} leave`}
                            />
                            <StatCard
                                icon={<Timer size={15} />}
                                label="Extra time"
                                value={formatWorked(data.overtime.payableMinutes)}
                                hint={data.overtime.shortfallMinutes > 0
                                    ? `${formatWorked(data.overtime.madeUpMinutes)} went to make up a shortfall`
                                    : "Worked beyond your duty hours"}
                            />
                            <StatCard
                                icon={<ReceiptIndianRupee size={15} />}
                                label="Days lost"
                                value={data.lostDays === 0 ? "None" : String(data.lostDays)}
                                hint={data.lostDays === 0
                                    ? "Nothing cut"
                                    : `Absent and half days${data.isCurrentMonth ? ", so far" : ""}`}
                            />
                        </div>

                        {/* My month, day by day. */}
                        <Section
                            title="My attendance"
                            icon={<CalendarDays size={15} />}
                            right={
                                <div className="flex items-center gap-1">
                                    <Button type="button" size="icon-sm" variant="outline" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
                                        <ChevronLeft size={14} />
                                    </Button>
                                    <span className="min-w-36 text-center text-sm font-medium">{monthLabel(data.month)}</span>
                                    <Button type="button" size="icon-sm" variant="outline" aria-label="Next month" disabled={atLatest} onClick={() => setMonth(shiftMonth(month, 1))}>
                                        <ChevronRight size={14} />
                                    </Button>
                                </div>
                            }
                        >
                            <div className="flex flex-wrap gap-1.5">
                                {view.days.map((iso) => {
                                    const r = readDay(data.person, iso, view.holidayDates);
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

                        {/* My leave — own requests only; the board is HR's. */}
                        <Section title="My leave" icon={<Palmtree size={15} />}>
                            <div className="overflow-x-auto rounded-lg border border-border">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>From</TableHead>
                                            <TableHead>To</TableHead>
                                            <TableHead className="text-right">Days</TableHead>
                                            <TableHead>Kind</TableHead>
                                            <TableHead>Reason</TableHead>
                                            <TableHead>Status</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {data.leaves.length === 0 ? (
                                            <TableEmptyRow colSpan={6} message="You have not applied for any leave yet." />
                                        ) : data.leaves.map((r) => (
                                            <TableRow key={r.id}>
                                                <TableCell className="whitespace-nowrap">{formatDate(r.fromDate)}</TableCell>
                                                <TableCell className="whitespace-nowrap">{formatDate(r.toDate)}</TableCell>
                                                <TableCell className="text-right tabular-nums">{r.days}</TableCell>
                                                <TableCell>{LEAVE_KIND_LABELS[r.kind]}</TableCell>
                                                <TableCell className="max-w-64 truncate text-muted-foreground" title={r.reason ?? undefined}>{r.reason ?? ""}</TableCell>
                                                <TableCell>
                                                    <Badge variant="outline" className={STATUS_BADGE[r.status]}>
                                                        {r.status.charAt(0) + r.status.slice(1).toLowerCase()}
                                                    </Badge>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </Section>

                        {/* My payslips — the same surface the staff profile shows. */}
                        <Section title="My payslips" icon={<ReceiptIndianRupee size={15} />}>
                            <StaffPayslips userId={userId} />
                        </Section>

                        {/* The rules that apply to me. */}
                        <Section title="My working rules" icon={<Clock size={15} />}>
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                <Fact label="Duty hours" value={`${data.person.dutyStart} – ${data.person.dutyEnd}`} />
                                <Fact label="A full day" value={formatWorked(data.person.dutyMinutes)} />
                                <Fact
                                    label="Weekly off"
                                    value={data.person.weeklyOff.length
                                        ? data.person.weeklyOff.map((d) => WEEKDAY_NAMES[d]).join(", ")
                                        : "None"}
                                />
                                <Fact label="Joined on" value={data.person.joinedOn ? formatDate(data.person.joinedOn) : "—"} />
                            </div>
                            {data.holidays.length > 0 && (
                                <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                                    <span className="text-muted-foreground">Shop holidays this month:</span>
                                    <span>{data.holidays.map((h) => `${formatDate(h.date)} — ${h.name}`).join(" · ")}</span>
                                </div>
                            )}
                        </Section>
                    </div>
                )}

                {filing && (
                    <LeaveDialog
                        canPickPerson={false}
                        onClose={() => setFiling(false)}
                        onSaved={() => { setFiling(false); reload(); }}
                    />
                )}
            </div>
        </ScrollArea>
    );
}

function StatCard({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint: string }) {
    return (
        <div className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}<span>{label}</span></div>
            <div className="mt-1 text-lg font-semibold">{value}</div>
            <div className="text-xs text-muted-foreground">{hint}</div>
        </div>
    );
}

function Section({ title, icon, right, children }: { title: string; icon?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
    return (
        <section>
            <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">{icon}{title}</h2>
                {right}
            </div>
            {children}
        </section>
    );
}

function Fact({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-lg border border-border p-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="mt-0.5 text-sm font-medium">{value}</div>
        </div>
    );
}
