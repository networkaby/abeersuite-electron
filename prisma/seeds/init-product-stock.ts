// One-shot: change every InvProduct with stock=NULL to stock=0 so the
// post handlers' { increment } / { decrement } actually move the cache.
//
// Convention shift: previously null = "not tracked"; from now on every
// product is tracked from creation. New product creates default to 0
// (see src/app/api/inventory/products/route.ts and prisma/seeds/dummy-shop.ts).
//
// Run:  pnpm seed:init-product-stock
// Idempotent — safe to run multiple times.

import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/[?&]$/, "");

const pool = new Pool({ connectionString: rawUrl, ssl: { rejectUnauthorized: false }, max: 1 });

async function main(): Promise<void> {
    const r = await pool.query(`UPDATE "InvProduct" SET stock = 0 WHERE stock IS NULL`);
    console.log(`Initialised ${r.rowCount ?? 0} product(s) to stock = 0`);
    await pool.end();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
