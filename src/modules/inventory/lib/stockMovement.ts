// Shared writer for every stock movement (purchases, sales, transfers, returns,
// physical counts, manufacturing journal, POS sales/returns).
//
// One helper replaces the 9 voucher posters that each inlined the same three
// writes (InvStockLedger row + InvProduct.stock delta + InvProductBranch upsert).
// PR 3 dropped the costPaise/mrpPaise cache — cost now derives from the ledger
// walk in valuation.ts, so this helper no longer refreshes any cache columns.
// The `newMrpPaise` knob is kept so purchase posters can still stamp MRP onto
// the master from supplier paperwork (MRP isn't derived, it's printed on the box).

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
     * Pre-fetched InvProduct.stock value. When null the cache was uninitialized
     * and the helper overwrites with the absolute delta (Postgres NULL + n
     * silently no-ops). When undefined, plain { increment | decrement } — the
     * POS / cancel paths skip the pre-fetch.
     */
    productCurrentStock?: number | null;
    /** Default true. Set false for BRANCH_TRANSFER (org-wide cache unchanged). */
    updateOrgWideStock?:  boolean;
    /** Default true. Set false for routes that don't track per-branch balance. */
    updateBranchBalance?: boolean;
    /** When provided, overwrite InvProduct.mrpPaise (printed on the box, not derived). */
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

    // 2. Org-wide InvProduct cache (stock + optional MRP stamp).
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
        if (args.newMrpPaise != null) productData.mrpPaise = args.newMrpPaise;
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

/**
 * Batched form of recordStockMovement for multi-line posts (e.g. a POS sale with
 * N lines). Identical net effect to calling recordStockMovement once per line, but
 * the N ledger INSERTs collapse into a single createMany — cutting N-1 round-trips
 * inside the transaction (the dominant cost on a pooled connection). The per-product
 * balance updates stay individual (they target different rows). Keep this in lockstep
 * with recordStockMovement.
 */
export async function recordStockMovementsBatch(
    tx: Prisma.TransactionClient,
    items: RecordStockMovementArgs[],
): Promise<void> {
    if (items.length === 0) return;

    // 1. One INSERT for all ledger rows (was one per line).
    await tx.invStockLedger.createMany({
        data: items.map((a) => ({
            productId: a.productId,
            voucherId: a.voucherId,
            branchId:  a.branchId,
            date:      a.date,
            inQty:     a.inQty as never,
            outQty:    a.outQty as never,
            rate:      a.rate as never,
            amount:    a.amount as never,
        })),
    });

    // 2 + 3. Per-product org-wide cache + per-branch balance (same logic as the
    // single-row helper; different rows so they can't be a single statement).
    for (const a of items) {
        const delta = Math.round(toNumber(a.inQty)) - Math.round(toNumber(a.outQty));
        if (delta === 0 && a.newMrpPaise == null) continue;
        const updateOrgWide = a.updateOrgWideStock !== false;
        const updateBranch  = a.updateBranchBalance !== false;

        if (updateOrgWide) {
            const productData: Prisma.InvProductUpdateInput = {};
            if (delta !== 0) {
                productData.stock = a.productCurrentStock === null
                    ? delta
                    : delta > 0 ? { increment: delta } : { decrement: -delta };
            }
            if (a.newMrpPaise != null) productData.mrpPaise = a.newMrpPaise;
            if (Object.keys(productData).length > 0) {
                await tx.invProduct.update({ where: { id: a.productId }, data: productData });
            }
        }

        if (updateBranch && delta !== 0) {
            await tx.invProductBranch.upsert({
                where:  { productId_branchId: { productId: a.productId, branchId: a.branchId } },
                create: { productId: a.productId, branchId: a.branchId, stock: delta },
                update: { stock: delta > 0 ? { increment: delta } : { decrement: -delta } },
            });
        }
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
