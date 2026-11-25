// A sale and its returns must not both undo the same goods: the return brings the item
// back, and a cancel (or delete) of the sale would bring it back again. Call these inside
// the save, after the voucher's own row is locked.

import type { Prisma } from "@/generated/prisma/client";
import { LifecycleError, lockVoucher } from "@/modules/accountancy/lib/voucherLifecycle";
import { overReturnedProduct, sumByProduct, type QtyLine } from "@/modules/accountancy/lib/returnQty";

const SALE_TYPES = ["SALE", "POS", "ONLINE_INVOICE"];

/** Quantity already returned against a sale, per product. */
export async function returnedQtyByProduct(db: Prisma.TransactionClient, originalId: number): Promise<Map<number, number>> {
    const returns = await db.voucherDetail.findMany({
        where:  { refVoucherId: originalId, universalVoucher: { status: "POSTED" } },
        select: { universalVoucherId: true },
    });
    const uvIds = returns.map((r) => r.universalVoucherId).filter((id): id is number => id != null);
    const lines = uvIds.length === 0 ? [] : await db.voucherInventoryLine.findMany({
        where:  { universalVoucherId: { in: uvIds } },
        select: { productId: true, quantity: true },
    });
    return sumByProduct(lines);
}

/** Refuse to cancel / delete a sale while a return of it is posted. */
export async function ensureNoPostedReturn(tx: Prisma.TransactionClient, saleDetailId: number, verb: "cancel" | "delete"): Promise<void> {
    const returns = await tx.voucherDetail.findMany({
        where:  { refVoucherId: saleDetailId, universalVoucher: { type: "SALE_RETURN", status: "POSTED" } },
        select: { id: true, universalVoucher: { select: { voucherNo: true } } },
    });
    if (returns.length === 0) return;
    const names = returns.map((r) => r.universalVoucher?.voucherNo ?? `#${r.id}`).join(", ");
    throw new LifecycleError(409, `This sale has a return (${names}). Cancel the return first, then ${verb} the sale.`);
}

/**
 * Refuse to put a return back on the books when its sale is not posted, or when it would
 * return more than was sold. A return with no sale behind it passes. Takes the sale's row.
 */
export async function ensureReturnFits(tx: Prisma.TransactionClient, saleDetailId: number | null, lines: QtyLine[]): Promise<void> {
    if (saleDetailId == null) return;
    const sale = await tx.voucherDetail.findUnique({
        where:  { id: saleDetailId },
        select: { universalVoucherId: true, universalVoucher: { select: { type: true, voucherNo: true } } },
    });
    if (sale?.universalVoucherId == null || !SALE_TYPES.includes(sale.universalVoucher?.type ?? "")) return;
    const saleNo = sale.universalVoucher?.voucherNo ?? `#${saleDetailId}`;
    const now = await lockVoucher(tx, sale.universalVoucherId);
    if (now?.status !== "POSTED") {
        throw new LifecycleError(409, `Its sale ${saleNo} is not posted. Restore the sale first.`);
    }
    const sold = await tx.voucherInventoryLine.findMany({
        where:  { universalVoucherId: sale.universalVoucherId },
        select: { productId: true, quantity: true },
    });
    if (overReturnedProduct(sold, await returnedQtyByProduct(tx, saleDetailId), lines) != null) {
        throw new LifecycleError(409, `Sale ${saleNo} would be returned more than it was sold — another return already covers it.`);
    }
}

/**
 * The sale a return from the Recycle Bin belongs to, as it stands now. A sale that was
 * deleted and put back has a fresh id, so it is found by its number. Null = it had none.
 * Still in the bin → refused: without the link the same goods could be returned again.
 */
export async function saleForRestoredReturn(tx: Prisma.TransactionClient, refVoucherId: unknown): Promise<number | null> {
    if (typeof refVoucherId !== "number") return null;
    const live = await tx.voucherDetail.findUnique({ where: { id: refVoucherId }, select: { id: true } });
    if (live) return live.id;
    const copy = await tx.auditLog.findFirst({
        where:   { entityType: "INV_VOUCHER", originalId: refVoucherId, subtype: { in: SALE_TYPES } },
        orderBy: { id: "desc" },
        select:  { originalRef: true, subtype: true },
    });
    if (!copy?.originalRef || !copy.subtype) return null;
    const back = await tx.voucherDetail.findFirst({
        where:  { universalVoucher: { voucherNo: copy.originalRef, type: copy.subtype } },
        select: { id: true },
    });
    if (!back) throw new LifecycleError(409, `Its sale ${copy.originalRef} is in the Recycle Bin. Restore the sale first.`);
    return back.id;
}
