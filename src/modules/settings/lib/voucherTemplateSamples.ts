/**
 * Plausible per-kind sample payloads for the voucher template preview.
 * Used by both:
 *   • <VoucherTemplatesPanel>                    — live preview alongside the form
 *   • <VoucherTemplatesPreviewGallery>           — side-by-side A4 + Thermal demo
 *
 * These are display-only fixtures; they don't reflect any real DB rows.
 */

import type { ThermalReceiptSample } from "@/shared/components/print/ThermalReceiptPreview";
import type { VoucherTemplateKind } from "@/shared/lib/print/voucherTemplateDefaults";
import type { RepairTicketBodyData } from "@/shared/components/print/RepairTicketBody";
import type { ShippingSlipBodyData } from "@/shared/components/print/ShippingSlipBody";
import type { ShippingLabelData } from "@/shared/components/print/ShippingLabel";
import type { ParcelLabelData } from "@/shared/components/print/OrderParcelLabel";
import type { CouponCardData } from "@/shared/components/print/CouponCard";
import type { GiftCardData } from "@/shared/components/print/GiftCardCard";
import type { ShiftCloseBodyData } from "@/shared/components/print/ShiftCloseBody";
import type { PayslipBodyData } from "@/shared/components/print/PayslipBody";

// 1×1 transparent PNG stands in for the QR in the editor preview.
const SAMPLE_QR = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

export const SAMPLE_COUPON_CARD: CouponCardData = {
    headline:  "10% OFF",
    name:      "Festive Offer",
    code:      "FEST10",
    qrDataUrl: SAMPLE_QR,
    subLines:  ["10% off the bill.", "Min bill ₹1,000.", "Valid until 2026-12-31."],
};

export const SAMPLE_GIFT_CARD: GiftCardData = {
    valueText: "₹1,000.00",
    code:      "GC-7F3K-92QA",
    qrDataUrl: SAMPLE_QR,
    subLines:  ["Valid until 2027-06-30."],
};

// Sample issuing-branch address for previewing the "Branch address" toggle.
const SAMPLE_BRANCH_ADDRESS = "Zone Road, Ward 5\nBongaigaon, Assam, 783380";

// Bespoke-document body fixtures — the repair ticket / shipping slip carry their
// OWN body (not the invoice line-items layout), so the settings preview renders
// the real body with these samples instead of a phantom invoice.
export const SAMPLE_REPAIR_TICKET: RepairTicketBodyData = {
    ticketNo:      "#0042",
    date:          "18 Jul 2026, 21:18",
    customer:      { name: "Wasim Akram", phone: "80113 55630", email: null },
    device:        { type: "Laptop", brand: "Dell", model: "XPS 13" },
    problem:       "Screen not turning on; suspected display cable.",
    accessories:   "Carry bag, 65W charger",
    estimatedCost: "2,500",
    priority:      "MEDIUM",
    createdBy:     "Admin",
};

export const SAMPLE_SHIPPING_SLIP: ShippingSlipBodyData = {
    ticketNo:          "#0042",
    date:              "18 Jul 2026",
    ref:               "RMA-2291",
    party:             { name: "ABC Service Centre", address: "Zone Road, Ward 5\nBongaigaon, Assam", phone: "90000 00000" },
    partyNameFallback: null,
    owner:             { name: "Wasim Akram", phone: "80113 55630" },
    device:            { type: "Laptop", brand: "Dell", model: "XPS 13", problem: "Screen not turning on." },
    accessories:       "charger, sleeve",
    condition:         "minor scratches on lid",
    hasSlip:           true,
    preparedBy:        "Admin",
};

// From is filled live from the edited template in the preview; these are just
// placeholder sender lines so the fixture stands alone.
export const SAMPLE_SHIPPING_LABEL: ShippingLabelData = {
    from:     { name: "Network Service", address: "Main Road\nBongaigaon, Assam", phone: "88769 96996" },
    to:       { name: "ABC Service Centre", address: "Zone Road, Ward 5\nBongaigaon, Assam, 783380", phone: "90000 00000" },
    ticketNo: "#0042",
    date:     "18 Jul 2026",
    ref:      "RMA-2291",
    device:   "Dell XPS 13 (Laptop)",
    footer:   "Handle with care · Fragile electronics",
};

