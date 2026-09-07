import { InvVoucherType, type Prisma } from "@/generated/prisma/client";
import { nextRefFromSeries, resolveCounterNumber } from "@/modules/accountancy/lib/balance";
import { round2 } from "@/shared/lib/format";

// ── Reference number generation ───────────────────────────────────────────────

// Inventory-voucher types that have a configurable VoucherSeries row managed
// from /office/settings/year-ending (FY rollover, padding, separators, type code).
// Anything not listed here falls through to the legacy calendar-year scheme.
const SERIES_KINDS: Partial<Record<InvVoucherType, string>> = {
    SALE: "SALE",
    POS: "POS",
    PURCHASE: "PURCHASE",
    ESTIMATE: "ESTIMATE",
    // POS_ESTIMATE / POS_ORDER deliberately use the legacy PREFIX fallback below
    // (POSEV-/POSOD- calendar-year) so they need no seeded VoucherSeries row.
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

// Legacy prefixes for the fallback path — kept for any voucher types
// not promoted to the configurable VoucherSeries system.
const PREFIX: Record<InvVoucherType, string> = {
    PURCHASE: "PV",
    SALE: "SV",
    POS: "POS",
    ONLINE_INVOICE: "OI",
    ONLINE_ORDER: "OO",
    ESTIMATE: "EV",
    POS_ESTIMATE: "POSEV",
    POS_ORDER: "POSOD",
    SALE_RETURN: "SR",
    PURCHASE_RETURN: "PR",
    MANUFACTURING_JOURNAL: "MJ",
    PHYSICAL_STOCK: "PS",
    BRANCH_TRANSFER: "BT",
    GRN: "GRN",
    CHALLAN: "DC",
    REJECTION_IN: "RIN",
    REJECTION_OUT: "ROUT",
    SALES_ORDER: "SO",
    PURCHASE_ORDER: "PO",
};

/**
 * Generate sequential inventory voucher references.
 *
 * SALE / PURCHASE / ESTIMATE route through `nextRefFromSeries` so they pick
 * up the FY-aware convention managed at /office/settings/year-ending — same
 * formatting (FY_SHORT, padding, separators) the GL vouchers use.
 *
 * Other inventory voucher types not in SERIES_KINDS fall back to the legacy
 * calendar-year `${prefix}-YYYY-####` scheme.
 *
 * Must be called inside a prisma.$transaction to be safe against races.
 */
export async function invNextRef(
    tx: Prisma.TransactionClient,
    type: InvVoucherType,
    ctx?: import("@/modules/accountancy/lib/voucherRef").ReferenceContext,
): Promise<string> {
    const seriesKind = SERIES_KINDS[type];
    if (seriesKind) {
        return nextRefFromSeries(tx, seriesKind, ctx);
    }
    // Legacy fallback — calendar-year prefix scheme.
    const year = new Date().getFullYear();
    const prefix = PREFIX[type];
    // The SAME counter the series path numbers under — not a second derivation.
    // This used to default to 1 whenever the caller passed no context, which is every
    // POS_ESTIMATE and POS_ORDER (posQuoteVoucher.ts passes none): two tills each
    // counted the same `startsWith` on their own replica and both minted
    // `01-POSEV-2026-0001`. `resolveCounterNumber` falls back to this PC's own
    // counter-setup.json, so the prefix separates the machines the way it always
    // claimed to, and the office still numbers as 1.
    const counterNumber = resolveCounterNumber(ctx);
    const startsWith = `${String(counterNumber).padStart(2, "0")}-${prefix}-${year}-`;
    // count(+1) is not atomic under READ COMMITTED: two transactions counting the same
    // prefix at once both mint the same number. The prefix used to be per till, so only
    // one machine ever counted it; a v_live till relays this to the office, where every
    // till shares counter 1's prefix. One transaction-scoped advisory lock per prefix
    // serialises the count and the insert that follows it, and costs nothing otherwise.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${startsWith}))`;
    const count = await tx.voucherDetail.count({ where: { universalVoucher: { voucherNo: { startsWith } } } });   // 5D-6: ref on spine
    return `${startsWith}${String(count + 1).padStart(4, "0")}`;
}

// The voucher arithmetic moved to voucherMath.ts so client code can use it without
// pulling this file's server imports into the browser bundle. Re-exported here so
// server callers that already import from stock.ts keep working.
export { calcLineTotals, calcVoucherTotals, resolveShippingGstRate } from "./voucherMath";
export type { VoucherLineInput } from "./voucherMath";
