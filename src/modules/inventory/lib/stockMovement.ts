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

// ── Which way does a voucher type move stock? ────────────────────────────────
//
// ONE list, read by the posting path AND every reversal path. They used to be
// copied by hand into each route, and the copies drifted: post moved stock for
// SALE_RETURN / PURCHASE_RETURN / REJECTION_* / ONLINE_INVOICE while cancel only
// knew PURCHASE|GRN and SALE|POS|CHALLAN — so cancelling a POS return (a
// SALE_RETURN) reversed the GL and silently left the stock in.
//
//   IN       — goods arrive        (direction fixed by type)
//   OUT      — goods leave         (direction fixed by type)
//   BESPOKE  — direction is computed per line at post time (PHYSICAL_STOCK delta,
//              MANUFACTURING_JOURNAL line.direction, BRANCH_TRANSFER two-sided).
//              Reversal must MIRROR the written ledger rows, never re-derive.
//   NONE     — commitments / quotations; never move stock.
export type StockDirection = "IN" | "OUT" | "BESPOKE" | "NONE";

const STOCK_IN_TYPES      = ["PURCHASE", "GRN", "REJECTION_IN", "SALE_RETURN"];
const STOCK_OUT_TYPES     = ["SALE", "POS", "ONLINE_INVOICE", "CHALLAN", "REJECTION_OUT", "PURCHASE_RETURN"];
const STOCK_BESPOKE_TYPES = ["PHYSICAL_STOCK", "MANUFACTURING_JOURNAL", "BRANCH_TRANSFER"];

export function stockDirectionForType(type: string): StockDirection {
    if (STOCK_IN_TYPES.includes(type))      return "IN";
    if (STOCK_OUT_TYPES.includes(type))     return "OUT";
    if (STOCK_BESPOKE_TYPES.includes(type)) return "BESPOKE";
    return "NONE";
}

/**
 * Units a goods line actually moves = quantity + freeQty. Complimentary units
 * leave the shelf like any other, so every reversal must put them back too —
 * reversing `quantity` alone leaked the free units out of stock permanently.
 */
export function movedQty(line: { quantity: Numeric; freeQty?: Numeric | null }): number {
    return toNumber(line.quantity) + (line.freeQty != null ? toNumber(line.freeQty) : 0);
}