// Parcel label (DELIVERY_SHIPPING_LABEL) — an order shipped by our own courier.
export const SAMPLE_PARCEL_LABEL: ParcelLabelData = {
    from:    { name: "Network Service", address: "Main Road\nBongaigaon, Assam", phone: "88769 96996" },
    to:      { name: "Akramul Jakir", address: "Kalaprishad Market, Main Road\nAbhayapuri, Kamrup, Assam", phone: "99549 99271", pincode: "781009" },
    orderNo: "WEB-27",
    date:    "23 Jul 2026",
    courier: "Local delivery · Bike",
    awb:     null,
    payment: { cod: true, amountLabel: "₹980.86" },
    weightGrams: 500,
    items:   1,
    footer:  "Handle with care",
};

// POS Shift Close fixture — realistic cash reconciliation and till movement.
export const SAMPLE_SHIFT_CLOSE: ShiftCloseBodyData = {
    shiftId: 12,
    status: "CLOSED",
    openedAt: "2026-09-14T09:00:00.000Z",
    closedAt: "2026-09-14T18:30:00.000Z",
    durationStr: "9h 30m",
    cashierName: "Wasim Akram",
    counterName: "Counter 1",
    tillAccountName: "Till 1 Cash",
    branchName: "Main Branch",
    openingFloatPaise: "200000",
    tillMovementPaise: "1455000",
    dropsPaise: "500000",
    expectedCashPaise: "1155000",
    declaredCashPaise: "1155000",
    variancePaise: "0",
    carryOverNextPaise: "200000",
    toVaultPaise: "955000",
    movementBreakdown: {
        cashSalesPaise: "1350000",
        receiptsPaise: "250000",
        expendituresPaise: "100000",
        refundsPaise: "45000",
        otherPaise: "0",
    },
    tenderBreakdown: [
        { label: "Cash", amountPaise: "1350000" },
        { label: "UPI / QR", amountPaise: "820000" },
        { label: "Card (HDFC)", amountPaise: "450000" },
    ],
    collectionsBreakdown: {
        salesPaise: "2620000",
        salesCount: 18,
        receiptsPaise: "250000",
        receiptsCount: 2,
        refundsPaise: "45000",
        refundsCount: 1,
        netCollectedPaise: "2825000",
    },
    closingContraVoucher: { reference: "CV/26-27/0045" },
    notes: "Shift closed on time. Cash tallied and swept to vault.",
};

