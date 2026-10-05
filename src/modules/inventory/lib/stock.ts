import { InvVoucherType, type Prisma } from "@/generated/prisma/client";
import { nextRefFromSeries } from "@/modules/accountancy/lib/balance";

// ── Reference number generation ───────────────────────────────────────────────

// Inventory-voucher types and their VoucherSeries row, managed from
// /office/settings/year-ending (FY rollover, padding, separators, type code).
// Every type numbers from its series — one allocator, an atomic counter per till.
// A full Record: a new voucher type does not compile until it has a series.
export const SERIES_KINDS: Record<InvVoucherType, string> = {
    SALE: "SALE",
    POS: "POS",
    ONLINE_INVOICE: "ONLINE_INVOICE",
    ONLINE_ORDER: "ONLINE_ORDER",
    PURCHASE: "PURCHASE",
    ESTIMATE: "ESTIMATE",
    POS_ESTIMATE: "POS_ESTIMATE",
    POS_ORDER: "POS_ORDER",
    SALE_RETURN: "SALE_RETURN",
    PURCHASE_RETURN: "PURCHASE_RETURN",
    SALES_ORDER: "SALES_ORDER",
    PURCHASE_ORDER: "PURCHASE_ORDER",
    GRN: "GRN",
    CHALLAN: "CHALLAN",
    MANUFACTURING_JOURNAL: "MANUFACTURING_JOURNAL",
    PHYSICAL_STOCK: "PHYSICAL_STOCK",
    BRANCH_TRANSFER: "BRANCH_TRANSFER",
    REJECTION_IN: "REJECTION_IN",
    REJECTION_OUT: "REJECTION_OUT",
};

/**
 * Generate sequential inventory voucher references from the type's VoucherSeries
 * (`nextRefFromSeries`): the format set at /office/settings/year-ending, the
 * number from an atomic per-till counter. The old count(+1) scheme re-issued a
 * number whenever a voucher in the middle of the run was deleted.
 *
 * Must be called inside a prisma.$transaction to be safe against races.
 */
export async function invNextRef(
    tx: Prisma.TransactionClient,
    type: InvVoucherType,
    ctx?: import("@/modules/accountancy/lib/voucherRef").ReferenceContext,
): Promise<string> {
    return nextRefFromSeries(tx, SERIES_KINDS[type], ctx);
}

// The voucher arithmetic moved to voucherMath.ts so client code can use it without
// pulling this file's server imports into the browser bundle. Re-exported here so
// server callers that already import from stock.ts keep working.
export { calcLineTotals, calcVoucherTotals, resolveShippingGstRate, exactLineRate } from "./voucherMath";
export type { VoucherLineInput } from "./voucherMath";
