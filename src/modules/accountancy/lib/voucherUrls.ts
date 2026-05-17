// Single source of truth for voucher edit / detail URLs across all three
// sources (inventory · GL · JE). Every register, the Day Book, and the
// per-row action menus import from here so a URL fix lands in one place.
//
// The `editFormUrl` helper for inventory is re-exported from
// `src/modules/inventory/components/VoucherActionsMenu.tsx` (since it owns
// the inventory `EDIT_FORM_URLS` map). GL gets its own map here. JE is a
// single canonical path.

import { editFormUrl } from "@/modules/inventory/components/VoucherActionsMenu";

export type VoucherSource = "inv" | "gl" | "je";

/** Base path for each GL voucher kind's `[id]` edit page. */
export const GL_EDIT_BASE: Record<string, string> = {
    PAYMENT:     "/vouchers/payments",
    RECEIPT:     "/vouchers/receipts",
    CONTRA:      "/vouchers/contras",
    CREDIT_NOTE: "/vouchers/credit-notes",
    DEBIT_NOTE:  "/vouchers/debit-notes",
};

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

/** Base path for the per-source `/api/.../[id]` route. */
export function apiBase(source: VoucherSource, rawId: number): string {
    switch (source) {
        case "inv": return `/api/inventory/vouchers/${rawId}`;
        case "gl":  return `/api/accountancy/vouchers/${rawId}`;
        case "je":  return `/api/accountancy/journal-entries/${rawId}`;
    }
}
