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
export type ReceiptVariant = "thermal" | "pdf";

/**
 * URL to open a voucher's printable receipt — the two print ways:
 *
 *   • `thermal` → `?mode=thermal`: the page fires the bridge once on mount.
 *     The 3-dot menu no longer opens this (it prints silently through
 *     `printVoucherThermalSilently` and falls back to the `pdf` page on the
 *     80mm view); kept for links that want the page-based thermal way.
 *   • `pdf` → `?autoprint=0`: the format-selection page from the start. The
 *     user picks A4 / thermal and the printer in the browser dialog.
 *
 * POS sales keep their dedicated page (the price ladder); every other kind —
 * Receipt and Payment included — goes through the generic template-driven
 * `/receipt/voucher` route.
 */
export function receiptHref(
    source: VoucherSource,
    rawId: number,
    kind: string,
    variant: ReceiptVariant,
): string {
    const posLikeInvoice = source === "inv" && (kind === "POS" || kind === "ONLINE_INVOICE");

    if (posLikeInvoice) {
        const qs = variant === "thermal" ? `?kind=${kind}&mode=thermal` : `?kind=${kind}&autoprint=0`;
        return `/receipt/invoice/${rawId}${qs}`;
    }
    if (variant === "thermal") return `/receipt/voucher/${source}/${rawId}?mode=thermal`;
    return `/receipt/voucher/${source}/${rawId}?autoprint=0`;
}

/**
 * Print page for any voucher, opened by the forms' "Print after save" toggle.
 * Driven by the per-kind "Thermal" toggle:
 *   • thermal → `?mode=thermal` — silent thermal print through the bridge; no
 *     printer / bridge down → the format-selection page stays open instead.
 *   • browser (default) → `?autoprint=0` — the format-selection page; nothing
 *     fires until the user picks a format and prints.
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
