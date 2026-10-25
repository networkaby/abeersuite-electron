"use strict";

/**
 * Re-sum the replica's running totals after a cycle landed ledger rows.
 *
 * `InvProduct.stock` / `inv_product_branches.stock` and `GiftCard.balance`
 * never travel between machines (see `cacheColumns` in the
 * registry): a pulled row leaves the local total alone, and this module rebuilds
 * the totals whose ledger rows arrived in this cycle from the LOCAL ledger. The
 * app's push side does the same on Supabase (src/shared/lib/sync/rebuildTotals.ts);
 * the SQL here mirrors those helpers.
 *
 * ── Why collect ids rather than rebuild everything ──────────────────────────
 * A full rebuild is one aggregate over every GL line, every cycle, on a shop PC —
 * fine once, not every ten minutes. The pull already has the rows in hand, so noting
 * `productId` / `giftCardId` as they go by costs nothing.
 *
 * ── Why the ids are kept in a table, `_sync_dirty` ──────────────────────────
 * pull.js notes them on the SAME transaction that lands the page, and the rebuild at
 * the end of the cycle (sync-once.js, pass 4) clears only what it has re-summed. A
 * cycle killed in between — the app closed mid-sync, Windows shutting down, the
 * worker's own cycle timeout — leaves the list behind, and the next cycle finishes
 * the job. The list used to live in this module's memory: the ledger page was
 * committed and its cursor had moved, so no later cycle saw those rows again, and the
 * totals stayed wrong until something else happened to touch the same ids.
 *
 * Runs OUTSIDE replica mode, deliberately: the outbox trigger then fires on the
 * UPDATEs and suppresses them itself (only a total changed), which is the same
 * path a sale on this counter takes.
 */

const { q } = require("./db");
const { ensureTable } = require("./bookkeeping");

const DIRTY = "_sync_dirty";

/** `kind` is a bucket of TOUCH below (products, giftCards). Rows of the retired
 *  `accounts` / `vouchers` kinds an older build left behind are simply cleared. */
const DIRTY_COLUMNS = [
    ["kind", "text NOT NULL"],
    ["id", "integer NOT NULL"],
];

async function ensure(client) {
    await ensureTable(client, DIRTY, DIRTY_COLUMNS, ['PRIMARY KEY ("kind", "id")']);
}

/** Physical table -> which column names a total. Tables not listed touch nothing. */
const TOUCH = {
    InvStockLedger: { products: "productId" },
    GiftCardTxn: { giftCards: "giftCardId" },
};

function asInt(v) {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isInteger(n) ? n : null;
}

/** Note the totals a batch of rows can move, on `client` — the transaction writing them. */
async function noteRows(client, table, rows) {
    const spec = TOUCH[table];
    if (!spec || !rows || rows.length === 0) return;
    for (const [kind, col] of Object.entries(spec)) {
        const ids = [...new Set(rows.map((r) => asInt(r[col])).filter((id) => id != null))];
        if (ids.length === 0) continue;
        await client.query(
            `INSERT INTO ${q(DIRTY)} (kind, id) SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING`,
            [kind, ids],
        );
    }
}

/**
 * Before a child set is replaced or keys are deleted, note what the rows ABOUT TO
 * GO touched: a stock row re-pointed at another product leaves the old product's
 * total stale unless it is re-summed too.
 */
async function noteBeforeDelete(client, table, whereSql, params) {
    const spec = TOUCH[table];
    if (!spec) return;
    const cols = Object.values(spec).map(q).join(", ");
    const res = await client.query(`SELECT ${cols} FROM ${q(table)} WHERE ${whereSql}`, params);
    await noteRows(client, table, res.rows);
}

/**
 * The saved total a product should hold — the office's rule, recomputeProductStock
 * (src/modules/inventory/lib/stockMovement.ts): opening + ledger, rounded to the Int
 * column. "Not tracked" (NULL — no opening, no ledger row) is kept, never invented:
 * a NULL stays NULL and a number goes to 0, because the shop reads NULL as "always in
 * stock". Needs `p` = "InvProduct" and `led.qty` = that product's ledger sum.
 * Unlike the office it does not move "updatedAt": a total changing alone must not
 * ship a row (see the top of this file).
 */
const PRODUCT_WANT = `
    CASE WHEN p."openingStock" IS NOT NULL OR led.qty IS NOT NULL
             THEN ROUND(COALESCE(p."openingStock", 0) + COALESCE(led.qty, 0))::int
         WHEN p.stock IS NULL THEN NULL
         ELSE 0
    END`;

const PRODUCT_SQL = `
WITH ids AS (SELECT unnest($1::int[]) AS id),
led AS (
    SELECT "productId" AS id, SUM("inQty" - "outQty") AS qty
      FROM "InvStockLedger" WHERE "productId" = ANY($1::int[]) GROUP BY 1
)
UPDATE "InvProduct" p
   SET stock = ${PRODUCT_WANT}
  FROM ids
  LEFT JOIN led ON led.id = ids.id
 WHERE p.id = ids.id
   AND p.stock IS DISTINCT FROM ${PRODUCT_WANT}`;

