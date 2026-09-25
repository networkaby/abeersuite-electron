"use client";

// Overview — the month at a glance, and a door into every other group.

import Link from "next/link";
import { CalendarDays, Clock, HandCoins, IdCard, Palmtree, Printer, ReceiptIndianRupee, Target, Timer, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QueryStateBlock } from "@/shared/components/QueryStateBlock";
import { Fact, Section, StatCard } from "@/shared/components/StatCard";
import { useApiResource } from "@/shared/hooks";
import { formatDate } from "@/shared/lib/format/formatDate";
import { formatInr, formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { formatWorked } from "@/shared/lib/hr/dutyTime";
import { staffLedgerStanding } from "@/shared/lib/hr/staffLedgerStanding";
import { ATTENDANCE_STATUS_META, LEAVE_KIND_LABELS } from "@/shared/lib/schemas/hrAttendanceSchema";
import { isoDaysBetween, readDay, summarise } from "../../lib/attendanceCalendar";
import type { MyHrPayload } from "../../lib/myHrTypes";
import type { PayslipDto } from "../../lib/payrollTypes";
import type { StaffDetail } from "../../lib/staffTypes";
import MyTargetCard from "../MyTargetCard";
import { LEAVE_STATUS_BADGE } from "./PortalLeave";
import type { PortalNav } from "./portalNav";

type MeRes = ReturnType<typeof useApiResource<MyHrPayload>>;

/** Penalties minus extras, in paise — what the rules take off (or add to) this month so far. */
export function effectNetPaise(effect: MyHrPayload["effect"]): { earned: number; cut: number } | null {
    if (!effect.lines) return null;
    let earned = 0, cut = 0;
    for (const l of effect.lines) { if (l.kind === "EARNING") earned += l.amountPaise; else cut += l.amountPaise; }
    return { earned, cut };
}

export default function PortalOverview({ userId, me, staff, nav, onRequestLeave }: {
    userId: number; me: MeRes; staff: StaffDetail | null; nav: PortalNav; onRequestLeave: () => void;
}) {
    const data = me.data;
    // The latest slip only — the list lives on Pay → Payslips.
    const slips = useApiResource<PayslipDto[]>(`/api/hr/staff/${userId}/payslips`);
    const lastSlip = slips.data?.[0] ?? null;

    const view = data ? (() => {
        const days = isoDaysBetween(data.from, data.to);
        const holidayDates = new Set(data.holidays.map((h) => h.date));
        return {
            totals: summarise(data.person, days, holidayDates),
            today: data.isCurrentMonth ? readDay(data.person, data.today, holidayDates) : null,
        };
    })() : null;
    const net = data ? effectNetPaise(data.effect) : null;
    const leaveLeft = data ? data.leaveBalance.balances.reduce((s, b) => (b.left === null ? s : s + b.left), 0) : 0;
    const pendingLeaves = data?.leaves.filter((l) => l.status === "PENDING") ?? [];
    const ledger = staff?.ledger ?? null;
    const standing = ledger ? staffLedgerStanding(ledger.balance, (n) => formatInr(n)) : null;

    return (
        <div className="space-y-6">
            <QueryStateBlock loading={me.loading} error={me.error} hasData={!!data} onRetry={me.reload} />

            {data && view && (
                <>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                        <StatCard icon={<Clock size={15} />} label="Today"
                            value={view.today?.kind === "marked" ? ATTENDANCE_STATUS_META[view.today.status].label : "Not marked yet"}
                            hint={view.today?.kind === "marked" && view.today.workedMinutes
                                ? `${formatWorked(view.today.workedMinutes)} worked`
                                : `Duty ${data.person.dutyStart} – ${data.person.dutyEnd}`} />
                        <StatCard icon={<CalendarDays size={15} />} label="This month"
                            value={`${view.totals.present + view.totals.half * 0.5} days`}
                            hint={`${view.totals.present} full · ${view.totals.half} half · ${view.totals.absent} absent · ${view.totals.leave} leave`} />
                        <StatCard icon={<Timer size={15} />} label="Extra time" value={formatWorked(data.overtime.payableMinutes)}
                            hint={data.overtime.shortfallMinutes > 0 ? `${formatWorked(data.overtime.madeUpMinutes)} made up a shortfall` : "Beyond your duty hours"}
                            tone={data.overtime.payableMinutes > 0 ? "good" : undefined} />
                        <StatCard icon={<TriangleAlert size={15} />} label="Penalties so far"
                            value={net ? (net.cut === 0 ? "None" : formatRupeesFromPaise(net.cut)) : "—"}
                            hint={net ? (net.earned > 0 ? `${formatRupeesFromPaise(net.earned)} extras earned` : "Estimate until payroll runs") : (data.effect.reason ?? "")}
                            tone={net && net.cut > 0 ? "warn" : undefined} />
                        <StatCard icon={<Palmtree size={15} />} label="Leave left" value={`${leaveLeft} days`}
                            hint={pendingLeaves.length ? `${pendingLeaves.length} application${pendingLeaves.length === 1 ? "" : "s"} awaiting a decision` : `Leave year ${data.leaveBalance.year.label}`} />
                        <StatCard icon={<HandCoins size={15} />} label="Money"
                            value={standing ? (standing.standing === "settled" ? "Settled" : formatInr(standing.amount)) : "—"}
                            hint={standing ? (standing.standing === "payable" ? "Owed to you" : standing.standing === "advance" ? "Advance you hold" : "Nothing outstanding") : "No ledger yet"}
                            tone={standing?.standing === "payable" ? "good" : standing?.standing === "advance" ? "warn" : undefined} />
                    </div>

                    <div className="grid gap-6 lg:grid-cols-2">
                        <Section title="My leave applications" icon={<Palmtree size={15} />}
                            right={<Button type="button" size="sm" variant="outline" onClick={onRequestLeave}>Request leave</Button>}>
                            {pendingLeaves.length === 0 ? (
                                <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                                    Nothing awaiting a decision. <button type="button" className="underline" onClick={() => nav.go("leave")}>See all your leave</button>.
                                </p>
                            ) : (
                                <ul className="divide-y divide-border rounded-lg border border-border">
                                    {pendingLeaves.slice(0, 5).map((r) => (
                                        <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                                            <span>{formatDate(r.fromDate)} – {formatDate(r.toDate)} · {r.days} day{r.days === 1 ? "" : "s"} · {LEAVE_KIND_LABELS[r.kind]}</span>
                                            <Badge variant="outline" className={LEAVE_STATUS_BADGE[r.status]}>Pending</Badge>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </Section>

                        <Section title="Last payslip" icon={<ReceiptIndianRupee size={15} />}
                            right={<button type="button" className="text-xs text-muted-foreground underline" onClick={() => nav.go("pay", "payslips")}>All payslips</button>}>
                            {lastSlip ? (
                                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-3">
                                    <div>
                                        <div className="text-lg font-semibold tabular-nums">{formatRupeesFromPaise(lastSlip.netPaise)}</div>
                                        <div className="text-xs text-muted-foreground">
                                            {formatDate(lastSlip.periodFrom)} – {formatDate(lastSlip.periodTo)} · {lastSlip.paidDays} of {lastSlip.periodDays} days paid
                                        </div>
                                    </div>
                                    <Button asChild size="sm" variant="outline">
                                        <Link href={`/receipt/payslip/${lastSlip.id}`} target="_blank"><Printer size={14} /> Print</Link>
                                    </Button>
                                </div>
                            ) : (
                                <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                                    {slips.loading ? "Reading…" : "No payslip has been posted for you yet."}
                                </p>
                            )}
                        </Section>
                    </div>

                    <Section title={data.isCurrentMonth ? "My target this month" : "My target"} icon={<Target size={15} />}
                        right={<button type="button" className="text-xs text-muted-foreground underline" onClick={() => nav.go("pay", "target")}>Details</button>}>
                        <MyTargetCard month={data.commission} isCurrentMonth={data.isCurrentMonth} />
                    </Section>

                    <Section title="Quick links" icon={<IdCard size={15} />}>
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            <button type="button" onClick={() => nav.go("me", "id card")} className="text-left"><Fact label="ID card" value="View & print" /></button>
                            <button type="button" onClick={() => nav.go("work", "attendance")} className="text-left"><Fact label="Attendance" value="Day by day" /></button>
                            <button type="button" onClick={() => nav.go("pay", "salary")} className="text-left"><Fact label="Salary structure" value="Heads & revisions" /></button>
                            <button type="button" onClick={() => nav.go("me", "personal")} className="text-left"><Fact label="Personal & bank" value="Keep them current" /></button>
                        </div>
                    </Section>
                </>
            )}
        </div>
    );
}
