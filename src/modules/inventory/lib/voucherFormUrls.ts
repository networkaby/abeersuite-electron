// Pure voucher URL-builder maps + helpers. NO "use client" — these are plain
// string functions with zero React/runtime deps, so both server code (e.g. the
// account-ledger report route, via accountancy/lib/voucherUrls) and client
// components (VoucherActionsMenu, registers, tables) can import them.
//
// VoucherActionsMenu.tsx re-exports VOUCHER_URLS / voucherUrl / editFormUrl
// from here for backward compatibility with existing client importers.

// Single source of truth for "where does this voucher type's read-only detail
// page live". Used by Duplicate (which lands on the detail of a fresh draft)
// and by any consumer that wants to link to a voucher elsewhere.
// Read-only voucher detail base paths. SALE / PURCHASE / SALE_RETURN /
// PURCHASE_RETURN are intentionally absent — they no longer have a
// read-only detail page (deleted 2026-05-23). All four are always opened
// in the editable form via EDIT_FORM_URLS below; voucherUrl() returns
// null for them, which surfaces as "no edit page" toast if any caller
// asks for the legacy detail URL.
export const VOUCHER_URLS: Record<string, string> = {
    POS:             "/vouchers/pos",
    ESTIMATE:        "/vouchers/estimates",
    POS_ESTIMATE:    "/vouchers/pos-estimates",
    POS_ORDER:       "/vouchers/pos-orders",
    SALES_ORDER:     "/vouchers/sales-orders",
    PURCHASE_ORDER:  "/vouchers/purchase-orders",
    GRN:             "/vouchers/grn",
    CHALLAN:         "/vouchers/challans",
    REJECTION_IN:    "/vouchers/rejections-in",
    REJECTION_OUT:   "/vouchers/rejections-out",
    PHYSICAL_STOCK:  "/vouchers/physical-stock",
    MANUFACTURING_JOURNAL: "/vouchers/manufacturing-journals",
    BRANCH_TRANSFER: "/vouchers/branch-transfers",
};

export function voucherUrl(type: string, id: number): string | null {
    const base = VOUCHER_URLS[type];
    return base ? `${base}/${id}` : null;
}

// Trading types have full-page EDITABLE forms. Edit drills here with
// `?voucherId=` so the form prefills + PATCHes on save. The other voucher
// types still use the read-only detail page (no editable equivalent yet —
// Edit falls back to VOUCHER_URLS for them).
// NOTE: SALE/PURCHASE/etc. live under the (gl) route-group which is URL-
// transparent, so the actual paths use the plural directory names.
export const EDIT_FORM_URLS: Record<string, string> = {
    SALE:            "/vouchers/sales/new",
    // POS sales edit through the SALES form — POS is a sale flavour, same
    // party / lines / tax / totals shape; the POS register at /vouchers/pos
    // is for *ringing up* new counter sales, not editing existing ones.
    POS:             "/vouchers/sales/new",
    PURCHASE:        "/vouchers/purchases/new",
    SALE_RETURN:     "/vouchers/sale-returns/new",
    PURCHASE_RETURN: "/vouchers/purchase-returns/new",
    ESTIMATE:        "/vouchers/estimates/new",
    // POS Estimate edits in the POS estimate screen — the same screen it was created
    // in (GL-silent quote). editFormUrl appends ?voucherId=, which the page reads.
    POS_ESTIMATE:    "/vouchers/pos/estimate",
    // Orders (counter POS_ORDER + office SALES_ORDER) edit in the POS order screen —
    // it covers the full discount surface the office form lacks. editFormUrl appends
    // ?voucherId=, which the page reads to hydrate + PATCH (New / Under-Review only).
    POS_ORDER:       "/vouchers/pos/order",
    SALES_ORDER:     "/vouchers/pos/order",
    PURCHASE_ORDER:  "/vouchers/purchase-orders/new",
    GRN:             "/vouchers/grn/new",
    CHALLAN:         "/vouchers/challans/new",
    REJECTION_IN:    "/vouchers/rejections-in/new",
    REJECTION_OUT:   "/vouchers/rejections-out/new",
    PHYSICAL_STOCK:        "/vouchers/physical-stock/new",
    MANUFACTURING_JOURNAL: "/vouchers/manufacturing-journals/new",
    BRANCH_TRANSFER:       "/vouchers/branch-transfers/new",
};

export function editFormUrl(type: string, id: number): string | null {
    const base = EDIT_FORM_URLS[type];
    if (base) return `${base}?voucherId=${id}`;
    return voucherUrl(type, id);
}