// Salary slip fixture — one posted payroll line, the way HR's Pay tab writes it.
export const SAMPLE_PAYSLIP: PayslipBodyData = {
    slipNo: "PS-1042",
    staffName: "Wasim Akram",
    staffCode: "ST-007",
    designation: "Counter Executive",
    joinedOn: "2024-04-01",
    periodFrom: "2026-09-01",
    periodTo: "2026-09-30",
    postingDate: "2026-09-30",
    voucherRef: "JV-10812-26",
    paidDays: 25,
    periodDays: 30,
    payDays: 26,
    lines: [
        { name: "Basic", kind: "EARNING", amountPaise: 1_500_000 },
        { name: "HRA", kind: "EARNING", amountPaise: 300_000 },
        { name: "Overtime", kind: "EARNING", amountPaise: 86_500 },
        { name: "Advance recovery", kind: "DEDUCTION", amountPaise: 200_000 },
        { name: "Late arrival", kind: "DEDUCTION", amountPaise: 28_800 },
    ],
    grossPaise: 1_886_500,
    deductionsPaise: 228_800,
    netPaise: 1_657_700,
    // A week of the month, the way the generator freezes it: a plain day, an
    // overtime day, a charged late day, a half day and a weekly off worked.
    attendance: {
        days: [
            { date: "2026-09-21", status: "PRESENT",  shut: null,  worked: 600, duty: 600, overtime: 0,  overtimeAccounted: 0,  late: 0,  lateAccounted: 0,   short: 0,   shortAccounted: 0,    grantedAccounted: 0,   total: 600 },
            { date: "2026-09-22", status: "PRESENT",  shut: null,  worked: 660, duty: 600, overtime: 60, overtimeAccounted: 90, late: 0,  lateAccounted: 0,   short: 0,   shortAccounted: 0,    grantedAccounted: 0,   total: 690 },
            { date: "2026-09-23", status: "PRESENT",  shut: null,  worked: 585, duty: 600, overtime: 0,  overtimeAccounted: 0,  late: 23, lateAccounted: -46, short: 15,  shortAccounted: -15,  grantedAccounted: 0,   total: 524 },
            { date: "2026-09-24", status: "HALF_DAY", shut: null,  worked: 280, duty: 600, overtime: 0,  overtimeAccounted: 0,  late: 0,  lateAccounted: 0,   short: 320, shortAccounted: -20,  grantedAccounted: 0,   total: 260 },
            { date: "2026-09-25", status: "PRESENT",  shut: "OFF", worked: 190, duty: 0,   overtime: 0,  overtimeAccounted: 0,  late: 0,  lateAccounted: 0,   short: 0,   shortAccounted: 0,    grantedAccounted: 380, total: 380 },
        ],
        workedMinutes: 2315,
        dutyMinutes: 2400,
        accountedMinutes: 2454,
        payableMinutes: 0,
        owedMinutes: 21,
        weeklyOffMinutes: 190,
        holidayMinutes: 0,
        lateDays: 3,
        chargedLateDays: 1,
        rates: { overtime: 1.5, shortHours: 1, weeklyOff: 2, holiday: 2, late: "× 2", lateFreeDays: 2 },
    },
};

