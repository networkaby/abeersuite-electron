// One-shot backfill script for the multi-branch inventory migration.
//
// Run: pnpm tsx prisma/seeds/backfill-multi-branch.ts
//
// What it does (idempotent):
//   1. Picks the default branch (first active, ordered by createdAt) — typically BR-HQ.
//   2. Sets branchId on every existing InvVoucher row where NULL.
//   3. Sets branchId on every existing InvStockLedger row where NULL.
//   4. Upserts InvProductBranch rows: for every product with stock > 0 (or
//      stock IS NOT NULL), create a row tagged to the default branch carrying
//      that stock count.
//
// After this script runs cleanly:
//   • Update prisma/schema/inventory.prisma to make branchId NOT NULL.
//   • Run `npx prisma db push` to enforce the constraint.

import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/[?&]$/, "");

const pool = new Pool({ connectionString: rawUrl, ssl: { rejectUnauthorized: false }, max: 1 });

async function main(): Promise<void> {
    console.log("Multi-branch inventory backfill — starting…\n");

    // 1. Default branch
    const br = await pool.query<{ id: string; name: string }>(
        `SELECT id, name FROM "Branch" WHERE "isActive" = true ORDER BY "createdAt" ASC LIMIT 1`
    );
    if (!br.rows[0]) {
        throw new Error("No active branch found — seed branches first via `pnpm prisma db seed`.");
    }
    const defaultBranchId = br.rows[0].id;
    console.log(`[1/3] Default branch: ${defaultBranchId} (${br.rows[0].name})\n`);

    // 2. Backfill InvVoucher.branchId
    const v = await pool.query(
        `UPDATE "InvVoucher" SET "branchId" = $1 WHERE "branchId" IS NULL`,
        [defaultBranchId]
    );
    console.log(`[2/3] InvVoucher rows backfilled: ${v.rowCount}`);

    // 3. Backfill InvStockLedger.branchId
    const l = await pool.query(
        `UPDATE "InvStockLedger" SET "branchId" = $1 WHERE "branchId" IS NULL`,
        [defaultBranchId]
    );
    console.log(`      InvStockLedger rows backfilled: ${l.rowCount}\n`);

    // 4. Upsert InvProductBranch from existing InvProduct.stock
    const p = await pool.query(
        `INSERT INTO "inv_product_branches" ("productId", "branchId", stock, "updatedAt")
         SELECT id, $1, COALESCE(stock, 0), NOW()
         FROM "InvProduct"
         WHERE stock IS NOT NULL
         ON CONFLICT ("productId", "branchId") DO UPDATE SET stock = EXCLUDED.stock, "updatedAt" = NOW()`,
        [defaultBranchId]
    );
    console.log(`[3/3] InvProductBranch rows upserted: ${p.rowCount}\n`);

    // Sanity: counts
    const counts = await pool.query<{ vouchers: string; ledger: string; pb: string }>(`
        SELECT
            (SELECT COUNT(*) FROM "InvVoucher" WHERE "branchId" IS NULL) AS vouchers,
            (SELECT COUNT(*) FROM "InvStockLedger" WHERE "branchId" IS NULL) AS ledger,
            (SELECT COUNT(*) FROM "inv_product_branches") AS pb
    `);
    const r = counts.rows[0]!;
    console.log("Sanity check:");
    console.log(`  InvVoucher with NULL branchId:     ${r.vouchers}   (should be 0)`);
    console.log(`  InvStockLedger with NULL branchId: ${r.ledger}   (should be 0)`);
    console.log(`  inv_product_branches rows:         ${r.pb}\n`);

    if (Number(r.vouchers) > 0 || Number(r.ledger) > 0) {
        throw new Error("Backfill did not cover all rows — investigate before enforcing NOT NULL.");
    }

    console.log("Backfill complete. Next: update schema to NOT NULL + run `npx prisma db push`.");
    await pool.end();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
