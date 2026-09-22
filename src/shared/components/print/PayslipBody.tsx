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

export interface PayslipLine {
    name: string;
    kind: "EARNING" | "DEDUCTION";
    amountPaise: number;
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
}

function Row({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
    return (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontWeight: strong ? 700 : 400 }}>
            <span>{label}</span>
            <span style={{ fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{value}</span>
        </div>
    );
}

export function PayslipBody({ data, thermal = false }: { data: PayslipBodyData; thermal?: boolean }) {
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
            </div>
        );
    }

    const cell: React.CSSProperties = { padding: "4px 6px", borderBottom: "1px solid #ddd" };
    const num: React.CSSProperties = { ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
    const head: React.CSSProperties = { ...cell, fontWeight: 700, background: "#f3f3f3", borderBottom: "1px solid #999" };
    const rows = Math.max(earnings.length, deductions.length, 1);

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
        </div>
    );
}
