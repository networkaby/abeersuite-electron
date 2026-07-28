/**
 * One-shot data cleanup: clear Account.openingBalanceDate and
 * InvProduct.openingStockDate on every row that currently has one.
 *
 * Opening balance / opening stock is now a universal, date-less concept —
 * every figure is always effective from the start of the books, whether the
 * account/product was imported from another system or created fresh in the
 * app. The per-row date field is no longer collected anywhere in the UI or
 * API (see the ledger/product opening-balance forms and the customer/product
 * CSV importers); this script clears the leftover values that were captured
 * before that change, both from bulk imports and from manual entry.
 *
 * The column itself is NOT dropped — read paths (aggregateLedger.ts,
 * valuation.ts, costBasis.ts, balance.ts, …) already treat a null date as
 * "always applies, no cutover restriction", which is exactly the new
 * universal behaviour. Clearing the value is enough; no schema change.
 *
 * Idempotent — a second run finds nothing to update and does nothing.
 *
 * Run: pnpm tsx prisma/seeds/migrate-clear-opening-dates.ts
 */
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

async function main() {
    const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
        .replace(/[?&]sslmode=[^&]*/g, "")
        .replace(/[?&]$/, "");
    if (!rawUrl) throw new Error("No DIRECT_URL / DATABASE_URL in env");

    const pool = new Pool({
        connectionString: rawUrl,
        ssl: /@(localhost|127\.0\.0\.1)/.test(rawUrl) ? false : { rejectUnauthorized: false },
        max: 5,
    });
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

    try {
        const accounts = await prisma.account.updateMany({
            where: { openingBalanceDate: { not: null } },
            data: { openingBalanceDate: null },
        });
        const products = await prisma.invProduct.updateMany({
            where: { openingStockDate: { not: null } },
            data: { openingStockDate: null },
        });

        console.log(`✓ Cleared openingBalanceDate on ${accounts.count} account(s).`);
        console.log(`✓ Cleared openingStockDate on ${products.count} product(s).`);
    } finally {
        await pool.end();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
