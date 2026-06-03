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
        case "POS":
        case "SALE":
            // Demonstrates the customer-facing "Today's discount" price ladder:
            // per-line MRP/barcode + pooled discount + savings hero + HSN summary.
            return {
                reference: kind === "POS" ? "POS/26-27/0042" : "SV/26-27/0017",
                date: today,
                partyName: kind === "SALE" ? "Acme Traders" : "Walk-in", partyPhone: null,
                partyGstin: kind === "SALE" ? "18ABCDE1234F1Z5" : null,
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
};
