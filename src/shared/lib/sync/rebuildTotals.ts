/**
 * Rebuild the cloud's running totals after a counter's ledger rows land there.
 *
 * `Account.balance`, `InvProduct.stock` / `InvProductBranch.stock` and
 * `GiftCard.balance` are caches kept by increments. They do not travel between
 * machines (see `cacheColumns` in scripts/gen-sync-registry.ts): a counter's sale
 * ships its GL lines, stock rows and gift-card txns, and THIS module makes Supabase
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
 * one flush and not until the next unrelated sale touches the same account.
 */

import { prismaLive } from "@/shared/lib/prisma/prismaClient";
import type { Prisma } from "@/generated/prisma/client";
import { recomputeAccountBalances } from "@/modules/accountancy/lib/aggregateLedger";
import { recomputeProductStock } from "@/modules/inventory/lib/stockMovement";
import { recomputeGiftCardBalances } from "@/modules/coupons/lib/giftCard";

/** Which totals a pushed row can move, keyed by physical table name. */
export interface TotalTouches {
    accountIds: Set<number>;
    productIds: Set<number>;
    giftCardIds: Set<number>;
    /** Vouchers whose status may have changed — their GL lines' accounts re-sum. */
    voucherIds: Set<number>;
}

export function emptyTouches(): TotalTouches {
    return { accountIds: new Set(), productIds: new Set(), giftCardIds: new Set(), voucherIds: new Set() };
}

function asInt(v: unknown): number | null {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    return Number.isInteger(n) ? n : null;
}

/**
 * Note what a pushed row can move. Cheap: a few property reads per row, and the
 * overwhelming majority of tables touch nothing.
 *
 * `UniversalVoucher` is here because `Account.balance` counts POSTED, non-deleted
 * vouchers only (`ledgerStatusFilterUv`): a cancel changes the sum without writing a
 * single GL line, so the voucher's accounts must re-sum too.
 */
export function noteTouches(touches: TotalTouches, model: string, payload: Record<string, unknown>): void {
    switch (model) {
        case "VoucherGlLine": {
            const id = asInt(payload.accountId);
            if (id != null) touches.accountIds.add(id);
            break;
        }
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
        case "UniversalVoucher": {
            const id = asInt(payload.id);
            if (id != null) touches.voucherIds.add(id);
            break;
        }
        default:
            break;
    }
}

/** Ids whose rebuild failed last time; folded into the next run. */
const carried: TotalTouches = emptyTouches();

function merge(into: TotalTouches, from: TotalTouches): void {
    for (const id of from.accountIds) into.accountIds.add(id);
    for (const id of from.productIds) into.productIds.add(id);
    for (const id of from.giftCardIds) into.giftCardIds.add(id);
    for (const id of from.voucherIds) into.voucherIds.add(id);
}

function clear(t: TotalTouches): void {
    t.accountIds.clear();
    t.productIds.clear();
    t.giftCardIds.clear();
    t.voucherIds.clear();
}

/**
 * Re-sum the touched totals on Supabase. Never throws: the push already succeeded,
 * and a failure here is retried on the next flush.
 */
export async function rebuildTotalsAfterPush(touches: TotalTouches): Promise<void> {
    merge(touches, carried);
    clear(carried);

    const nothing = touches.accountIds.size === 0 && touches.productIds.size === 0
        && touches.giftCardIds.size === 0 && touches.voucherIds.size === 0;
    if (nothing) return;

    // `recompute*` take a transaction client; the live client has the same surface
    // for the reads and single-row writes they make, and one short transaction per
    // flush keeps the three rebuilds atomic with each other.
    try {
        await prismaLive.$transaction(async (tx) => {
            if (touches.voucherIds.size > 0) {
                const lines = await tx.voucherGlLine.findMany({
                    where: { universalVoucherId: { in: [...touches.voucherIds] } },
                    select: { accountId: true },
                    distinct: ["accountId"],
                });
                for (const l of lines) touches.accountIds.add(l.accountId);
            }
            await recomputeAccountBalances(tx as Prisma.TransactionClient, [...touches.accountIds]);
            await recomputeProductStock(tx as Prisma.TransactionClient, [...touches.productIds]);
            await recomputeGiftCardBalances(tx, [...touches.giftCardIds]);
        }, { timeout: 30_000 });
    } catch (err) {
        merge(carried, touches);
        console.warn(
            `[SyncPush] rebuilding cloud totals failed (accounts=${touches.accountIds.size}, ` +
            `products=${touches.productIds.size}, giftCards=${touches.giftCardIds.size}); ` +
            `will retry on the next flush:`,
            err instanceof Error ? err.message : err,
        );
    }
}
