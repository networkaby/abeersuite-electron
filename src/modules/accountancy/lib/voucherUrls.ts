// Single source of truth for voucher edit / detail URLs across all three
// sources (inventory · GL · JE). Every register, the Day Book, and the
// per-row action menus import from here so a URL fix lands in one place.
//
// The `editFormUrl` helper for inventory is imported from the pure
// `src/modules/inventory/lib/voucherFormUrls.ts` module (NOT the "use client"
// VoucherActionsMenu) so this file stays server-safe — it runs inside the
// account-ledger report route. GL gets its own map here. JE is a single
// canonical path.

import { editFormUrl } from "@/modules/inventory/lib/voucherFormUrls";

export type VoucherSource = "inv" | "gl" | "je";

/** Base path for each GL voucher kind's `[id]` edit page. */
export const GL_EDIT_BASE: Record<string, string> = {
    PAYMENT:     "/vouchers/payments",
    RECEIPT:     "/vouchers/receipts",
    CONTRA:      "/vouchers/contras",
    CREDIT_NOTE: "/vouchers/credit-notes",
    DEBIT_NOTE:  "/vouchers/debit-notes",
};

/**
 * Classify a UniversalVoucher's `type` string into its CombinedRow source
 * bucket — mirrors the split useCombinedVouchers fetches separately (inv/gl/je).
 * JOURNAL is its own source; anything with a GL edit page is "gl"; everything
 * else (SALE/PURCHASE/POS/ESTIMATE/ORDER/…) is "inv".
 */
export function voucherSourceForType(type: string): VoucherSource {
    if (type === "JOURNAL") return "je";
    if (GL_EDIT_BASE[type]) return "gl";
    return "inv";
}

/** URL to open a voucher in its edit form (prefilled with its data). */
export function referenceHref(
    source: VoucherSource,
    rawId: number,
    kind: string,
): string | null {
    switch (source) {
        case "inv": return editFormUrl(kind, rawId);
        case "gl":  return GL_EDIT_BASE[kind] ? `${GL_EDIT_BASE[kind]}/${rawId}` : null;
        case "je":  return `/vouchers/journal-entries/${rawId}`;
    }
}

/** Print variants offered by the register 3-dot menu. */
export type ReceiptVariant = "thermal" | "pdf72" | "pdfA4";

/**
 * URL to open a voucher's printable receipt.
 *
 * `thermal` routes POS sales and GL receipts/payments to their dedicated relay
 * pages (real thermal-bridge print, untouched); every other kind — and both PDF
 * variants — go through the generic template-driven `/receipt/voucher` route.
 * `pdf72` renders a 72mm-wide slip; `pdfA4` a full A4 page. Both auto-open the
 * browser print dialog, where the user can pick a printer or "Save as PDF".
 */
export function receiptHref(
    source: VoucherSource,
    rawId: number,
    kind: string,
    variant: ReceiptVariant,
): string {
    if (variant === "thermal") {
        // POS + ONLINE_INVOICE share the rich customer-receipt page (ladder,
        // per-kind template) — ONLINE_INVOICE is the parcel-insert print.
        if (source === "inv" && (kind === "POS" || kind === "ONLINE_INVOICE")) return `/receipt/invoice/${rawId}?kind=${kind}`;
        if (source === "gl" && (kind === "RECEIPT" || kind === "PAYMENT")) return `/receipt/payment/${rawId}`;
        return `/receipt/voucher/${source}/${rawId}?paper=THERMAL_80MM`;
    }
    if (variant === "pdf72") return `/receipt/voucher/${source}/${rawId}?paper=THERMAL_80MM&width=72`;
    return `/receipt/voucher/${source}/${rawId}?paper=A4`;
}

/**
 * Print page for any voucher, opened by the forms' "Print after save" toggle.
 * Driven by the per-kind "Thermal" toggle:
 *   • thermal → `?mode=thermal` — the page auto-fires to the thermal printer like
 *     POS (tries the local relay, falls back to an auto browser print of the 80mm
 *     slip).
 *   • browser (default) → `?autoprint=0` — the traditional, format-selectable
 *     browser print page; the customer's paper size (set per kind on the
 *     voucher-templates page) applies and nothing fires until the user prints.
 */
export function voucherPrintPageHref(
    source: VoucherSource,
    rawId: number,
    opts?: { thermal?: boolean },
): string {
    return opts?.thermal
        ? `/receipt/voucher/${source}/${rawId}?mode=thermal`
        : `/receipt/voucher/${source}/${rawId}?autoprint=0`;
}

/** Base path for the per-source `/api/.../[id]` route. */
export function apiBase(source: VoucherSource, rawId: number): string {
    switch (source) {
        case "inv": return `/api/inventory/vouchers/${rawId}`;
        case "gl":  return `/api/accountancy/vouchers/${rawId}`;
        case "je":  return `/api/accountancy/journal-entries/${rawId}`;
    }
}
