// The inventory-in-flight settlement matrix — the one definition of which pending
// voucher types exist and which posted voucher settles each of them. Shared by the
// pending-vouchers and pending-stock reports so they can never disagree on what
// counts as "still open".
//
// Settlement rules (per voucher taxonomy):
//   CHALLAN       → settled by SALE         or REJECTION_IN
//   GRN           → settled by PURCHASE     or REJECTION_OUT
//   REJECTION_IN  → settled by CHALLAN      or SALE_RETURN
//   REJECTION_OUT → settled by GRN          or PURCHASE_RETURN
// CREDIT_NOTE / DEBIT_NOTE (GL-only) do NOT count as settlement here.

import { InvVoucherType, VoucherStatus, type Prisma } from "@/generated/prisma/client";

export type PendingType = "CHALLAN" | "GRN" | "REJECTION_IN" | "REJECTION_OUT";

export const SETTLES_BY: Record<PendingType, InvVoucherType[]> = {
    CHALLAN:       [InvVoucherType.SALE,     InvVoucherType.REJECTION_IN],
    GRN:           [InvVoucherType.PURCHASE, InvVoucherType.REJECTION_OUT],
    REJECTION_IN:  [InvVoucherType.CHALLAN,  InvVoucherType.SALE_RETURN],
    REJECTION_OUT: [InvVoucherType.GRN,      InvVoucherType.PURCHASE_RETURN],
};

export const PENDING_TYPES = Object.keys(SETTLES_BY) as PendingType[];

/** Pending types that move stock OUT of the warehouse. */
export const OUT_TYPES = new Set<PendingType>(["CHALLAN", "REJECTION_OUT"]);

/** Per-type "where" clause: this voucher type, with no active settling voucher. */
export function unsettledClause(type: PendingType): Prisma.VoucherDetailWhereInput {
    return {
        // 5D-11: type lives on the spine (both for this voucher and its returns).
        universalVoucher: { type: InvVoucherType[type] },
        refReturns: {
            none: {
                // 5D-8 status + 5D-11 type of the settling voucher live on its spine.
                universalVoucher: { status: { not: VoucherStatus.CANCELLED }, type: { in: SETTLES_BY[type] } },
            },
        },
    };
}