const BRANCH_UPSERT_SQL = `
INSERT INTO "inv_product_branches" ("productId", "branchId", stock, "updatedAt")
SELECT "productId", "branchId", ROUND(SUM("inQty" - "outQty"))::int, now()
  FROM "InvStockLedger" WHERE "productId" = ANY($1::int[]) GROUP BY 1, 2
ON CONFLICT ("productId", "branchId") DO UPDATE SET stock = EXCLUDED.stock
 WHERE "inv_product_branches".stock IS DISTINCT FROM EXCLUDED.stock`;

/** A branch whose last ledger row went away has no group above; truth is zero. */
const BRANCH_ZERO_SQL = `
UPDATE "inv_product_branches" b
   SET stock = 0
 WHERE b."productId" = ANY($1::int[]) AND b.stock <> 0
   AND NOT EXISTS (SELECT 1 FROM "InvStockLedger" l
                    WHERE l."productId" = b."productId" AND l."branchId" = b."branchId")`;

/** Cards with no txn yet (DRAFT) are left alone: their balance is the typed value. */
const GIFT_CARD_SQL = `
WITH s AS (
    SELECT "giftCardId" AS id, SUM(amount) AS total
      FROM "GiftCardTxn" WHERE "giftCardId" = ANY($1::int[]) GROUP BY 1
)
UPDATE "GiftCard" g
   SET balance = s.total,
       status = CASE WHEN g.status = 'ACTIVE'   AND s.total <= 0.005 THEN 'REDEEMED'::"GiftCardStatus"
                     WHEN g.status = 'REDEEMED' AND s.total >  0.005 THEN 'ACTIVE'::"GiftCardStatus"
                     ELSE g.status END
  FROM s
 WHERE g.id = s.id
   AND (g.balance IS DISTINCT FROM s.total
        OR g.status IS DISTINCT FROM CASE WHEN g.status = 'ACTIVE'   AND s.total <= 0.005 THEN 'REDEEMED'::"GiftCardStatus"
                                          WHEN g.status = 'REDEEMED' AND s.total >  0.005 THEN 'ACTIVE'::"GiftCardStatus"
                                          ELSE g.status END)`;

/**
 * Rebuild everything noted and not yet re-summed — this cycle's rows, plus whatever a
 * killed cycle left behind. Returns how many total rows changed.
 * Throws on a database error so the cycle reports it like any other failure.
 */
async function rebuildTouched(local, log) {
    const { rows: noted } = await local.query(
        `SELECT kind, array_agg(id) AS ids FROM ${q(DIRTY)} GROUP BY kind`,
    );
    if (noted.length === 0) return 0;
    const ids = (kind) => (noted.find((r) => r.kind === kind) || { ids: [] }).ids;

    const products = ids("products");
    const giftCards = ids("giftCards");

    let changed = 0;
    if (products.length > 0) {
        changed += (await local.query(PRODUCT_SQL, [products])).rowCount || 0;
        changed += (await local.query(BRANCH_UPSERT_SQL, [products])).rowCount || 0;
        changed += (await local.query(BRANCH_ZERO_SQL, [products])).rowCount || 0;
    }
    if (giftCards.length > 0) {
        changed += (await local.query(GIFT_CARD_SQL, [giftCards])).rowCount || 0;
    }
    // Cleared only now, and only what was read: a cycle killed above leaves every id for
    // the next one. Re-summing is idempotent, so an id done twice costs a query, never a
    // wrong total. Nothing else writes this table while a cycle runs — one worker, one
    // cycle at a time (index.js).
    for (const r of noted) {
        await local.query(`DELETE FROM ${q(DIRTY)} WHERE kind = $1 AND id = ANY($2::int[])`, [r.kind, r.ids]);
    }
    if (log) {
        log(`  totals re-summed: ${products.length} product(s), ` +
            `${giftCards.length} gift card(s) — ${changed} value(s) changed`);
    }
    return changed;
}

/**
 * How many totals on THIS database disagree with its own ledger, per kind. The
 * check behind `verify-replica.js --totals`: after a cycle every count must be 0.
 * Reads only; the rebuild is what fixes them.
 */
async function driftReport(client) {
    const products = await client.query(`
        WITH led AS (SELECT "productId" AS id, SUM("inQty" - "outQty") AS qty FROM "InvStockLedger" GROUP BY 1)
        SELECT count(*)::int AS n FROM "InvProduct" p LEFT JOIN led ON led.id = p.id
         WHERE p.stock IS DISTINCT FROM ${PRODUCT_WANT}`);
    const branches = await client.query(`
        WITH led AS (SELECT "productId", "branchId", ROUND(SUM("inQty" - "outQty"))::int AS qty FROM "InvStockLedger" GROUP BY 1, 2)
        SELECT count(*)::int AS n FROM "inv_product_branches" b
          LEFT JOIN led ON led."productId" = b."productId" AND led."branchId" = b."branchId"
         WHERE b.stock IS DISTINCT FROM COALESCE(led.qty, 0)`);
    const giftCards = await client.query(`
        WITH s AS (SELECT "giftCardId" AS id, SUM(amount) AS total FROM "GiftCardTxn" GROUP BY 1)
        SELECT count(*)::int AS n FROM "GiftCard" g JOIN s ON s.id = g.id WHERE g.balance IS DISTINCT FROM s.total`);
    return {
        products: products.rows[0].n,
        branches: branches.rows[0].n,
        giftCards: giftCards.rows[0].n,
    };
}

module.exports = { ensure, noteRows, noteBeforeDelete, rebuildTouched, driftReport, TOUCH };
