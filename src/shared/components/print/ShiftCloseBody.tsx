/**
 * Shift-close / register-reconciliation body — the timeline, drawer reconciliation,
 * closing distribution, tender breakdown and linked vouchers that sit between
 * the shared header and footer chrome of a SHIFT_CLOSE print.
 *
 * Pure presentational (no data loading), so it renders identically in:
 *   • /receipt/shift/[id] — real printout
 *   • the Print Templates settings preview (fed SAMPLE_SHIFT_CLOSE)
 *
 * Supports both `thermal` (80mm roll) and `A4` sheet layouts.
 */

import React from "react";
import { fmt } from "@/utils/constants";

export interface ShiftCloseBodyData {
    shiftId: number;
    status: string;
    openedAt: string;
    closedAt: string | null;
    durationStr?: string;
    cashierName: string;
    counterName: string;
    tillAccountName: string;
    branchName: string;
    notes?: string | null;

    openingFloatPaise: string | number;
    tillMovementPaise: string | number;
    dropsPaise: string | number;
    expectedCashPaise: string | number | null;
    declaredCashPaise: string | number | null;
    variancePaise: string | number | null;
    carryOverNextPaise: string | number | null;
    toVaultPaise: string | number | null;

    movementBreakdown?: {
        cashSalesPaise: string | number;
        receiptsPaise: string | number;
        expendituresPaise: string | number;
        refundsPaise: string | number;
        otherPaise?: string | number;
    };
    tenderBreakdown?: {
        label: string;
        amountPaise: string | number;
    }[];
    collectionsBreakdown?: {
        salesPaise: string | number;
        salesCount: number;
        receiptsPaise: string | number;
        receiptsCount: number;
        refundsPaise: string | number;
        refundsCount: number;
        netCollectedPaise: string | number;
    };
    closingContraVoucher?: { reference: string } | null;
    varianceJournalEntry?: { reference: string } | null;

    showSignature?: boolean;
    cashierSignatureLabel?: string;
    managerSignatureLabel?: string;
}

function num(val: string | number | null | undefined): number {
    if (val == null) return 0;
    return typeof val === "number" ? val : parseFloat(val) || 0;
}

function toRupees(paise: string | number | null | undefined): number {
    return num(paise) / 100;
}

function signed(n: number): string {
    return `${n < 0 ? "−" : "+"} ₹${fmt(Math.abs(n))}`;
}

function Divider() {
    return <div style={{ borderTop: "1px dashed #777", margin: "6px 0" }} />;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
    return (
        <div style={{ fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.8, margin: "6px 0 2px", color: "#333" }}>
            {children}
        </div>
    );
}

function Row({ label, value, bold, sub }: { label: string; value: React.ReactNode; bold?: boolean; sub?: boolean }) {
    return (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, margin: "2px 0", paddingLeft: sub ? 8 : 0, fontSize: sub ? 10 : 11 }}>
            <span style={{ color: sub ? "#666" : "#222", flex: 1 }}>{label}</span>
            <span style={{ fontWeight: bold ? 700 : 400, fontFamily: "monospace", textAlign: "right" }}>{value}</span>
        </div>
    );
}

