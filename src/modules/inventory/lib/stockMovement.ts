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
    // One line is a batch of one — the same three statements, the same rule for
    // an empty total. There used to be two copies of this, and they drifted.
    await recordStockMovementsBatch(tx, [args]);
}

/**
 * Batched form of recordStockMovement for multi-line posts (e.g. a POS sale with
 * N lines). Identical net effect to calling recordStockMovement once per line, in
 * THREE statements regardless of how many lines the bill has — one ledger insert,
 * one org-wide cache update, one per-branch balance upsert.
 *
 * Why it matters: every statement inside the transaction is a separate round trip
 * to the database, and on the office/Vercel path that is a trip to Supabase. This
 * used to be 2N+1 statements (a 10-line bill = 21 trips); it is now 3.
 *
 * Keep this in lockstep with recordStockMovement.
 *
 * ── Why the rows are summed first ───────────────────────────────────────────
 * The same product can legitimately appear on two lines of one bill. Postgres
 * refuses an ON CONFLICT insert that touches the same key twice in one statement
 * ("cannot affect row a second time"), so the per-line rows are folded by product
 * (and by product+branch) before the statement is built. Two increments of 3 and
 * 2 and one increment of 5 leave the same number behind.
 *
 * ── Why raw SQL ─────────────────────────────────────────────────────────────
 * Prisma cannot express "update N different rows by N different amounts" in one
 * call. The counter replica's outbox trigger is `FOR EACH ROW AFTER INSERT OR
 * UPDATE`, so it captures these exactly as it captured the per-row Prisma writes
 * — raw SQL is not a way around it (see the note in prismaClient.ts). `updatedAt`
 * is stamped by hand because `@updatedAt` is a client-side Prisma feature that
 * raw SQL does not get for free.
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

    // Fold the per-line rows into one entry per target row.
    const orgWide  = new Map<number, { delta: number; mrp: number | null }>();
    const perBranch = new Map<string, { productId: number; branchId: string; delta: number }>();

    for (const a of items) {
        const delta = Math.round(toNumber(a.inQty)) - Math.round(toNumber(a.outQty));
        if (delta === 0 && a.newMrpPaise == null) continue;

        if (a.updateOrgWideStock !== false) {
            const cur = orgWide.get(a.productId) ?? { delta: 0, mrp: null };
            cur.delta   += delta;
            if (a.newMrpPaise != null) cur.mrp = a.newMrpPaise;   // last line wins, as before
            orgWide.set(a.productId, cur);
        }

        if (a.updateBranchBalance !== false && delta !== 0) {
            const key = `${a.productId}|${a.branchId}`;
            const cur = perBranch.get(key) ?? { productId: a.productId, branchId: a.branchId, delta: 0 };
            cur.delta += delta;
            perBranch.set(key, cur);
        }
    }

    // 2. Org-wide InvProduct cache (stock + optional MRP stamp) — one statement.
    await applyOrgWideStock(tx, [...orgWide].map(([id, v]) => ({ id, ...v })));

    // 3. Per-branch balance — one statement. Insert-or-add, the multi-row form of
    // the upsert this used to run once per line.
    const branches = [...perBranch.values()];
    if (branches.length > 0) {
        await tx.$executeRaw`
            INSERT INTO "inv_product_branches" ("productId", "branchId", "stock", "updatedAt")
            SELECT t."productId", t."branchId", t."delta", NOW()
              FROM UNNEST(
                    ${branches.map((b) => b.productId)}::int[],
                    ${branches.map((b) => b.branchId)}::text[],
                    ${branches.map((b) => b.delta)}::int[]
                   ) AS t("productId", "branchId", "delta")
            ON CONFLICT ("productId", "branchId") DO UPDATE
               SET "stock"     = "inv_product_branches"."stock" + EXCLUDED."stock",
                   "updatedAt" = NOW()
        `;
    }
}

/**
 * Apply per-product changes to the org-wide `InvProduct.stock`, in ONE statement.
 * Every writer comes through here, so there is one rule for an EMPTY total:
 *
 *   stock is a number → stock + delta
 *   stock is NULL      → openingStock + Σ(inQty − outQty), straight from the ledger
 *
 * NULL means "not tracked yet" (a Vyapar-imported product has an opening and no
 * saved total). Postgres reads NULL + n as NULL, so a plain increment left such a
 * product empty forever — the shop then treats it as untracked, always in stock —
 * and the old "absolute" rule wrote just this line's delta, dropping the opening
 * (opening 10, sell 1 → −1). The ledger rows of THIS movement are inserted before
 * the call, so the sum already holds them. Rounded: the total is Int, the ledger
 * Decimal(10,3).
 */
async function applyOrgWideStock(
    tx: Prisma.TransactionClient,
    rows: Array<{ id: number; delta: number; mrp: number | null }>,
): Promise<void> {
    const org = rows.filter((r) => r.delta !== 0 || r.mrp != null);
    if (org.length === 0) return;
    await tx.$executeRaw`
        UPDATE "InvProduct" AS p
           SET "stock"     = CASE
                   WHEN p."stock" IS NOT NULL THEN p."stock" + v."delta"
                   ELSE ROUND(COALESCE(p."openingStock", 0) + COALESCE((
                       SELECT SUM(l."inQty" - l."outQty") FROM "InvStockLedger" AS l WHERE l."productId" = p."id"
                   ), 0))::int
               END,
               "mrpPaise"  = COALESCE(v."mrp", p."mrpPaise"),
               "updatedAt" = NOW()
          FROM (
                SELECT * FROM UNNEST(
                    ${org.map((r) => r.id)}::int[],
                    ${org.map((r) => r.delta)}::int[],
                    ${org.map((r) => r.mrp)}::int[]
                ) AS t("id", "delta", "mrp")
               ) AS v
         WHERE p."id" = v."id"
    `;
}

