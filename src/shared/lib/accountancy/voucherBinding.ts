// Phase 5 5D-9 — voucher bindingness (UniversalVoucher.binding).
//
// REGULAR = a real transaction that posts GL and/or moves stock (sale,
// purchase, payment, receipt, journal, returns, …). OPTIONAL = a non-binding
// paper document with NO GL and NO stock impact (estimate, order, quote) whose
// status is a free document lifecycle the operator can flip.
//
// This is the single source of truth for "is this voucher binding?". It
// replaces the hardcoded type-lists that used to be scattered across routes
// (e.g. the status-toggle route's TOGGLEABLE set): `type` stays purely
// descriptive (what the document is called), while `binding` carries how it
// behaves. Derived from `type` at spine creation.

import type { VoucherBinding } from "@/generated/prisma/client";

/** Voucher types that are non-binding documents (no GL, no stock). */
export const OPTIONAL_VOUCHER_TYPES = new Set<string>([
    "POS_ESTIMATE",
    "POS_ORDER",
    "ONLINE_ORDER",
    "ESTIMATE",
    "SALES_ORDER",
    "PURCHASE_ORDER",
]);

/** The binding for a voucher of the given type. */
export function bindingForType(type: string): VoucherBinding {
    return OPTIONAL_VOUCHER_TYPES.has(type) ? "OPTIONAL" : "REGULAR";
}