/** Sample-only date shift — the credit-sale due date in the preview. */
function addSampleDays(iso: string, days: number): string {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

export function buildSampleForKind(kind: VoucherTemplateKind): ThermalReceiptSample {
    const today = new Date().toISOString().slice(0, 10);
    const productLines: ThermalReceiptSample["lines"] = [
        { description: "Logitech B100 USB Mouse", quantity: 2, amount: 598 },
        { description: "HP Laptop 14s Charger",   quantity: 1, amount: 1499 },
        { description: "TP-Link Cat6 Cable 5m",   quantity: 3, amount: 597 },
    ];
    const cashLine: ThermalReceiptSample["lines"] = [
        { description: "Cash received from customer", quantity: 1, amount: 5000 },
    ];

    // INTRA-state sample (Assam → Assam, 18% GST = 9% CGST + 9% SGST). Used
    // by SALE / POS / RECEIPT etc. — the most common case.
    const intraBreakdown = {
        kind: "INTRA" as const,
        cgst: 242.46,
        sgst: 242.46,
        placeOfSupplyName: "Assam",
    };
    // INTER-state sample (Assam → Maharashtra, 18% IGST). Used by PURCHASE
    // and one of the returns to demonstrate the IGST single-line layout.
    const interBreakdown = {
        kind: "INTER" as const,
        igst: 484.92,
        placeOfSupplyName: "Maharashtra",
    };

    switch (kind) {
        case "SALE":
            // Formal TAX INVOICE — REAL per-line prices + tax. NOT the price-hiding
            // ladder (that's POS-only): a SALE is often B2B, so the buyer needs the
            // true line value + GSTIN for input-tax-credit.
            //
            // Shows the full Tally goods table: HSN · per · line note · line
            // discount, with the bill charges and the GST legs as ledger rows
            // under the items. Amounts are PRE-TAX so the printed column adds up
            // (2,257.12 goods + 500 + 120 + 406.28 GST − 0.40 round-off = 3,283).
            return {
                reference: "SV/26-27/0017", date: today,
                partyName: "Acme Traders", partyPhone: null,
                partyGstin: "18ABCDE1234F1Z5",
                partyState: "Assam, Code : 18",
                paymentTerms: "Credit — 30 days",
                dueDate: addSampleDays(today, 30),
                lines: [
                    { description: "Logitech B100 USB Mouse", quantity: 2, amount: 506.78, taxable: 506.78,
                      hsn: "8471", unit: "Nos", mrp: 399, taxRate: 18, taxAmount: 91.22 },
                    { description: "HP Laptop 14s Charger", quantity: 1, amount: 1270.34, taxable: 1270.34,
                      hsn: "8504", unit: "Nos", mrp: 1799, taxRate: 18, taxAmount: 228.66,
                      note: "For 14s-fq1092 series only" },
                    { description: "TP-Link Cat6 Cable 5m", quantity: 3, amount: 480, taxable: 480,
                      hsn: "8544", unit: "Nos", mrp: 249, taxRate: 18, taxAmount: 86.40, discount: 25.92 },
                ],
                subtotal: 2257.12, taxAmount: 406.28, total: 3283,
                notes: null,
                taxBreakdown: { kind: "INTRA", cgst: 203.14, sgst: 203.14, placeOfSupplyName: "Assam" },
                hsnSummary: [
                    { hsn: "8471", ratePct: 18, taxable: 506.78,  cgst: 45.61,  sgst: 45.61,  total: 91.22 },
                    { hsn: "8504", ratePct: 18, taxable: 1270.34, cgst: 114.33, sgst: 114.33, total: 228.66 },
                    { hsn: "8544", ratePct: 18, taxable: 480,     cgst: 43.20,  sgst: 43.20,  total: 86.40 },
                ],
                charges: [
                    { label: "Installation & Setup Charges", amount: 500 },
                    { label: "Shipping", amount: 120 },
                ],
                roundOff: -0.40,
                receipts: [{ label: "Cash", amount: 2000 }],
                balanceDue: 1283,
                // Party's running account — printed only when the template's
                // "Party balance" toggle is on.
                balanceBefore: "Rs. 12,400.00 Dr",
                balanceAfter:  "Rs. 13,683.00 Dr",
                branchAddress: SAMPLE_BRANCH_ADDRESS,
            };
        case "POS":
            // Customer COUNTER RECEIPT — the price-hiding "Counter discount" ladder:
            // per-line MRP/tag + pooled discounts + savings hero + HSN summary.
            return {
                reference: "POS/26-27/0042", date: today,
                partyName: "Walk-in", partyPhone: null, partyGstin: null,
                lines: [
                    { description: "Logitech B100 USB Mouse", quantity: 2, amount: 700,  mrp: 800,  barcode: 700 },
                    { description: "HP Laptop 14s Charger",   quantity: 1, amount: 1600, mrp: 1800, barcode: 1600 },
                    { description: "TP-Link Cat6 Cable 5m",   quantity: 3, amount: 700,  mrp: 800,  barcode: 700 },
                ],
                subtotal: 3000, taxAmount: 345.51, total: 2315,
                notes: null,
                taxBreakdown: intraBreakdown,
                discounts: {
                    grossAtTag: 3000,
                    rows: [
                        { label: "Counter discount",        amount: 300 },
                        { label: "Level Discount (Gold)",   amount: 135 },
                        { label: "Loyalty (100 pts)",       amount: 100 },
                        { label: "Coupon SAVE10",           amount: 200 },
                    ],
                    charges: [
                        { label: "Shipping", amount: 50 },
                    ],
                    total: 735,
                    // Saving from MRP = MRP total (3400) − Grand Total (2315).
                    savingsTotal: 1085,
                    savingsPct: 32,
                },
                hsnSummary: [
                    { hsn: "8471", ratePct: 18, taxable: 1919.49, cgst: 172.76, sgst: 172.75, total: 2265 },
                ],
                branchAddress: SAMPLE_BRANCH_ADDRESS,
            };
        case "ONLINE_INVOICE":
            // Parcel-insert receipt — duplicate of the POS ladder look, but for a
            // shipped online order: named customer + the full online benefit
            // stack (level discount, loyalty points, coupon) + shipping. Gift
            // cards are a TENDER, not a discount — they never show here.
            return {
                reference: "OI-2026-0042", date: today,
                partyName: "Akramul Jakir", partyPhone: "+91 90000 00000", partyGstin: null,
                lines: [
                    { description: "Logitech B100 USB Mouse", quantity: 2, amount: 700,  mrp: 800,  barcode: 700 },
                    { description: "HP Laptop 14s Charger",   quantity: 1, amount: 1600, mrp: 1800, barcode: 1600 },
                    { description: "TP-Link Cat6 Cable 5m",   quantity: 3, amount: 700,  mrp: 800,  barcode: 700 },
                ],
                subtotal: 3000, taxAmount: 391.27, total: 2615,
                notes: null,
                taxBreakdown: intraBreakdown,
                discounts: {
                    grossAtTag: 3000,
                    rows: [
                        { label: "Level Discount (Gold)",  amount: 135 },
                        { label: "Loyalty: 100 pts redeemed", amount: 100 },
                        { label: "Coupon SAVE10",          amount: 200 },
                    ],
                    charges: [
                        { label: "Shipping", amount: 50 },
                    ],
                    total: 435,
                    // Saving from MRP = MRP total (3400) − goods paid (2565).
                    savingsTotal: 835,
                    savingsPct: 25,
                },
                hsnSummary: [
                    { hsn: "8471", ratePct: 18, taxable: 2173.73, cgst: 195.64, sgst: 195.63, total: 2565 },
                ],
                branchAddress: SAMPLE_BRANCH_ADDRESS,
            };
        case "PURCHASE":
            return {
                reference: "PV/26-27/0008", date: today,
                partyName: "Acme Distributors (Mumbai)", partyPhone: "+91 98000 11111",
                lines: productLines, subtotal: 2694, taxAmount: 484.92, total: 3178.92,
                notes: null,
                taxBreakdown: interBreakdown,
            };
        case "ESTIMATE":
            return {
                reference: "EV/26-27/0003", date: today,
                partyName: "Sample Customer", partyPhone: null,
                lines: productLines, subtotal: 2694, taxAmount: 484.92, total: 3178.92,
                notes: "Valid for 7 days from issue date.",
                taxBreakdown: intraBreakdown,
            };
        case "SALE_RETURN":
        case "PURCHASE_RETURN":
            return {
                reference: kind === "SALE_RETURN" ? "SR/26-27/0001" : "PR/26-27/0001",
                date: today,
                partyName: "Sample Party", partyPhone: null,
                lines: [productLines[0]], subtotal: 598, taxAmount: 107.64, total: 705.64,
                notes: null,
                taxBreakdown: kind === "PURCHASE_RETURN"
                    ? { kind: "INTER" as const, igst: 107.64, placeOfSupplyName: "Maharashtra" }
                    : { kind: "INTRA" as const, cgst: 53.82, sgst: 53.82, placeOfSupplyName: "Assam" },
            };
        case "RECEIPT":
        case "PAYMENT":
            // Money vouchers render the receipt-book middle: the line description
            // becomes the "by ___" instrument, notes become "towards ___".
            return {
                reference: kind === "RECEIPT" ? "RV/26-27/0091" : "PV/26-27/0073",
                date: today,
                partyName: kind === "RECEIPT" ? "Walk-in" : "Acme Distributors",
                partyPhone: null,
                lines: [{ description: kind === "RECEIPT" ? "Cash" : "Bank Transfer", quantity: 1, amount: 5000 }],
                subtotal: null, taxAmount: null, total: 5000,
                notes: kind === "RECEIPT" ? "Against bill #SV/26-27/0017" : "Against bill #PV/26-27/0008",
                // Party ledger strip: customer owes Dr, supplier is owed Cr.
                balanceBefore: kind === "RECEIPT" ? "Rs. 12,315.00 Dr" : "Rs. 27,712.00 Cr",
                balanceAfter:  kind === "RECEIPT" ? "Rs. 7,315.00 Dr"  : "Rs. 22,712.00 Cr",
            };
        case "CONTRA":
            // Plain contra (no denomination slip) — a bank ↔ cash movement that
            // isn't a formal deposit or a counted handover. Renders the neutral
            // Particulars · Debit · Credit journal table. buildGlSample() routes
            // cash→bank to BANK_DEPOSIT and counted cash→cash to CASH_HANDOVER;
            // everything else stays here.
            return {
                reference: "CV/26-27/0004", date: today,
                partyName: null, partyPhone: null,
                lines: [
                    { description: "Cash-in-Hand",     quantity: 1, amount: 20000, entryType: "DEBIT" },
                    { description: "SBI Bank A/c",      quantity: 1, amount: 20000, entryType: "CREDIT" },
                ],
                subtotal: null, taxAmount: null, total: 20000,
                notes: "Cash withdrawn from bank",
            };
        case "BANK_DEPOSIT":
            // Cash → Bank deposit: the depositSlip block makes the A4 preview
            // render the bank pay-in slip (blank denomination boxes + depositor
            // counterfoil). Real prints fill this from Organisation.bankJson +
            // OrgDefaults.cashDenominationsJson in buildGlSample().
            return {
                reference: "CV/26-27/0004", date: today,
                partyName: null, partyPhone: null,
                lines: [{ description: "Cash → Bank transfer", quantity: 1, amount: 50000 }],
                subtotal: null, taxAmount: null, total: 50000,
                notes: "Day's cash deposited",
                depositSlip: {
                    mode:        "deposit",
                    bankName:    "State Bank of India",
                    branch:      "Fancy Bazar Branch",
                    accountName: "Sample Enterprise",
                    accountNo:   "3812 4567 8901",
                    ifsc:        "SBIN0000123",
                    pan:         "ABCDE1234F",
                    fromLedger:  "Cash in Hand",
                    denominations: [500, 200, 100, 50, 20, 10, 5, 2, 1],
                    // Captured breakdown → the preview shows the FILLED slip
                    // (zero-count notes are skipped; cheques listed bill-wise).
                    // Cash 500×70 + 200×20 + 100×35 = 42,500 + cheque 7,500 =
                    // 50,000 = Amount Deposited.
                    counted: {
                        notes: [
                            { denom: 500, count: 70 },
                            { denom: 200, count: 20 },
                            { denom: 100, count: 35 },
                        ],
                        cheques: [{ no: "483920", amount: 7500, account: "PhonePe A/c" }],
                    },
                },
            };
        case "CASH_HANDOVER":
            // Cash → Cash handover (till → head office): the handover-mode
            // depositSlip makes the preview render the internal handover slip
            // (from/to ledgers + handed-by/received-by sigs, no bank block, no
            // counterfoil). Real prints fill this in buildGlSample() when a
            // cash→cash contra was saved with a counted breakdown.
            return {
                reference: "CV/26-27/0011", date: today,
                partyName: null, partyPhone: null,
                lines: [{ description: "Cash handover", quantity: 1, amount: 42500 }],
                subtotal: null, taxAmount: null, total: 42500,
                notes: "End-of-day cash to head office",
                depositSlip: {
                    mode:        "handover",
                    bankName: null, branch: null, accountName: null, accountNo: null, ifsc: null, pan: null,
                    fromLedger:  "Cash — Counter 1",
                    toLedger:    "Cash — Head Office",
                    denominations: [500, 200, 100, 50, 20, 10, 5, 2, 1],
                    // 500×70 + 200×20 + 100×35 = 42,500. Handovers are notes-only
                    // (no cheque section).
                    counted: {
                        notes: [
                            { denom: 500, count: 70 },
                            { denom: 200, count: 20 },
                            { denom: 100, count: 35 },
                        ],
                        cheques: [],
                    },
                },
            };
        case "JOURNAL":
            return {
                reference: "JV/26-27/0012", date: today,
                partyName: null, partyPhone: null,
                lines: [
                    { description: "Depreciation A/c",   quantity: 1, amount: 12500, entryType: "DEBIT" },
                    { description: "Fixed Assets A/c",   quantity: 1, amount: 12500, entryType: "CREDIT" },
                ],
                subtotal: null, taxAmount: null, total: 12500, notes: "Period: Apr-2026",
            };
        case "CREDIT_NOTE":
        case "DEBIT_NOTE":
            // Credit note → issued TO a customer; debit note → raised AGAINST a
            // supplier. The party box relabels via isSupplierPartyKind(DEBIT_NOTE).
            return {
                reference: kind === "CREDIT_NOTE" ? "CRN/26-27/0002" : "DRN/26-27/0002",
                date: today,
                partyName: kind === "CREDIT_NOTE" ? "Sample Customer" : "Acme Distributors",
                partyPhone: null,
                lines: cashLine, subtotal: null, taxAmount: null, total: 5000, notes: null,
            };
        case "GRN":
        case "CHALLAN":
            return {
                reference: kind === "GRN" ? "GRN/26-27/0019" : "DC/26-27/0011",
                date: today,
                partyName: kind === "GRN" ? "Acme Distributors" : "Sample Customer",
                partyPhone: null,
                lines: productLines, subtotal: null, taxAmount: null, total: null,
                notes: kind === "GRN" ? "Received against PO/26-27/0007" : "Delivered against SO/26-27/0005",
            };
        case "SALES_ORDER":
        case "PURCHASE_ORDER":
            return {
                reference: kind === "SALES_ORDER" ? "SO/26-27/0005" : "PO/26-27/0007",
                date: today,
                partyName: "Sample Party", partyPhone: null,
                lines: productLines, subtotal: 2694, taxAmount: 484.92, total: 3178.92,
                notes: "Expected delivery in 5 working days.",
                taxBreakdown: kind === "PURCHASE_ORDER" ? interBreakdown : intraBreakdown,
            };
        case "BRANCH_TRANSFER":
            return {
                reference: "BT/26-27/0006", date: today,
                partyName: "Branch — Online Warehouse", partyPhone: null,
                lines: productLines, subtotal: null, taxAmount: null, total: null,
                notes: "Stock moved from HQ → Online Warehouse",
            };
        case "MANUFACTURING_JOURNAL":
            return {
                reference: "MJ/26-27/0002", date: today,
                partyName: null, partyPhone: null,
                lines: [
                    { description: "Cable assembly (produced)", quantity: 50, amount: 0 },
                    { description: "Cat6 cable (consumed)",     quantity: 250, amount: 0 },
                    { description: "RJ45 connector (consumed)", quantity: 100, amount: 0 },
                ],
                subtotal: null, taxAmount: null, total: null, notes: null,
            };
        case "PHYSICAL_STOCK":
            return {
                reference: "PS/26-27/0001", date: today,
                partyName: null, partyPhone: null,
                lines: [{ description: "Counted opening stock", quantity: 1, amount: 0 }],
                subtotal: null, taxAmount: null, total: null,
                notes: "Counted on " + today,
            };
        case "REJECTION_IN":
        case "REJECTION_OUT":
            return {
                reference: kind === "REJECTION_IN" ? "RIN/26-27/0001" : "ROUT/26-27/0001",
                date: today,
                partyName: "Sample Party", partyPhone: null,
                lines: [productLines[0]], subtotal: null, taxAmount: null, total: null,
                notes: null,
            };
        case "POS_ESTIMATE":
        case "POS_ORDER":
            return {
                reference: kind === "POS_ORDER" ? "POSOD/26-27/0003" : "POSEV/26-27/0007",
                date: today,
                partyName: "Walk-in", partyPhone: null,
                lines: productLines,
                subtotal: 2694, taxAmount: 484.92, total: 3178.92,
                notes: kind === "POS_ORDER" ? "Counter order — deliver later." : "Quotation — valid 7 days.",
                taxBreakdown: intraBreakdown,
            };
        case "REPAIR_TICKET":
            // Repair-shop job slip — no ledger table; the "lines" stand in for the
            // device / problem body so the header + footer chrome can be previewed.
            return {
                reference: "TKT/0042", date: today,
                partyName: "Sample Customer", partyPhone: "+91 90000 00000",
                lines: [
                    { description: "Device: Apple iPhone 12", quantity: 1, amount: 0 },
                    { description: "Problem: Screen not turning on", quantity: 1, amount: 0 },
                ],
                subtotal: null, taxAmount: null, total: null,
                notes: "Estimated ₹ 2,500 — subject to diagnosis.",
            };
        case "SHIPPING_SLIP":
            return {
                reference: "TKT/0042", date: today,
                partyName: "ABC Service Centre", partyPhone: null,
                lines: [
                    { description: "Device: Apple iPhone 12", quantity: 1, amount: 0 },
                    { description: "Accessories: charger, cover", quantity: 1, amount: 0 },
                ],
                subtotal: null, taxAmount: null, total: null,
                // No chrome "Notes" line on the slip — the real route sends null too.
                notes: null,
            };
        case "SERVICE_SHIPPING_LABEL":
            return {
                reference: "TKT/0042", date: today,
                partyName: "ABC Service Centre", partyPhone: "90000 00000",
                lines: [],
                subtotal: null, taxAmount: null, total: null,
                notes: null,
            };
        case "DELIVERY_SHIPPING_LABEL":
            // Parcel label for an order shipped by our own couriers.
            return {
                reference: "WEB-27", date: today,
                partyName: "Sample Customer", partyPhone: "90000 00000",
                lines: [],
                subtotal: null, taxAmount: null, total: 980.86,
                notes: null,
            };
        case "COUPON":
        case "GIFT_CARD":
            // Cards render their own face (SAMPLE_COUPON_CARD / SAMPLE_GIFT_CARD);
            // the receipt sample is only here to satisfy the registry.
            return {
                reference: kind === "COUPON" ? "FEST10" : "GC-7F3K-92QA", date: today,
                partyName: null, partyPhone: null,
                lines: [],
                subtotal: null, taxAmount: null, total: null,
                notes: null,
            };
        case "SHIFT_CLOSE":
            // Shift close renders its bespoke ShiftCloseBody fixture (SAMPLE_SHIFT_CLOSE).
            return {
                reference: "Shift #12", date: today,
                partyName: "Wasim Akram (Counter 1)", partyPhone: null,
                lines: [],
                subtotal: null, taxAmount: null, total: null,
                notes: null,
            };
        case "PAYSLIP":
            // The slip renders its bespoke PayslipBody fixture (SAMPLE_PAYSLIP).
            return {
                reference: SAMPLE_PAYSLIP.slipNo, date: SAMPLE_PAYSLIP.postingDate,
                partyName: SAMPLE_PAYSLIP.staffName, partyPhone: null,
                lines: [],
                subtotal: null, taxAmount: null, total: null,
                notes: null,
            };
    }
}

export const VOUCHER_KIND_LABEL: Record<VoucherTemplateKind, string> = {
    CONTRA: "Contra",
    BANK_DEPOSIT: "Bank Deposit",
    CASH_HANDOVER: "Cash Handover",
    PAYMENT: "Payment",
    RECEIPT: "Receipt",
    CREDIT_NOTE: "Credit Note",
    DEBIT_NOTE: "Debit Note",
    JOURNAL: "Journal",
    PURCHASE: "Purchase",
    SALE: "Sale",
    POS: "POS",
    ONLINE_INVOICE: "Online Invoice",
    ESTIMATE: "Estimate",
    POS_ESTIMATE: "POS Estimate",
    POS_ORDER: "POS Order",
    SALE_RETURN: "Sale Return",
    PURCHASE_RETURN: "Purchase Return",
    MANUFACTURING_JOURNAL: "Manufacturing Journal",
    PHYSICAL_STOCK: "Physical Stock",
    BRANCH_TRANSFER: "Branch Transfer",
    GRN: "GRN",
    CHALLAN: "Delivery Challan",
    REJECTION_IN: "Rejection In",
    REJECTION_OUT: "Rejection Out",
    SALES_ORDER: "Sales Order",
    PURCHASE_ORDER: "Purchase Order",
    REPAIR_TICKET: "Repair Ticket",
    SHIPPING_SLIP: "Service Slip",
    SERVICE_SHIPPING_LABEL: "Service Shipping Label",
    DELIVERY_SHIPPING_LABEL: "Parcel Shipping Label",
    COUPON: "Coupon Card",
    GIFT_CARD: "Gift Card",
    SHIFT_CLOSE: "Shift Close",
    PAYSLIP: "Salary Slip",
};
