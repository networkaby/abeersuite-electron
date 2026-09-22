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

const fmtDay = (iso: string) =>
    new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });

/**
 * The days worth a row of their own, and the rest folded into one line.
 *
 * Owner, 2026-09-22: *"30 days is big to fit."* The slip exists to explain the
 * Overtime and Hours owed heads, and a day worked in full at ×1 explains
 * nothing — so only a day that moved the money is printed: overtime, lateness,
 * a shortfall, a half day or absence, a weekly off or holiday worked. The
 * ordinary days are counted, with their minutes, so the month row still adds up
 * in front of the reader.
 */
function splitDays(days: readonly PayslipAttendanceDay[]) {
    const exceptions: PayslipAttendanceDay[] = [];
    let ordinary = 0, ordinaryMinutes = 0;
    for (const d of days) {
        const plain = !d.shut && d.overtime === 0 && d.late === 0 && d.short === 0 && (d.status === "PRESENT" || !d.status);
        if (plain) { ordinary++; ordinaryMinutes += d.worked; }
        else exceptions.push(d);
    }
    return { exceptions, ordinary, ordinaryMinutes };
}

/** A shut day's one-word reason for the Day column. */
const shutWord = (d: PayslipAttendanceDay) => (d.shut === "HOLIDAY" ? "holiday" : d.shut === "OFF" ? "weekly off" : null);

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
    const split = splitDays(att?.days ?? []);
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
                {showAttendance && att && att.days.length > 0 && (
                    <>
                        <div style={{ borderTop: "1px dashed #777", margin: "6px 0" }} />
                        <div style={{ fontWeight: 700 }}>Attendance &amp; hours</div>
                        {split.ordinary > 0 && (
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 6, fontSize: 10 }}>
                                <span>{split.ordinary} {split.ordinary === 1 ? "day" : "days"} present in full</span>
                                <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{formatWorked(split.ordinaryMinutes)} = {formatWorked(split.ordinaryMinutes)}</span>
                            </div>
                        )}
                        {split.exceptions.map((d) => (
                            <div key={d.date} style={{ display: "flex", justifyContent: "space-between", gap: 6, fontSize: 10 }}>
                                <span>{fmtDay(d.date)}{shutWord(d) ? ` · ${shutWord(d)}` : ""}</span>
                                <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                                    {formatWorked(d.worked)}
                                    {d.lateAccounted < 0 ? ` L${signed(d.lateAccounted)}` : ""}
                                    {" = "}{signed(d.total)}
                                </span>
                            </div>
                        ))}
                        <Row label="Accounted (before netting)" value={signed(att.accountedMinutes)} strong />
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
            {showAttendance && att && att.days.length > 0 && (
                <div style={{ marginTop: 12, fontSize: 10 }}>
                    <div style={{ fontWeight: 700, marginBottom: 3, fontSize: 11 }}>Attendance &amp; hours</div>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                            <tr>
                                <th style={{ ...head, textAlign: "left" }}>Day</th>
                                <th style={{ ...head, textAlign: "right" }}>Worked</th>
                                <th style={{ ...head, textAlign: "right" }}>Duty</th>
                                <th style={{ ...head, textAlign: "right" }}>Overtime ×{att.rates.overtime}</th>
                                <th style={{ ...head, textAlign: "right" }}>Late {att.rates.late}</th>
                                <th style={{ ...head, textAlign: "right" }}>Short ×{att.rates.shortHours}</th>
                                <th style={{ ...head, textAlign: "right" }}>Accounted</th>
                            </tr>
                        </thead>
                        <tbody>
                            {split.ordinary > 0 && (
                                <tr>
                                    <td style={tight}>
                                        {split.ordinary} {split.ordinary === 1 ? "day" : "days"} present in full
                                        <span style={{ color: "#555" }}> · nothing to account beyond the duty</span>
                                    </td>
                                    <td style={tightNum}>{formatWorked(split.ordinaryMinutes)}</td>
                                    <td style={tightNum}>{formatWorked(split.ordinaryMinutes)}</td>
                                    <td style={tightNum}>—</td>
                                    <td style={tightNum}>—</td>
                                    <td style={tightNum}>—</td>
                                    <td style={{ ...tightNum, fontWeight: 700 }}>{formatWorked(split.ordinaryMinutes)}</td>
                                </tr>
                            )}
                            {split.exceptions.map((d) => (
                                <tr key={d.date}>
                                    <td style={tight}>
                                        {fmtDay(d.date)}
                                        <span style={{ color: "#555" }}>
                                            {shutWord(d) ? ` · ${shutWord(d)}` : d.status && d.status !== "PRESENT" ? ` · ${d.status.toLowerCase().replace(/_/g, " ")}` : ""}
                                        </span>
                                    </td>
                                    <td style={tightNum}>{orDash(d.worked)}</td>
                                    <td style={tightNum}>{d.shut ? "—" : orDash(d.duty)}</td>
                                    <td style={tightNum}>
                                        {d.shut
                                            ? `${orDash(d.worked)} ×${d.shut === "HOLIDAY" ? att.rates.holiday : att.rates.weeklyOff} = ${signed(d.grantedAccounted)}`
                                            : d.overtime > 0 ? `${formatWorked(d.overtime)} = ${signed(d.overtimeAccounted)}` : "—"}
                                    </td>
                                    <td style={tightNum}>{d.late > 0 ? `${formatWorked(d.late)} = ${signed(d.lateAccounted)}` : "—"}</td>
                                    <td style={tightNum}>{d.short > 0 ? `${formatWorked(d.short)} = ${signed(d.shortAccounted)}` : "—"}</td>
                                    <td style={{ ...tightNum, fontWeight: 700 }}>{signed(d.total)}</td>
                                </tr>
                            ))}
                            <tr style={{ fontWeight: 700 }}>
                                <td style={{ ...cell, borderBottom: "1px solid #999" }}>Month</td>
                                <td style={{ ...num, borderBottom: "1px solid #999" }}>{orDash(att.workedMinutes)}</td>
                                <td style={{ ...num, borderBottom: "1px solid #999" }}>{orDash(att.dutyMinutes)}</td>
                                <td style={{ ...num, borderBottom: "1px solid #999" }} colSpan={3}>
                                    late {att.lateDays} {att.lateDays === 1 ? "day" : "days"}{att.lateDays > 0 ? ` (${att.chargedLateDays} charged, first ${att.rates.lateFreeDays} free)` : ""}
                                </td>
                                <td style={{ ...num, borderBottom: "1px solid #999" }}>{signed(att.accountedMinutes)}</td>
                            </tr>
                        </tbody>
                    </table>
                    <div style={{ marginTop: 4, color: "#444" }}>
                        Accounted is each day on its own. The month is then netted — overtime pays back the hours
                        fallen short first — and only what survives reaches the pay heads:{" "}
                        <b>overtime payable {orDash(att.payableMinutes)}</b> · <b>hours owed {orDash(att.owedMinutes)}</b>
                        {att.weeklyOffMinutes > 0 && <> · weekly-off duty {formatWorked(att.weeklyOffMinutes)} at ×{att.rates.weeklyOff}</>}
                        {att.holidayMinutes > 0 && <> · holiday duty {formatWorked(att.holidayMinutes)} at ×{att.rates.holiday}</>}
                        .
                    </div>
                </div>
            )}
        </div>
    );
}
