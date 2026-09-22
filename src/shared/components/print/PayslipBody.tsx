/**
 * Salary-slip body — the person, the period, the pay heads and the net, sitting
 * between the shared letterhead header and footer chrome of a PAYSLIP print.
 *
 * Pure presentational (no data loading), so it renders identically in:
 *   • /receipt/payslip/[lineId] — the real slip, off a POSTED PayrollRunLine
 *   • the Print Templates settings preview (fed SAMPLE_PAYSLIP)
 *
 * Every figure is the run's own frozen line: nothing here is recomputed, so the
 * slip says the same thing in ten years as it did on the day it was posted.
 * The shop's signature line comes from the chrome (template.showSignature), so
 * there is none here.
 */

import React from "react";
import { formatDate } from "@/shared/lib/format/formatDate";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { rupeesInWords } from "@/shared/lib/format/numberToWords";
import { formatWorked } from "@/shared/lib/hr/dutyTime";

export interface PayslipLine {
    name: string;
    kind: "EARNING" | "DEDUCTION";
    amountPaise: number;
}

/**
 * One day of the month as the slip freezes it — the figures the activity card
 * shows, after the rate: `worked` is the clock's minutes, the `…Accounted`
 * fields are signed minutes after the rule, and `total` is their sum. A shut
 * day (weekly off / holiday) carries only `grantedAccounted`.
 */
export interface PayslipAttendanceDay {
    /** ISO yyyy-mm-dd. */
    date: string;
    /** PRESENT · HALF_DAY · ABSENT · LEAVE, as the day read on the register. */
    status: string;
    shut: "OFF" | "HOLIDAY" | null;
    worked: number;
    duty: number;
    overtime: number;
    overtimeAccounted: number;
    late: number;
    lateAccounted: number;
    short: number;
    shortAccounted: number;
    grantedAccounted: number;
    total: number;
}

/**
 * The month's attendance, accounted day by day, frozen on the payroll line at
 * generation — `PayrollRunLine.attendanceJson`. The slip's own Overtime and
 * Hours owed heads are arrived at from these, so the section is the working
 * behind them, not a second opinion.
 */
export interface PayslipAttendanceData {
    days: PayslipAttendanceDay[];
    workedMinutes: number;
    dutyMinutes: number;
    /** Every day's total added up — before the month is netted. */
    accountedMinutes: number;
    /** The netting's answer — what the Overtime / Hours owed heads were paid on. */
    payableMinutes: number;
    owedMinutes: number;
    weeklyOffMinutes: number;
    holidayMinutes: number;
    lateDays: number;
    chargedLateDays: number;
    /** The rules in force that month, so the slip can say them in its own words. */
    rates: {
        overtime: number;
        shortHours: number;
        weeklyOff: number;
        holiday: number;
        /** The late rule as a label: "× 2", "10% of day / 5 min", "money", "—". */
        late: string;
        lateFreeDays: number;
    };
}

export interface PayslipBodyData {
    /** The slip's own number — the payroll line id, stable for ever. */
    slipNo: string;
    staffName: string;
    staffCode: string | null;
    /** The seat's title, when the person holds one. */
    designation: string | null;
    joinedOn: string | null;
    /** ISO yyyy-mm-dd, inclusive. */
    periodFrom: string;
    periodTo: string;
    /** The day the salary was booked. */
    postingDate: string;
    /** The journal it was booked by, if it still has a number. */
    voucherRef: string | null;
    paidDays: number;
    periodDays: number;
    payDays: number;
    lines: PayslipLine[];
    grossPaise: number;
    deductionsPaise: number;
    netPaise: number;
    /** Null on a line posted before the attendance was frozen with the pay. */
    attendance?: PayslipAttendanceData | null;
}

/** "+1h 8m", "−46m", "—" for nought — signed, because the sign is the point. */
const signed = (m: number) => (m === 0 ? "—" : m < 0 ? `−${formatWorked(-m)}` : formatWorked(m));
const orDash = (m: number) => (m > 0 ? formatWorked(m) : "—");


/**
 * The month as a handful of summary lines — one per kind of thing that
 * happened, not one per day.
 *
 * Owner, 2026-09-22: *"write summary style — x days late, penalty ×1 — because
 * '20 days present in full' may not apply to everyone, and 26 looks bad."* So
 * every line is a COUNT of days and the MINUTES they carry, with the rate and
 * what those minutes came to after it. A kind with nothing in it is left out,
 * and a clean month is three lines. The day-by-day working is on the person's
 * own My Info page, not on the slip.
 */
