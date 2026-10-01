// Purchase-side twin of the margin engine's sale loader: every PURCHASE line
// in the period (PURCHASE_RETURN negated), pre-tax. Used by the supplier
// volume + purchase price variance reports.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { toNumber } from "@/modules/accountancy/lib/balance";

export const PURCHASE_TYPE = "PURCHASE";
export const PURCHASE_RETURN_TYPE = "PURCHASE_RETURN";

export interface PurchaseLine {
    productId: number;
    sku: string;
    productName: string;
    categoryName: string | null;
    /** Supplier ledger (Account) id — null when the voucher has no party. */
    accountId: number | null;
    voucherId: number;
    voucherNo: string | null;
    voucherType: string;
    date: Date;
    /** Billed qty (+ free). Negative on purchase returns. */
    qty: number;
    /** Pre-tax line value (amount − taxAmount). Negative on returns. */
    value: number;
    /** Per-unit buy rate as entered on the line (₹, pre-tax). */
    rate: number;
}

export async function loadPurchaseLines(q: {
    from: Date;
    to: Date;
    branchId?: string | null;
}): Promise<PurchaseLine[]> {
    const rawLines = await prisma.voucherInventoryLine.findMany({
        where: {
            universalVoucher: {
                type: { in: [PURCHASE_TYPE, PURCHASE_RETURN_TYPE] },
                status: "POSTED",
                date: { gte: q.from, lte: q.to },
                ...(q.branchId ? { branchId: q.branchId } : {}),
            },
        },
        select: {
            productId: true,
            quantity: true,
            freeQty: true,
            rate: true,
            taxAmount: true,
            amount: true,
            universalVoucher: {
                select: { id: true, type: true, date: true, partyAccountId: true, voucherNo: true },
            },
            product: {
                select: { sku: true, name: true, category: { select: { name: true } } },
            },
        },
    });

    return rawLines.map((l) => {
        const sign = l.universalVoucher.type === PURCHASE_RETURN_TYPE ? -1 : 1;
        return {
            productId: l.productId,
            sku: l.product.sku,
            productName: l.product.name,
            categoryName: l.product.category?.name ?? null,
            accountId: l.universalVoucher.partyAccountId,
            voucherId: l.universalVoucher.id,
            voucherNo: l.universalVoucher.voucherNo,
            voucherType: l.universalVoucher.type,
            date: l.universalVoucher.date,
            qty: (toNumber(l.quantity) + toNumber(l.freeQty ?? 0)) * sign,
            value: (toNumber(l.amount) - toNumber(l.taxAmount)) * sign,
            rate: toNumber(l.rate),
        };
    });
}