export interface RecordStockMovementArgs {
    // Phase 5 5C: stock rows hang off the spine — callers pass the universalVoucherId.
    universalVoucherId: number;
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
            universalVoucherId: args.universalVoucherId,
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
            universalVoucherId: a.universalVoucherId,
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
        universalVoucherId: number;
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
            universalVoucherId: ledgerRow.universalVoucherId,
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

// ── Recompute on-hand from truth (the ② safety net + edit oracle) ────────────
//
// Rebuilds the cached InvProduct.stock / InvProductBranch.stock for the given
// products straight from the source of truth, so callers (e.g. the in-place
// voucher edit) never hand-maintain the cache with fragile delta math — they
// mutate the ledger, then call this. Formula (validated catalogue-wide, zero
// drift — see scripts/recompute-stock.ts):
//   InvProduct.stock       = openingStock (Tally master column) + Σ(inQty − outQty)
//   InvProductBranch.stock = Σ(inQty − outQty) per branch
// `openingStock` is folded in exactly as GL folds Account.openingBalance into
// aggregateClosingAsOf — it is NOT a ledger row.
/**
 * Remove the counter-entries a CANCEL wrote for one voucher — the mirror of
 * `reverseStockMovement`, used when a cancelled voucher is restored. Returns the
 * product ids touched so the caller can `recomputeProductStock` them.
 *
 * Cancel appends EXACTLY ONE counter per original row, so the spine's ledger
 * holds 2N rows and the newest N are the reversal. Splitting by id beats testing
 * `amount < 0`: a free-issue line (zero rate) reverses to `amount` 0, which no
 * sign test can tell apart from its own original, and that row left behind would
 * silently hold the stock down after the restore.
 *
 * The halves are checked to mirror each other (in↔out swapped) before anything is
 * deleted; an unexpected trail throws rather than guessing, because a wrong guess
 * here corrupts stock quietly.
 */
export async function deleteCancelCounterRows(
    tx: Prisma.TransactionClient,
    universalVoucherId: number,
): Promise<number[]> {
    const rows = await tx.invStockLedger.findMany({
        where:   { universalVoucherId },
        orderBy: { id: "asc" },
        select:  { id: true, productId: true, branchId: true, inQty: true, outQty: true },
    });
    if (rows.length === 0) return [];
    if (rows.length % 2 !== 0) {
        throw new Error(`Stock trail for voucher ${universalVoucherId} has ${rows.length} rows — cannot tell the cancel reversal apart. Restore aborted.`);
    }

    const half = rows.length / 2;
    const originals = rows.slice(0, half);
    const counters = rows.slice(half);
    for (let i = 0; i < half; i++) {
        const o = originals[i];
        const c = counters[i];
        const mirrors = o.productId === c.productId
            && o.branchId === c.branchId
            && Math.round(toNumber(o.inQty)) === Math.round(toNumber(c.outQty))
            && Math.round(toNumber(o.outQty)) === Math.round(toNumber(c.inQty));
        if (!mirrors) {
            throw new Error(`Stock trail for voucher ${universalVoucherId} is not a clean cancel reversal. Restore aborted.`);
        }
    }

    await tx.invStockLedger.deleteMany({ where: { id: { in: counters.map((r) => r.id) } } });
    return [...new Set(rows.map((r) => r.productId))];
}

export async function recomputeProductStock(
    tx: Prisma.TransactionClient,
    productIds: number[],
): Promise<void> {
    const ids = [...new Set(productIds)];
    if (ids.length === 0) return;

    const [byProduct, byBranch, products] = await Promise.all([
        tx.invStockLedger.groupBy({ by: ["productId"], where: { productId: { in: ids } }, _sum: { inQty: true, outQty: true } }),
        tx.invStockLedger.groupBy({ by: ["productId", "branchId"], where: { productId: { in: ids } }, _sum: { inQty: true, outQty: true } }),
        tx.invProduct.findMany({ where: { id: { in: ids } }, select: { id: true, openingStock: true } }),
    ]);

    const ledgerByProduct = new Map<number, number>();
    for (const r of byProduct) ledgerByProduct.set(r.productId, toNumber(r._sum.inQty ?? 0) - toNumber(r._sum.outQty ?? 0));

    for (const p of products) {
        const stock = toNumber(p.openingStock ?? 0) + (ledgerByProduct.get(p.id) ?? 0);
        await tx.invProduct.update({ where: { id: p.id }, data: { stock } });
    }

    const rebuilt = new Set<string>();
    for (const r of byBranch) {
        const stock = toNumber(r._sum.inQty ?? 0) - toNumber(r._sum.outQty ?? 0);
        rebuilt.add(`${r.productId}|${r.branchId}`);
        await tx.invProductBranch.upsert({
            where:  { productId_branchId: { productId: r.productId, branchId: r.branchId } },
            create: { productId: r.productId, branchId: r.branchId, stock },
            update: { stock },
        });
    }

    // A product whose LAST ledger row in a branch just got deleted produces no
    // groupBy row at all — the loop above can never reach it, so without this the
    // stale balance survives. Truth for those rows is zero.
    const staleBranchRows = await tx.invProductBranch.findMany({
        where:  { productId: { in: ids } },
        select: { productId: true, branchId: true, stock: true },
    });
    for (const row of staleBranchRows) {
        if (rebuilt.has(`${row.productId}|${row.branchId}`)) continue;
        if (toNumber(row.stock ?? 0) === 0) continue;
        await tx.invProductBranch.update({
            where: { productId_branchId: { productId: row.productId, branchId: row.branchId } },
            data:  { stock: 0 },
        });
    }
}
