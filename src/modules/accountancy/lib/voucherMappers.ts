// Per-type voucher → TransactionSpec mappers (plan Phase 2).
//
// PURE translation only: build the engine spec's `glLines` / `stockMoves` from a
// loaded voucher. NO DB writes, NO status/lifecycle — that lives once in the
// engine (`enginePost`), identical for every type, never duplicated per mapper.
// One file; dispatched via `mapperFor(type)` (added when the route is wired).
//
// Phase 2: the trading GL mapper reuses `buildInvVoucherGlLines` (shared with the
// legacy `postInvVoucherToGl`) and `buildTradingStockMoves` (faithful extraction
// of the `/post` route's fixed-direction in/out loop) so both GL and stock are
// byte-identical. The parity harness (`src/scripts/parity-harness.ts`) is the gate.
// PHYSICAL_STOCK (stateful first-of-day) and MANUFACTURING_JOURNAL (per-line
// direction) stay separate mappers; physical-stock's stateful read is a route
// pre-step (see plan).

import type { Prisma } from "@/generated/prisma/client";
import { readPartyName } from "@/shared/lib/accountancy/partySnapshot";
import { toNumber } from "./balance";
import { buildInvVoucherGlLines, type PostVoucherInput } from "./postInvVoucher";
import type { TransactionSpec, EngineStockMove } from "./transactionEngine";

type Tx = Prisma.TransactionClient;

// Fixed-direction stock classification — matches the `/post` route exactly.
const STOCK_IN_TYPES  = new Set(["PURCHASE", "GRN", "REJECTION_IN", "SALE_RETURN"]);
const STOCK_OUT_TYPES = new Set(["SALE", "CHALLAN", "REJECTION_OUT", "PURCHASE_RETURN"]);

/** Minimal item-line shape the stock arm reads (subset of InvVoucherLine + product.stock). */
export type TradingStockLine = {
    productId: number;
    quantity:  Prisma.Decimal | number | string;
    freeQty?:  Prisma.Decimal | number | string | null;
    rate:      Prisma.Decimal | number | string;
    amount:    Prisma.Decimal | number | string;
    mrpPaise?: number | null;
    product?:  { stock: number | null } | null;
};

/**
 * Stock moves for a fixed-direction trading voucher (SALE/CHALLAN/REJECTION_OUT/
 * PURCHASE_RETURN → OUT; PURCHASE/GRN/REJECTION_IN/SALE_RETURN → IN). Free qty is
 * added to the moved quantity; MRP is stamped on purchase lines. Returns [] for
 * non-stock or non-trading types. VERBATIM port of the route's per-line loop.
 *
 * Excludes PHYSICAL_STOCK (stateful) and MANUFACTURING_JOURNAL (per-line
 * direction) — those get their own mappers.
 */
export function buildTradingStockMoves(args: {
    type:      string;
    voucherId: number;
    branchId:  string;
    date:      Date;
    lines:     TradingStockLine[];
}): EngineStockMove[] {
    const isPurchase = STOCK_IN_TYPES.has(args.type);
    const isSale     = STOCK_OUT_TYPES.has(args.type);
    if (!isPurchase && !isSale) return [];

    const moves: EngineStockMove[] = [];
    for (const line of args.lines) {
        const qty      = toNumber(line.quantity);
        const freeQty  = line.freeQty != null ? toNumber(line.freeQty) : 0;
        const totalQty = qty + freeQty;
        const inQty    = isPurchase ? totalQty : 0;
        const outQty   = isSale     ? totalQty : 0;
        if (inQty <= 0 && outQty <= 0) continue;
        moves.push({
            voucherId:           args.voucherId,
            productId:           line.productId,
            branchId:            args.branchId,
            date:                args.date,
            inQty,
            outQty,
            rate:                line.rate,
            amount:              line.amount,
            productCurrentStock: line.product?.stock ?? null,
            newMrpPaise:         isPurchase && line.mrpPaise != null ? line.mrpPaise : undefined,
        });
    }
    return moves;
}

/**
 * Trading voucher (SALE / PURCHASE / SALE_RETURN / PURCHASE_RETURN / GRN /
 * CHALLAN / REJECTION_*) → engine spec.
 * - `glLines` from the shared `buildInvVoucherGlLines`.
 * - `stockMoves` from `buildTradingStockMoves` when `stock` (voucher id + branch
 *   + item lines) is supplied; the route passes it, the GL-only harness omits it.
 */
export async function saleToSpec(
    tx: Tx,
    voucher: PostVoucherInput["voucher"],
    stock?: { voucherId: number; branchId: string; lines: TradingStockLine[] },
): Promise<TransactionSpec> {
    const built = await buildInvVoucherGlLines(tx, voucher);
    return {
        type:       voucher.type,
        date:       voucher.date,
        reference:  voucher.reference,
        narration:  readPartyName(voucher.partyJson) ?? voucher.description,
        glLines:    built.skip ? [] : built.lines,
        stockMoves: stock
            ? buildTradingStockMoves({
                type:      voucher.type,
                voucherId: stock.voucherId,
                branchId:  stock.branchId,
                date:      voucher.date,
                lines:     stock.lines,
            })
            : [],
    };
}