export interface ReverseStockMovementArgs {
    /** Original ledger row being reversed. */
    ledgerRow: {
        id:        number;
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
 * amount sign flipped) and applies the inverse delta to InvProduct.stock (same
 * empty-total rule as posting, applyOrgWideStock) and InvProductBranch.stock.
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
            reversalOfId: ledgerRow.id,
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
        await applyOrgWideStock(tx, [{ id: ledgerRow.productId, delta: reverseDelta, mrp: null }]);
    }
}

/**
 * Remove the counter-entries a CANCEL wrote for one voucher — the mirror of
 * `reverseStockMovement`, used when a cancelled voucher is restored. Returns the
 * product ids touched so the caller can `recomputeProductStock` them.
 *
 * The counter-rows are the ones that name the row they reverse (`reversalOfId`),
 * so nothing is guessed from sign or position. Every original must have exactly
 * one; an unexpected trail throws rather than guessing, because a wrong guess
 * here corrupts stock quietly.
 */
export async function deleteCancelCounterRows(
    tx: Prisma.TransactionClient,
    universalVoucherId: number,
): Promise<number[]> {
    const rows = await tx.invStockLedger.findMany({
        where:  { universalVoucherId },
        select: { id: true, productId: true, reversalOfId: true },
    });
    if (rows.length === 0) return [];
    const counters = rows.filter((r) => r.reversalOfId != null);
    const originals = rows.filter((r) => r.reversalOfId == null);
    const reversed = new Set(counters.map((r) => r.reversalOfId));
    if (originals.some((o) => !reversed.has(o.id))) {
        throw new Error(`Stock trail for voucher ${universalVoucherId} is not a clean cancel reversal. Restore aborted.`);
    }

    await tx.invStockLedger.deleteMany({ where: { id: { in: counters.map((r) => r.id) } } });
    return [...new Set(rows.map((r) => r.productId))];
}

// ── Recompute on-hand from truth (the ② safety net + edit oracle) ────────────
//
// Rebuilds the cached InvProduct.stock / InvProductBranch.stock for the given
// products straight from the source of truth, so callers (e.g. the in-place
// voucher edit) never hand-maintain the cache with fragile delta math — they
// mutate the ledger, then call this. Formula (validated catalogue-wide, zero
// drift — see src/scripts/recompute-stock.ts):
//   InvProduct.stock       = openingStock (Tally master column) + Σ(inQty − outQty)
//   InvProductBranch.stock = Σ(inQty − outQty) per branch
// `openingStock` is folded in exactly as GL folds Account.openingBalance into
// aggregateClosingAsOf — it is NOT a ledger row.
export async function recomputeProductStock(
    tx: Prisma.TransactionClient,
    productIds: number[],
): Promise<void> {
    const ids = [...new Set(productIds)];
    if (ids.length === 0) return;

    // Three statements however many products — this used to be one UPDATE per
    // product and one upsert per branch row. Rows that already hold the right
    // number are left alone, so a counter's outbox does not ship a no-op update.
    // Rounded to the Int column; the ledger is Decimal(10,3) and a bare 2.5 was
    // silently cut to 2.
    //
    // "Not tracked" (NULL) is kept, never invented: a product with no opening and
    // no ledger row stays NULL if it was NULL, and a number goes to 0 — a rebuild
    // must not quietly turn a tracked product into an untracked one, which the
    // shop reads as "always in stock".
    //
    // One after another: inside a transaction (one connection) pg refuses parallel queries.
    await tx.$executeRaw`
        WITH led AS (
            SELECT "productId", SUM("inQty" - "outQty") AS q
              FROM "InvStockLedger" WHERE "productId" = ANY(${ids}::int[])
             GROUP BY "productId"
        ), want AS (
            SELECT p."id",
                   CASE WHEN p."openingStock" IS NOT NULL OR led.q IS NOT NULL
                            THEN ROUND(COALESCE(p."openingStock", 0) + COALESCE(led.q, 0))::int
                        WHEN p."stock" IS NULL THEN NULL
                        ELSE 0
                   END AS stock
              FROM "InvProduct" AS p LEFT JOIN led ON led."productId" = p."id"
             WHERE p."id" = ANY(${ids}::int[])
        )
        UPDATE "InvProduct" AS p
           SET "stock" = want.stock, "updatedAt" = NOW()
          FROM want
         WHERE p."id" = want."id" AND p."stock" IS DISTINCT FROM want.stock
    `;

    await tx.$executeRaw`
        INSERT INTO "inv_product_branches" ("productId", "branchId", "stock", "updatedAt")
        SELECT "productId", "branchId", ROUND(SUM("inQty" - "outQty"))::int, NOW()
          FROM "InvStockLedger" WHERE "productId" = ANY(${ids}::int[])
         GROUP BY "productId", "branchId"
        ON CONFLICT ("productId", "branchId") DO UPDATE
           SET "stock" = EXCLUDED."stock", "updatedAt" = NOW()
         WHERE "inv_product_branches"."stock" IS DISTINCT FROM EXCLUDED."stock"
    `;

    // A product whose LAST ledger row in a branch just got deleted produces no
    // group above at all, so without this the stale balance survives. Truth for
    // those rows is zero.
    await tx.$executeRaw`
        UPDATE "inv_product_branches" AS b
           SET "stock" = 0, "updatedAt" = NOW()
         WHERE b."productId" = ANY(${ids}::int[]) AND b."stock" <> 0
           AND NOT EXISTS (
               SELECT 1 FROM "InvStockLedger" AS l
                WHERE l."productId" = b."productId" AND l."branchId" = b."branchId"
           )
    `;
}