export function ShiftCloseBody({
    data,
    thermal = false,
    showSignature,
}: {
    data: ShiftCloseBodyData;
    thermal?: boolean;
    showSignature?: boolean;
}) {
    const shouldShowSig = showSignature ?? data.showSignature ?? true;
    const openedAt = new Date(data.openedAt);
    const closedAt = data.closedAt ? new Date(data.closedAt) : null;
    const durationMs = closedAt ? closedAt.getTime() - openedAt.getTime() : 0;
    const durationH = Math.floor(durationMs / 3_600_000);
    const durationM = Math.floor((durationMs % 3_600_000) / 60_000);
    const durationStr = data.durationStr || (closedAt ? `${durationH}h ${durationM}m` : "In progress");

    const fmtTime = (d: Date) => d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    const fmtDateStr = (d: Date) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

    const opening = toRupees(data.openingFloatPaise);
    const movement = toRupees(data.tillMovementPaise);
    const drops = toRupees(data.dropsPaise);
    const expected = data.expectedCashPaise != null ? toRupees(data.expectedCashPaise) : 0;
    const declared = data.declaredCashPaise != null ? toRupees(data.declaredCashPaise) : null;
    const varianceVal = data.variancePaise != null ? toRupees(data.variancePaise) : null;
    const carryOver = data.carryOverNextPaise != null ? toRupees(data.carryOverNextPaise) : null;
    const toVault = data.toVaultPaise != null ? toRupees(data.toVaultPaise) : null;

    const tenderTotal = (data.tenderBreakdown ?? []).reduce((s, t) => s + toRupees(t.amountPaise), 0);

    const m = data.movementBreakdown;
    const c = data.collectionsBreakdown;

    return (
        <div style={{ fontSize: thermal ? 11 : 12, lineHeight: 1.35, color: "#111" }}>
            {/* Meta summary */}
            <div style={{ textAlign: "center", marginBottom: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: thermal ? 11 : 13, margin: "2px 0" }}>
                    <span>Shift #{data.shiftId} ({data.status})</span>
                    <span>{fmtDateStr(openedAt)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#444", margin: "1px 0" }}>
                    <span>Counter: <b>{data.counterName}</b> ({data.tillAccountName})</span>
                    <span>Cashier: <b>{data.cashierName}</b></span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#444", margin: "1px 0" }}>
                    <span>Duration: {durationStr}</span>
                    <span>Opened: {fmtTime(openedAt)}{closedAt ? ` · Closed: ${fmtTime(closedAt)}` : ""}</span>
                </div>
            </div>

            <Divider />

            {/* Cash Reconciliation */}
            <SectionTitle>Cash Reconciliation</SectionTitle>
            <Row label="Counter opening cash" value={`₹${fmt(opening)}`} bold />
            <Row label="Counter cash flow" value={signed(movement)} bold />

            {m && (
                <>
                    {num(m.cashSalesPaise) > 0 && (
                        <Row label="· Cash sales" value={`+ ₹${fmt(toRupees(m.cashSalesPaise))}`} sub />
                    )}
                    {num(m.receiptsPaise) > 0 && (
                        <Row label="· Customer receipts (Rcv)" value={`+ ₹${fmt(toRupees(m.receiptsPaise))}`} sub />
                    )}
                    {num(m.expendituresPaise) > 0 && (
                        <Row label="· Counter expenses (Exp)" value={`− ₹${fmt(toRupees(m.expendituresPaise))}`} sub />
                    )}
                    {num(m.refundsPaise) > 0 && (
                        <Row label="· Cash refunds / returns" value={`− ₹${fmt(toRupees(m.refundsPaise))}`} sub />
                    )}
                    {m.otherPaise !== undefined && num(m.otherPaise) !== 0 && (
                        <Row label="· Other adjustments" value={signed(toRupees(m.otherPaise))} sub />
                    )}
                </>
            )}

            {drops > 0 && (
                <Row label="Dropped to safe" value={`− ₹${fmt(drops)}`} />
            )}

            <div style={{ borderTop: "1px solid #ddd", marginTop: 3, paddingTop: 3 }}>
                <Row label="Expected in drawer" value={`₹${fmt(expected)}`} bold />
            </div>

            {declared != null && (
                <>
                    <Row label="Physical count (Declared)" value={`₹${fmt(declared)}`} bold />
                    <div style={{
                        display: "flex", justifyContent: "space-between", margin: "2px 0",
                        fontWeight: 700,
                        color: varianceVal === 0 ? "#166534" : (varianceVal ?? 0) > 0 ? "#15803d" : "#b91c1c",
                    }}>
                        <span>Variance</span>
                        <span style={{ fontFamily: "monospace" }}>
                            {varianceVal === 0
                                ? "₹0.00 (Balanced)"
                                : `${(varianceVal ?? 0) > 0 ? "+" : "−"}₹${fmt(Math.abs(varianceVal ?? 0))} (${(varianceVal ?? 0) > 0 ? "Over" : "Short"})`}
                        </span>
                    </div>
                </>
            )}

            {/* Closing Distribution */}
            {(carryOver != null || toVault != null) && (
                <>
                    <Divider />
                    <SectionTitle>Closing Distribution</SectionTitle>
                    {carryOver != null && (
                        <Row label="Kept in counter (carry-over)" value={`₹${fmt(carryOver)}`} />
                    )}
                    {toVault != null && (
                        <Row label="Swept to vault" value={`₹${fmt(toVault)}`} bold />
                    )}
                </>
            )}

            {/* Payments Collected */}
            {data.tenderBreakdown && data.tenderBreakdown.length > 0 && (
                <>
                    <Divider />
                    <SectionTitle>Payments Collected</SectionTitle>
                    {data.tenderBreakdown.map((t, i) => (
                        <Row key={i} label={t.label} value={`₹${fmt(toRupees(t.amountPaise))}`} />
                    ))}
                    <div style={{ borderTop: "1px solid #bbb", marginTop: 2, paddingTop: 2 }}>
                        <Row label="Total Collected" value={`₹${fmt(tenderTotal)}`} bold />
                    </div>
                </>
            )}

            {/* Collections by Activity */}
            {c && (
                <>
                    <Divider />
                    <SectionTitle>Collections by Activity</SectionTitle>
                    <Row label={`POS Sales (${c.salesCount} bills)`} value={`+ ₹${fmt(toRupees(c.salesPaise))}`} />
                    {c.receiptsCount > 0 && (
                        <Row label={`Customer receipts (${c.receiptsCount} rcv)`} value={`+ ₹${fmt(toRupees(c.receiptsPaise))}`} />
                    )}
                    {c.refundsCount > 0 && (
                        <Row label={`Refunds / returns (${c.refundsCount})`} value={`− ₹${fmt(toRupees(c.refundsPaise))}`} />
                    )}
                    <div style={{ borderTop: "1px solid #bbb", marginTop: 2, paddingTop: 2 }}>
                        <Row label="Net Total" value={`₹${fmt(toRupees(c.netCollectedPaise))}`} bold />
                    </div>
                </>
            )}

            {/* Linked Vouchers */}
            {(data.closingContraVoucher || data.varianceJournalEntry) && (
                <>
                    <Divider />
                    <SectionTitle>Linked Vouchers</SectionTitle>
                    {data.closingContraVoucher && (
                        <Row label="Closing Contra" value={data.closingContraVoucher.reference} sub />
                    )}
                    {data.varianceJournalEntry && (
                        <Row label="Variance JE" value={data.varianceJournalEntry.reference} sub />
                    )}
                </>
            )}

            {/* Notes */}
            {data.notes && (
                <>
                    <Divider />
                    <SectionTitle>Notes</SectionTitle>
                    <div style={{ fontSize: 10, whiteSpace: "pre-wrap", color: "#444", margin: "2px 0" }}>
                        {data.notes}
                    </div>
                </>
            )}

            {/* Cashier & Manager Signatures */}
            {shouldShowSig && (
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 18, paddingTop: 6 }}>
                    <div style={{
                        borderTop: "1px solid #444",
                        width: thermal ? "46%" : "40%",
                        textAlign: "center",
                        fontSize: 9,
                        color: "#555",
                        paddingTop: 3,
                    }}>
                        {data.cashierSignatureLabel || "Cashier Signature"}
                    </div>
                    <div style={{
                        borderTop: "1px solid #444",
                        width: thermal ? "46%" : "40%",
                        textAlign: "center",
                        fontSize: 9,
                        color: "#555",
                        paddingTop: 3,
                    }}>
                        {data.managerSignatureLabel || "Manager Signature"}
                    </div>
                </div>
            )}
        </div>
    );
}
