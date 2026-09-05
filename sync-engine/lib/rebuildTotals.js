"use strict";

/**
 * Re-sum the replica's running totals after a cycle landed ledger rows.
 *
 * `Account.balance`, `InvProduct.stock` / `inv_product_branches.stock` and
 * `GiftCard.balance` never travel between machines (see `cacheColumns` in the
 * registry): a pulled row leaves the local total alone, and this module rebuilds
 * the totals whose ledger rows arrived in this cycle from the LOCAL ledger. The
 * app's push side does the same on Supabase (src/shared/lib/sync/rebuildTotals.ts);
 * the SQL here mirrors those helpers.
 *
 * ── Why collect ids rather than rebuild everything ──────────────────────────
 * A full rebuild is one aggregate over every GL line, every cycle, on a shop PC —
 * fine once, not every ten minutes. The pull already has the rows in hand, so noting
 * `accountId` / `productId` / `giftCardId` as they go by costs nothing.
 *
 * The collector is module state: pull.js notes rows as it writes them, sync-once.js
 * runs the rebuild once at the end. A cycle is one process (index.js spawns
 * sync-once.js per cycle), so nothing leaks between cycles.
 *
 * Runs OUTSIDE replica mode, deliberately: the outbox trigger then fires on the
 * UPDATEs and suppresses them itself (only a total changed), which is the same
 * path a sale on this counter takes.
 */

const { q } = require("./db");

/** Physical table -> which column names a total. Tables not listed touch nothing. */
const TOUCH = {
    VoucherGlLine: { accounts: "accountId" },
    InvStockLedger: { products: "productId" },
    GiftCardTxn: { giftCards: "giftCardId" },
    // A cancel changes Account.balance without writing a GL line: the sum counts
    // POSTED, non-deleted vouchers only. Resolved to accounts at rebuild time.
    UniversalVoucher: { vouchers: "id" },
};

const touched = { accounts: new Set(), products: new Set(), giftCards: new Set(), vouchers: new Set() };

function asInt(v) {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isInteger(n) ? n : null;
}

/** Note the totals a batch of pulled rows can move. */
function noteRows(table, rows) {
    const spec = TOUCH[table];
    if (!spec || !rows || rows.length === 0) return;
    for (const [bucket, col] of Object.entries(spec)) {
        for (const row of rows) {
            const id = asInt(row[col]);
            if (id != null) touched[bucket].add(id);
        }
    }
}

/**
 * Before a child set is replaced or keys are deleted, note what the rows ABOUT TO
 * GO touched: a GL line re-pointed at another account leaves the old account's
 * total stale unless it is re-summed too.
 */
async function noteBeforeDelete(client, table, whereSql, params) {
    const spec = TOUCH[table];
    if (!spec) return;
    const cols = Object.values(spec).map(q).join(", ");
    const res = await client.query(`SELECT ${cols} FROM ${q(table)} WHERE ${whereSql}`, params);
    noteRows(table, res.rows);
}

function pending() {
    return touched.accounts.size + touched.products.size + touched.giftCards.size + touched.vouchers.size;
}

const ACCOUNTS_SQL = `
WITH ids AS (SELECT unnest($1::int[]) AS id),
nb AS (
    SELECT a.id,
           COALESCE(a."normalBalance"::text,
                    CASE WHEN g.type IS NULL THEN NULL
                         WHEN g.type::text IN ('ASSET', 'EXPENSE') THEN 'DEBIT'
                         ELSE 'CREDIT' END) AS side
      FROM "Account" a
      JOIN ids ON ids.id = a.id
      LEFT JOIN "AccountGroup" g ON g.id = a."groupId"
),
sums AS (
    SELECT l."accountId" AS id,
           SUM(CASE WHEN nb.side = l.type::text THEN l.amount ELSE -l.amount END) AS total
      FROM "VoucherGlLine" l
      JOIN nb ON nb.id = l."accountId" AND nb.side IS NOT NULL
      JOIN "UniversalVoucher" v ON v.id = l."universalVoucherId"
     WHERE v.status = 'POSTED' AND v."deletedAt" IS NULL
     GROUP BY l."accountId"
)
UPDATE "Account" a
   SET balance = COALESCE(s.total, 0)
  FROM ids
  LEFT JOIN sums s ON s.id = ids.id
 WHERE a.id = ids.id
   AND a.balance IS DISTINCT FROM COALESCE(s.total, 0)`;

const PRODUCT_SQL = `
WITH ids AS (SELECT unnest($1::int[]) AS id),
led AS (
    SELECT "productId" AS id, SUM("inQty" - "outQty") AS qty
      FROM "InvStockLedger" WHERE "productId" = ANY($1::int[]) GROUP BY 1
)
UPDATE "InvProduct" p
   SET stock = ROUND(COALESCE(p."openingStock", 0) + COALESCE(led.qty, 0))::int
  FROM ids
  LEFT JOIN led ON led.id = ids.id
 WHERE p.id = ids.id
   AND p.stock IS DISTINCT FROM ROUND(COALESCE(p."openingStock", 0) + COALESCE(led.qty, 0))::int`;

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
 * Rebuild everything noted this cycle. Returns how many total rows changed.
 * Throws on a database error so the cycle reports it like any other failure.
 */
