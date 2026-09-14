// TEMPORARY — delete once the voucher-save round-trip work is done.
//
// Executes the three batched statements introduced on the voucher-save path
// against the LOCAL Postgres replica, inside a transaction that is ALWAYS rolled
// back. Nothing is committed; the point is to prove the SQL parses, binds its
// array parameters, and moves the numbers it is supposed to move.
//
// Run: pnpm exec tsx src/scripts/verify-batch-sql.ts

import * as dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

// Point it wherever you like — VERIFY_DATABASE_URL wins, else the local replica.
// Everything it does is inside a transaction that is ALWAYS rolled back, so even
// aiming it at live leaves nothing behind; it only needs to reach a database with
// this schema and a few rows in Account / InvProduct / Branch.
const url = process.env.VERIFY_DATABASE_URL || process.env.LOCAL_DATABASE_URL;
if (!url) { console.error("Set VERIFY_DATABASE_URL (or LOCAL_DATABASE_URL) — nothing to verify against."); process.exit(1); }

const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
const pool = new Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false }, max: 1 });

async function main() {
    const c = await pool.connect();
    const ok: string[] = [];
    const bad: string[] = [];
    try {
        await c.query("BEGIN");

        // Real ids, so the statements actually match rows.
        const accounts = (await c.query(`SELECT "id","balance" FROM "Account" ORDER BY "id" LIMIT 3`)).rows;
        const products = (await c.query(`SELECT "id","stock" FROM "InvProduct" ORDER BY "id" LIMIT 3`)).rows;
        const branch   = (await c.query(`SELECT "id" FROM "Branch" ORDER BY "id" LIMIT 1`)).rows[0];
        if (accounts.length < 2 || products.length < 2 || !branch) {
            console.error("replica does not have enough Account / InvProduct / Branch rows to verify against");
            process.exit(1);
        }

        // ── 1. engineGlArm's balance update ─────────────────────────────────
        // Deliberately lists the FIRST account twice, to prove the per-account
        // SUM collapses repeat legs the way N separate increments did.
        const accIds    = [accounts[0].id, accounts[1].id, accounts[0].id];
        const accDeltas = ["10.25", "-4.50", "0.75"];
        const before = new Map(accounts.map((a) => [a.id, Number(a.balance)]));
        const r1 = await c.query(
            `UPDATE "Account" AS a
                SET "balance"   = a."balance" + v."delta",
                    "updatedAt" = NOW()
               FROM (SELECT t."id", SUM(t."delta"::numeric) AS "delta"
                       FROM UNNEST($1::int[], $2::text[]) AS t("id","delta")
                      GROUP BY t."id") AS v
              WHERE a."id" = v."id"`,
            [accIds, accDeltas],
        );
        const after1 = (await c.query(`SELECT "id","balance" FROM "Account" WHERE "id" = ANY($1::int[])`, [[accounts[0].id, accounts[1].id]])).rows;
        const got0 = Number(after1.find((r) => r.id === accounts[0].id)!.balance) - before.get(accounts[0].id)!;
        const got1 = Number(after1.find((r) => r.id === accounts[1].id)!.balance) - before.get(accounts[1].id)!;
        (Math.abs(got0 - 11.0) < 1e-9 && Math.abs(got1 + 4.5) < 1e-9 && r1.rowCount === 2 ? ok : bad)
            .push(`GL balance update: rows=${r1.rowCount} acc0 moved ${got0} (want 11) acc1 moved ${got1} (want -4.5)`);

        // ── 2. InvProduct stock + MRP ───────────────────────────────────────
        const pStockBefore = new Map(products.map((p) => [p.id, p.stock === null ? null : Number(p.stock)]));
        const r2 = await c.query(
            `UPDATE "InvProduct" AS p
                SET "stock"     = CASE WHEN v."absolute" THEN v."delta" ELSE p."stock" + v."delta" END,
                    "mrpPaise"  = COALESCE(v."mrp", p."mrpPaise"),
                    "updatedAt" = NOW()
               FROM (SELECT * FROM UNNEST($1::int[], $2::int[], $3::boolean[], $4::int[])
                       AS t("id","delta","absolute","mrp")) AS v
              WHERE p."id" = v."id"`,
            [[products[0].id, products[1].id], [-3, 7], [false, false], [null, 12345]],
        );
        const after2 = (await c.query(`SELECT "id","stock","mrpPaise" FROM "InvProduct" WHERE "id" = ANY($1::int[])`, [[products[0].id, products[1].id]])).rows;
        const s0 = after2.find((r) => r.id === products[0].id)!;
        const s1 = after2.find((r) => r.id === products[1].id)!;
        const want0 = pStockBefore.get(products[0].id) === null ? null : pStockBefore.get(products[0].id)! - 3;
        const want1 = pStockBefore.get(products[1].id) === null ? null : pStockBefore.get(products[1].id)! + 7;
        const stockOk = (s0.stock === null ? want0 === null : Number(s0.stock) === want0)
            && (s1.stock === null ? want1 === null : Number(s1.stock) === want1);
        (stockOk && Number(s1.mrpPaise) === 12345 && r2.rowCount === 2 ? ok : bad)
            .push(`InvProduct update: rows=${r2.rowCount} stock ${s0.stock}/${s1.stock} (want ${want0}/${want1}) mrp=${s1.mrpPaise} (want 12345, NULL left the other alone)`);

        // ── 3. Per-branch balance insert-or-add ─────────────────────────────
        const bBefore = (await c.query(
            `SELECT "productId","stock" FROM "inv_product_branches" WHERE "productId" = ANY($1::int[]) AND "branchId" = $2`,
            [[products[0].id, products[1].id], branch.id],
        )).rows;
        const bMap = new Map(bBefore.map((r) => [r.productId, Number(r.stock)]));
        const r3 = await c.query(
            `INSERT INTO "inv_product_branches" ("productId","branchId","stock","updatedAt")
             SELECT t."productId", t."branchId", t."delta", NOW()
               FROM UNNEST($1::int[], $2::text[], $3::int[]) AS t("productId","branchId","delta")
             ON CONFLICT ("productId","branchId") DO UPDATE
                SET "stock"     = "inv_product_branches"."stock" + EXCLUDED."stock",
                    "updatedAt" = NOW()`,
            [[products[0].id, products[1].id], [branch.id, branch.id], [-3, 7]],
        );
        const bAfter = (await c.query(
            `SELECT "productId","stock" FROM "inv_product_branches" WHERE "productId" = ANY($1::int[]) AND "branchId" = $2`,
            [[products[0].id, products[1].id], branch.id],
        )).rows;
        const b0 = bAfter.find((r) => r.productId === products[0].id);
        const b1 = bAfter.find((r) => r.productId === products[1].id);
        const w0 = (bMap.get(products[0].id) ?? 0) - 3;
        const w1 = (bMap.get(products[1].id) ?? 0) + 7;
        (Number(b0?.stock) === w0 && Number(b1?.stock) === w1 && r3.rowCount === 2 ? ok : bad)
            .push(`branch balance upsert: rows=${r3.rowCount} ${b0?.stock}/${b1?.stock} (want ${w0}/${w1})`);

        // ── 4. The ledger-map loader ────────────────────────────────────────
        const r4 = await c.query(
            `SELECT a."id", a."name", a."normalBalance"::text AS "normalBalance", g."type"::text AS "groupType"
               FROM "Account" a
               LEFT JOIN "AccountGroup" g ON g."id" = a."groupId"
              WHERE a."personId" IS NULL AND a."companyId" IS NULL AND a."isActive" = true
                AND LOWER(a."name") = ANY($1::text[])
              ORDER BY a."id" ASC`,
            [["sales a/c", "sales", "cash", "cgst output", "sgst output", "round off"]],
        );
        (r4.rowCount! > 0 ? ok : bad).push(
            `ledger map loader: matched ${r4.rowCount} ledger(s) — ${r4.rows.map((r) => r.name).join(", ") || "none"}`,
        );
    } finally {
        await c.query("ROLLBACK");   // nothing above is kept
        c.release();
        await pool.end();
    }

    for (const line of ok)  console.log(`  PASS  ${line}`);
    for (const line of bad) console.log(`  FAIL  ${line}`);
    console.log(bad.length === 0 ? "\nAll batched statements execute correctly. Transaction rolled back." : "\nSOMETHING IS WRONG.");
    process.exit(bad.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error("FAILED:", e?.message ?? e); process.exit(1); });
