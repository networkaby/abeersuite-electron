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
    from:     { name: "Network Service", address: "Main Road\nBongaigaon, Assam", phone: "88769 96969" },
    to:       { name: "ABC Service Centre", address: "Zone Road, Ward 5\nBongaigaon, Assam, 783380", phone: "90000 00000" },
    ticketNo: "#0042",
    date:     "18 Jul 2026",
    ref:      "RMA-2291",
    device:   "Dell XPS 13 (Laptop)",
    footer:   "Handle with care · Fragile electronics",
};

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
            return {
                reference: "SV/26-27/0017", date: today,
                partyName: "Acme Traders", partyPhone: null,
                partyGstin: "18ABCDE1234F1Z5",
                lines: productLines,
                subtotal: 2694, taxAmount: 484.92, total: 3178.92,
                notes: null,
                taxBreakdown: intraBreakdown,
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
                    savingsTotal: 1135,
                    savingsPct: 33,
                },
                hsnSummary: [
                    { hsn: "8471", ratePct: 18, taxable: 1919.49, cgst: 172.76, sgst: 172.75, total: 2265 },
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
            return {
                reference: kind === "RECEIPT" ? "RV/26-27/0091" : "PV/26-27/0073",
                date: today,
                partyName: kind === "RECEIPT" ? "Walk-in" : "Acme Distributors",
                partyPhone: null,
                lines: cashLine, subtotal: null, taxAmount: null, total: 5000,
                notes: kind === "RECEIPT" ? "Against bill #SV/26-27/0017" : null,
            };
        case "CONTRA":
            return {
                reference: "CV/26-27/0004", date: today,
                partyName: null, partyPhone: null,
                lines: [{ description: "Cash → Bank transfer", quantity: 1, amount: 50000 }],
                subtotal: null, taxAmount: null, total: 50000, notes: null,
            };
        case "JOURNAL":
            return {
                reference: "JV/26-27/0012", date: today,
                partyName: null, partyPhone: null,
                lines: [{ description: "Depreciation entry", quantity: 1, amount: 12500 }],
                subtotal: null, taxAmount: null, total: 12500, notes: "Period: Apr-2026",
            };
        case "CREDIT_NOTE":
        case "DEBIT_NOTE":
            return {
                reference: kind === "CREDIT_NOTE" ? "CRN/26-27/0002" : "DRN/26-27/0002",
                date: today,
                partyName: "Sample Party", partyPhone: null,
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
    }
}

export const VOUCHER_KIND_LABEL: Record<VoucherTemplateKind, string> = {
    CONTRA: "Contra",
    PAYMENT: "Payment",
    RECEIPT: "Receipt",
    CREDIT_NOTE: "Credit Note",
    DEBIT_NOTE: "Debit Note",
    JOURNAL: "Journal",
    PURCHASE: "Purchase",
    SALE: "Sale",
    POS: "POS",
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
};