async function rebuildTouched(local, log) {
    if (pending() === 0) return 0;

    if (touched.vouchers.size > 0) {
        const res = await local.query(
            `SELECT DISTINCT "accountId" FROM "VoucherGlLine" WHERE "universalVoucherId" = ANY($1::int[])`,
            [[...touched.vouchers]],
        );
        for (const r of res.rows) touched.accounts.add(r.accountId);
    }

    let changed = 0;
    if (touched.accounts.size > 0) {
        changed += (await local.query(ACCOUNTS_SQL, [[...touched.accounts]])).rowCount || 0;
    }
    if (touched.products.size > 0) {
        const ids = [[...touched.products]];
        changed += (await local.query(PRODUCT_SQL, ids)).rowCount || 0;
        changed += (await local.query(BRANCH_UPSERT_SQL, ids)).rowCount || 0;
        changed += (await local.query(BRANCH_ZERO_SQL, ids)).rowCount || 0;
    }
    if (touched.giftCards.size > 0) {
        changed += (await local.query(GIFT_CARD_SQL, [[...touched.giftCards]])).rowCount || 0;
    }
    if (log) {
        log(`  totals re-summed: ${touched.accounts.size} account(s), ${touched.products.size} product(s), ` +
            `${touched.giftCards.size} gift card(s) — ${changed} value(s) changed`);
    }
    touched.accounts.clear();
    touched.products.clear();
    touched.giftCards.clear();
    touched.vouchers.clear();
    return changed;
}

/**
 * How many totals on THIS database disagree with its own ledger, per kind. The
 * check behind `verify-replica.js --totals`: after a cycle every count must be 0.
 * Reads only; the rebuild is what fixes them.
 */
async function driftReport(client) {
    const accounts = await client.query(`
        WITH nb AS (
            SELECT a.id, a.balance,
                   COALESCE(a."normalBalance"::text,
                            CASE WHEN g.type IS NULL THEN NULL
                                 WHEN g.type::text IN ('ASSET', 'EXPENSE') THEN 'DEBIT'
                                 ELSE 'CREDIT' END) AS side
              FROM "Account" a LEFT JOIN "AccountGroup" g ON g.id = a."groupId"
        ),
        sums AS (
            SELECT l."accountId" AS id,
                   SUM(CASE WHEN nb.side = l.type::text THEN l.amount ELSE -l.amount END) AS total
              FROM "VoucherGlLine" l
              JOIN nb ON nb.id = l."accountId" AND nb.side IS NOT NULL
              JOIN "UniversalVoucher" v ON v.id = l."universalVoucherId"
             WHERE v.status = 'POSTED' AND v."deletedAt" IS NULL
             GROUP BY 1
        )
        SELECT count(*)::int AS n FROM nb LEFT JOIN sums s ON s.id = nb.id
         WHERE nb.balance IS DISTINCT FROM COALESCE(s.total, 0)`);
    const products = await client.query(`
        WITH led AS (SELECT "productId" AS id, SUM("inQty" - "outQty") AS qty FROM "InvStockLedger" GROUP BY 1)
        SELECT count(*)::int AS n FROM "InvProduct" p LEFT JOIN led ON led.id = p.id
         WHERE p.stock IS DISTINCT FROM ROUND(COALESCE(p."openingStock", 0) + COALESCE(led.qty, 0))::int`);
    const branches = await client.query(`
        WITH led AS (SELECT "productId", "branchId", ROUND(SUM("inQty" - "outQty"))::int AS qty FROM "InvStockLedger" GROUP BY 1, 2)
        SELECT count(*)::int AS n FROM "inv_product_branches" b
          LEFT JOIN led ON led."productId" = b."productId" AND led."branchId" = b."branchId"
         WHERE b.stock IS DISTINCT FROM COALESCE(led.qty, 0)`);
    const giftCards = await client.query(`
        WITH s AS (SELECT "giftCardId" AS id, SUM(amount) AS total FROM "GiftCardTxn" GROUP BY 1)
        SELECT count(*)::int AS n FROM "GiftCard" g JOIN s ON s.id = g.id WHERE g.balance IS DISTINCT FROM s.total`);
    return {
        accounts: accounts.rows[0].n,
        products: products.rows[0].n,
        branches: branches.rows[0].n,
        giftCards: giftCards.rows[0].n,
    };
}

module.exports = { noteRows, noteBeforeDelete, rebuildTouched, driftReport, pending, TOUCH };