interface SummaryLine {
    key: string;
    label: string;
    /** "3 days", "1 day", or "" when a count means nothing (the month row). */
    days: string;
    /** The minutes and the rate, as printed: "23m × 2", "3h 10m × 2", "half already withheld". */
    working: string;
    /** Signed minutes after the rate; null prints a dash. */
    accounted: number | null;
}

const dayCount = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

function summariseDays(att: PayslipAttendanceData): SummaryLine[] {
    // Every day's minutes inside the duty, at ×1 — the base the other lines
    // adjust. It has to cover the exception days too, or the column would not
    // add up to the month.
    let present = 0, dutyMinutes = 0;
    let otDays = 0, otMinutes = 0, otAcc = 0;
    let lateCharged = 0, lateChargedMinutes = 0, lateAcc = 0;
    let shortDays = 0, shortMinutes = 0, shortAcc = 0;
    let half = 0, halfAcc = 0;
    let absent = 0;
    let offDays = 0, offMinutes = 0, offAcc = 0;
    let holDays = 0, holMinutes = 0, holAcc = 0;

    for (const d of att.days) {
        if (d.shut === "OFF")     { offDays++; offMinutes += d.worked; offAcc += d.grantedAccounted; continue; }
        if (d.shut === "HOLIDAY") { holDays++; holMinutes += d.worked; holAcc += d.grantedAccounted; continue; }
        if (d.status === "ABSENT") { absent++; continue; }
        if (d.status === "HALF_DAY") { half++; halfAcc += d.shortAccounted; }
        else if (d.short > 0) { shortDays++; shortMinutes += d.short; shortAcc += d.shortAccounted; }
        if (d.overtime > 0) { otDays++; otMinutes += d.overtime; otAcc += d.overtimeAccounted; }
        if (d.lateAccounted < 0) { lateCharged++; lateChargedMinutes += d.late; lateAcc += d.lateAccounted; }
        if (d.worked > 0) { present++; dutyMinutes += Math.min(d.worked, d.duty); }
    }

    const out: SummaryLine[] = [];
    if (present > 0) out.push({ key: "duty", label: "Duty worked", days: dayCount(present), working: `${formatWorked(dutyMinutes)} × 1`, accounted: dutyMinutes });
    if (otDays > 0) out.push({ key: "ot", label: "Overtime", days: dayCount(otDays), working: `${formatWorked(otMinutes)} × ${att.rates.overtime}`, accounted: otAcc });
    if (att.lateDays > 0) {
        const free = att.lateDays - att.chargedLateDays;
        out.push({
            key: "late", label: "Late",
            days: `${dayCount(att.lateDays)}${free > 0 ? ` (first ${free} free)` : ""}`,
            working: lateCharged > 0 ? `${formatWorked(lateChargedMinutes)} charged ${att.rates.late}` : "none charged",
            accounted: lateCharged > 0 ? lateAcc : null,
        });
    }
    if (shortDays > 0) out.push({ key: "short", label: "Short of duty", days: dayCount(shortDays), working: `${formatWorked(shortMinutes)} × ${att.rates.shortHours}`, accounted: shortAcc });
    if (half > 0) out.push({ key: "half", label: "Half day", days: dayCount(half), working: "half the day already withheld on the pay", accounted: halfAcc || null });
    if (absent > 0) out.push({ key: "absent", label: "Absent", days: dayCount(absent), working: "paid at zero", accounted: null });
    if (offDays > 0) out.push({ key: "off", label: "Weekly off worked", days: dayCount(offDays), working: `${formatWorked(offMinutes)} × ${att.rates.weeklyOff}`, accounted: offAcc });
    if (holDays > 0) out.push({ key: "hol", label: "Holiday worked", days: dayCount(holDays), working: `${formatWorked(holMinutes)} × ${att.rates.holiday}`, accounted: holAcc });
    return out;
}

