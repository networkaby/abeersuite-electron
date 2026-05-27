// Shared writer for every stock movement (purchases, sales, transfers, returns,
// physical counts, manufacturing journal, POS sales/returns).
//
// One helper replaces the 9 voucher posters that each inlined the same three
// writes (InvStockLedger row + InvProduct.stock null-aware delta + InvProductBranch
// upsert) with subtly different rules for the costPaise/mrpPaise cache. PR 1
// of the noble-boole plan preserves today's behavior bit-identically — the
// `newCostPaise` / `newMrpPaise` knobs let each caller opt into the same
// cache-refresh logic they had inline. PR 3 will drop the cache entirely and
// remove those knobs.

import type { Prisma } from "@/generated/prisma/client";
import { toNumber } from "@/modules/accountancy/lib/balance";

type Numeric = number | string | { toString(): string };

export interface RecordStockMovementArgs {
    voucherId: number;
    productId: number;
    branchId:  string;
    date:      Date;
    inQty:     Numeric;
    outQty:    Numeric;
    rate:      Numeric;
    amount:    Numeric;
    /**
     * Pre-fetched InvProduct.stock value:
     *   • number   → use plain { increment | decrement }
     *   • null     → cache was uninitialized; overwrite with absolute delta
     *                (Postgres NULL + n = NULL would otherwise silently no-op)
     *   • undefined → skip null-detection, plain { increment | decrement }
     *                 (matches POS sale / cancel paths that don't pre-fetch)
     */
    productCurrentStock?: number | null;
    /** Default true. Set false for BRANCH_TRANSFER (org-wide cache unchanged). */
    updateOrgWideStock?:  boolean;
    /** Default true. Set false for routes that don't track per-branch balance. */
    updateBranchBalance?: boolean;
    /** When provided, overwrite InvProduct.costPaise on the cache-refresh update. */
    newCostPaise?: number;
    /** When provided, overwrite InvProduct.mrpPaise on the cache-refresh update. */
    newMrpPaise?:  number;
}

export async function recordStockMovement(
    tx: Prisma.TransactionClient,
    args: RecordStockMovementArgs,
): Promise<void> {
    const inN  = toNumber(args.inQty);
    const outN = toNumber(args.outQty);

    await tx.invStockLedger.create({
        data: {
            productId: args.productId,
            voucherId: args.voucherId,
            branchId:  args.branchId,
            date:      args.date,
            inQty:     args.inQty as never,
            outQty:    args.outQty as never,
            rate:      args.rate as never,
            amount:    args.amount as never,
        },
    });

    const delta = Math.round(inN) - Math.round(outN);
    const updateOrgWide  = args.updateOrgWideStock  !== false;
    const updateBranch   = args.updateBranchBalance !== false;

    // 2. Org-wide InvProduct cache (stock + optional cost/mrp refresh).
    if (updateOrgWide) {
        const productData: Prisma.InvProductUpdateInput = {};
        if (delta !== 0) {
            if (args.productCurrentStock === null) {
                // Cache uninitialized — absolute value, not delta.
                productData.stock = delta;
            } else {
                productData.stock = delta > 0
                    ? { increment: delta }
                    : { decrement: -delta };
            }
        }
        if (args.newCostPaise != null) productData.costPaise = args.newCostPaise;
        if (args.newMrpPaise  != null) productData.mrpPaise  = args.newMrpPaise;
        if (Object.keys(productData).length > 0) {
            await tx.invProduct.update({
                where: { id: args.productId },
                data:  productData,
            });
        }
    }

    // 3. Per-branch balance.
    if (updateBranch && delta !== 0) {
        await tx.invProductBranch.upsert({
            where:  { productId_branchId: { productId: args.productId, branchId: args.branchId } },
            create: { productId: args.productId, branchId: args.branchId, stock: delta },
            update: { stock: delta > 0 ? { increment: delta } : { decrement: -delta } },
        });
    }
}

export interface ReverseStockMovementArgs {
    /** Original ledger row being reversed. */
    ledgerRow: {
        productId: number;
        branchId:  string;
        voucherId: number;
        inQty:     Numeric;
        outQty:    Numeric;
        rate:      Numeric;
        amount:    Numeric;
    };
    /** Date to stamp on the counter-entry. */
    reversalDate: Date;
    /** Default true. Set false to skip org-wide InvProduct.stock reversal. */
    updateOrgWideStock?: boolean;
}

/**
 * Writes a counter-entry that nets out the original row (in↔out swapped,
 * amount sign flipped) and applies the inverse delta to InvProduct.stock and
 * InvProductBranch.stock using plain increment/decrement (no null-aware logic
 * — matches today's cancel/delete behavior).
 */
export async function reverseStockMovement(
    tx: Prisma.TransactionClient,
    { ledgerRow, reversalDate, updateOrgWideStock = true }: ReverseStockMovementArgs,
): Promise<void> {
    const inN  = toNumber(ledgerRow.inQty);
    const outN = toNumber(ledgerRow.outQty);

    await tx.invStockLedger.create({
        data: {
            productId: ledgerRow.productId,
            voucherId: ledgerRow.voucherId,
            branchId:  ledgerRow.branchId,
            date:      reversalDate,
            inQty:     outN as never,
            outQty:    inN as never,
            rate:      ledgerRow.rate as never,
            amount:    -toNumber(ledgerRow.amount) as never,
        },
    });

    const originalDelta = Math.round(inN - outN);
    if (originalDelta === 0) return;
    const reverseDelta = -originalDelta;
    const branchUpdate = reverseDelta > 0
        ? { increment: reverseDelta }
        : { decrement: -reverseDelta };

    await tx.invProductBranch.upsert({
        where:  { productId_branchId: { productId: ledgerRow.productId, branchId: ledgerRow.branchId } },
        create: { productId: ledgerRow.productId, branchId: ledgerRow.branchId, stock: reverseDelta },
        update: { stock: branchUpdate },
    });

    if (updateOrgWideStock) {
        await tx.invProduct.update({
            where: { id: ledgerRow.productId },
            data:  { stock: branchUpdate },
        });
    }
}
