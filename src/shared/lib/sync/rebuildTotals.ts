/**
 * Rebuild the cloud's running totals after a counter's ledger rows land there.
 *
 * `InvProduct.stock` / `InvProductBranch.stock` and `GiftCard.balance` are caches kept by increments. They do not travel between
 * machines (see `cacheColumns` in scripts/gen-sync-registry.ts): a counter's sale
 * ships its stock rows and gift-card txns, and THIS module makes Supabase
 * re-sum the totals those rows belong to. The counter's own copy is rebuilt the same
 * way by the sync engine after a pull (sync-engine/lib/rebuildTotals.js).
 *
 * Why not push the total: two machines that each add to the same total from the
 * value they last pulled overwrite each other under last-write-wins, and the loser's
 * increments are gone with no error. Summing the ledger on the receiving side has no
 * loser.
 *
 * ── A failed rebuild is retried, never dropped ──────────────────────────────
 * The outbox rows are marked pushed before this runs: the ledger IS in the cloud, so
 * re-pushing would be wrong. If the rebuild itself fails (a connection blip right
 * after the push), the ids are kept and rebuilt on the next flush, so the drift lasts
 * one flush and not until the next unrelated sale touches the same product.
 */

import { prismaLive } from "@/shared/lib/prisma/prismaClient";
import type { Prisma } from "@/generated/prisma/client";
import { recomputeProductStock } from "@/modules/inventory/lib/stockMovement";
import { recomputeGiftCardBalances } from "@/modules/coupons/lib/giftCard";

/** Which totals a pushed row can move, keyed by physical table name. */
export interface TotalTouches {
    productIds: Set<number>;
    giftCardIds: Set<number>;
}

export function emptyTouches(): TotalTouches {
    return { productIds: new Set(), giftCardIds: new Set() };
}

function asInt(v: unknown): number | null {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    return Number.isInteger(n) ? n : null;
}

/**
 * Note what a pushed row can move. Cheap: a few property reads per row, and the
 * overwhelming majority of tables touch nothing.
 */
export function noteTouches(touches: TotalTouches, model: string, payload: Record<string, unknown>): void {
    switch (model) {
        case "InvStockLedger": {
            const id = asInt(payload.productId);
            if (id != null) touches.productIds.add(id);
            break;
        }
        case "GiftCardTxn": {
            const id = asInt(payload.giftCardId);
            if (id != null) touches.giftCardIds.add(id);
            break;
        }
        default:
            break;
    }
}

/** Ids whose rebuild failed last time; folded into the next run. */
const carried: TotalTouches = emptyTouches();

function merge(into: TotalTouches, from: TotalTouches): void {
    for (const id of from.productIds) into.productIds.add(id);
    for (const id of from.giftCardIds) into.giftCardIds.add(id);
}

function clear(t: TotalTouches): void {
    t.productIds.clear();
    t.giftCardIds.clear();
}

/**
 * Re-sum the touched totals on Supabase. Never throws: the push already succeeded,
 * and a failure here is retried on the next flush.
 */
export async function rebuildTotalsAfterPush(touches: TotalTouches): Promise<void> {
    merge(touches, carried);
    clear(carried);

    const nothing = touches.productIds.size === 0 && touches.giftCardIds.size === 0;
    if (nothing) return;

    // `recompute*` take a transaction client; the live client has the same surface
    // for the reads and single-row writes they make, and one short transaction per
    // flush keeps the two rebuilds atomic with each other.
    try {
        await prismaLive.$transaction(async (tx) => {
            await recomputeProductStock(tx as Prisma.TransactionClient, [...touches.productIds]);
            await recomputeGiftCardBalances(tx, [...touches.giftCardIds]);
        }, { timeout: 30_000 });
    } catch (err) {
        merge(carried, touches);
        console.warn(
            `[SyncPush] rebuilding cloud totals failed (` +
            `products=${touches.productIds.size}, giftCards=${touches.giftCardIds.size}); ` +
            `will retry on the next flush:`,
            err instanceof Error ? err.message : err,
        );
    }
}