function Row({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
    return (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontWeight: strong ? 700 : 400 }}>
            <span>{label}</span>
            <span style={{ fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{value}</span>
        </div>
    );
}

export function PayslipBody({ data, thermal = false, showAttendance = true }: {
    data: PayslipBodyData;
    thermal?: boolean;
    /** The template's toggle for the attendance section — off hides it whatever the line carries. */
    showAttendance?: boolean;
}) {
    const att = data.attendance ?? null;
    const summary = att ? summariseDays(att) : [];
    const earnings = data.lines.filter((l) => l.kind === "EARNING");
    const deductions = data.lines.filter((l) => l.kind === "DEDUCTION");
    const period = `${formatDate(data.periodFrom)} – ${formatDate(data.periodTo)}`;
    const days = `${data.paidDays} of ${data.periodDays} (${data.payDays}-day month)`;
    const words = rupeesInWords(data.netPaise / 100);

    const meta: [string, React.ReactNode][] = [
        ["Name", data.staffName],
        ["Staff code", data.staffCode ?? "—"],
        ["Designation", data.designation ?? "—"],
        ["Joined", data.joinedOn ? formatDate(data.joinedOn) : "—"],
        ["Pay period", period],
        ["Days paid", days],
        ["Slip no.", data.slipNo],
        ["Posted", `${formatDate(data.postingDate)}${data.voucherRef ? ` · ${data.voucherRef}` : ""}`],
    ];

    if (thermal) {
        return (
            <div style={{ fontSize: 11, lineHeight: 1.35, color: "#111" }}>
                {meta.map(([k, v]) => <Row key={k} label={k} value={v} />)}
                <div style={{ borderTop: "1px dashed #777", margin: "6px 0" }} />
                <div style={{ fontWeight: 700 }}>Earnings</div>
                {earnings.map((l) => <Row key={l.name} label={l.name} value={formatRupeesFromPaise(l.amountPaise)} />)}
                <Row label="Gross" value={formatRupeesFromPaise(data.grossPaise)} strong />
                {deductions.length > 0 && (
                    <>
                        <div style={{ fontWeight: 700, marginTop: 4 }}>Deductions</div>
                        {deductions.map((l) => <Row key={l.name} label={l.name} value={formatRupeesFromPaise(l.amountPaise)} />)}
                        <Row label="Total deductions" value={formatRupeesFromPaise(data.deductionsPaise)} strong />
                    </>
                )}
                <div style={{ borderTop: "1px dashed #777", margin: "6px 0" }} />
                <Row label="NET PAY" value={formatRupeesFromPaise(data.netPaise)} strong />
                <div style={{ fontSize: 10, color: "#444", marginTop: 2 }}>{words}</div>
                {showAttendance && att && summary.length > 0 && (
                    <>
                        <div style={{ borderTop: "1px dashed #777", margin: "6px 0" }} />
                        <div style={{ fontWeight: 700 }}>Attendance &amp; hours</div>
                        {summary.map((l) => (
                            <div key={l.key} style={{ display: "flex", justifyContent: "space-between", gap: 6, fontSize: 10 }}>
                                <span>{l.label} · {l.days}</span>
                                <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                                    {l.working} = {l.accounted === null ? "—" : signed(l.accounted)}
                                </span>
                            </div>
                        ))}
                        <Row label={`Month · ${formatWorked(att.workedMinutes)} of ${formatWorked(att.dutyMinutes)}`} value={signed(att.accountedMinutes)} strong />
                        <Row label="Overtime payable" value={orDash(att.payableMinutes)} />
                        <Row label="Hours owed" value={orDash(att.owedMinutes)} />
                    </>
                )}
            </div>
        );
    }

    const cell: React.CSSProperties = { padding: "4px 6px", borderBottom: "1px solid #ddd" };
    const num: React.CSSProperties = { ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
    const head: React.CSSProperties = { ...cell, fontWeight: 700, background: "#f3f3f3", borderBottom: "1px solid #999" };
    const rows = Math.max(earnings.length, deductions.length, 1);
    // The attendance table's rows, a size down and a point tighter: a bad month
    // is a dozen exception rows, and every one of them has to stay on the sheet.
    const tight: React.CSSProperties = { ...cell, padding: "2px 5px" };
    const tightNum: React.CSSProperties = { ...num, padding: "2px 5px" };

    return (
        <div style={{ fontSize: 12, lineHeight: 1.4, color: "#111" }}>
            {/* Who and when — two columns, the way a slip is read. */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 24, rowGap: 2, marginBottom: 12 }}>
                {meta.map(([k, v]) => (
                    <div key={k} style={{ display: "flex", gap: 8 }}>
                        <span style={{ width: 84, color: "#555", flexShrink: 0 }}>{k}</span>
                        <span style={{ fontWeight: k === "Name" ? 700 : 400 }}>{v}</span>
                    </div>
                ))}
            </div>

            {/* Earnings beside deductions, totals on a common baseline. */}
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                    <tr>
                        <th style={{ ...head, textAlign: "left" }}>Earnings</th>
                        <th style={{ ...head, textAlign: "right" }}>Amount</th>
                        <th style={{ ...head, textAlign: "left", borderLeft: "1px solid #999" }}>Deductions</th>
                        <th style={{ ...head, textAlign: "right" }}>Amount</th>
                    </tr>
                </thead>
                <tbody>
                    {Array.from({ length: rows }, (_, i) => {
                        const e = earnings[i];
                        const d = deductions[i];
                        return (
                            <tr key={i}>
                                <td style={cell}>{e?.name ?? ""}</td>
                                <td style={num}>{e ? formatRupeesFromPaise(e.amountPaise) : ""}</td>
                                <td style={{ ...cell, borderLeft: "1px solid #999" }}>{d?.name ?? ""}</td>
                                <td style={num}>{d ? formatRupeesFromPaise(d.amountPaise) : ""}</td>
                            </tr>
                        );
                    })}
                    <tr style={{ fontWeight: 700 }}>
                        <td style={{ ...cell, borderBottom: "1px solid #999" }}>Gross earnings</td>
                        <td style={{ ...num, borderBottom: "1px solid #999" }}>{formatRupeesFromPaise(data.grossPaise)}</td>
                        <td style={{ ...cell, borderLeft: "1px solid #999", borderBottom: "1px solid #999" }}>Total deductions</td>
                        <td style={{ ...num, borderBottom: "1px solid #999" }}>{formatRupeesFromPaise(data.deductionsPaise)}</td>
                    </tr>
                </tbody>
            </table>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 10, gap: 12 }}>
                <div style={{ fontSize: 11, color: "#444", fontStyle: "italic" }}>{words}</div>
                <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: "nowrap" }}>
                    Net pay: {formatRupeesFromPaise(data.netPaise)}
                </div>
            </div>

            {/* The working behind the Overtime / Hours owed heads — the month's
                attendance, accounted day by day the way the activity card does it,
                frozen with the pay. Off a line from before it was frozen, or when
                the template hides it, the slip ends at the net. */}
            {showAttendance && att && summary.length > 0 && (
                <div style={{ marginTop: 12, fontSize: 11 }}>
                    <div style={{ fontWeight: 700, marginBottom: 3 }}>Attendance &amp; hours</div>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                            <tr>
                                <th style={{ ...head, textAlign: "left" }}>What</th>
                                <th style={{ ...head, textAlign: "right" }}>Days</th>
                                <th style={{ ...head, textAlign: "right" }}>Minutes × rate</th>
                                <th style={{ ...head, textAlign: "right" }}>Accounted</th>
                            </tr>
                        </thead>
                        <tbody>
                            {summary.map((l) => (
                                <tr key={l.key}>
                                    <td style={tight}>{l.label}</td>
                                    <td style={tightNum}>{l.days}</td>
                                    <td style={tightNum}>{l.working}</td>
                                    <td style={{ ...tightNum, fontWeight: 700 }}>{l.accounted === null ? "—" : signed(l.accounted)}</td>
                                </tr>
                            ))}
                            <tr style={{ fontWeight: 700 }}>
                                <td style={{ ...tight, borderBottom: "1px solid #999" }}>Month</td>
                                <td style={{ ...tightNum, borderBottom: "1px solid #999" }}>{dayCount(att.days.length)}</td>
                                <td style={{ ...tightNum, borderBottom: "1px solid #999" }}>{formatWorked(att.workedMinutes)} of {formatWorked(att.dutyMinutes)} owed</td>
                                <td style={{ ...tightNum, borderBottom: "1px solid #999" }}>{signed(att.accountedMinutes)}</td>
                            </tr>
                        </tbody>
                    </table>
                    <div style={{ marginTop: 4, color: "#444", fontSize: 10 }}>
                        Accounted is each day on its own. The month is then netted — overtime pays back the hours
                        fallen short first — and only what survives reaches the pay heads:{" "}
                        <b>overtime payable {orDash(att.payableMinutes)}</b> · <b>hours owed {orDash(att.owedMinutes)}</b>.
                        The day-by-day working is on your My Info page.
                    </div>
                </div>
            )}
        </div>
    );
}
