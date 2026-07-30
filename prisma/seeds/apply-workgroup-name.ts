/**
 * One-off backfill for WorkGroup.name — run ONCE after `prisma db push` adds the
 * column, WITHOUT running the full bootstrap seed.
 *
 * Why: `name` is the new internal admin-facing name (Settings → Groups) that tells
 * apart same-labeled groups (e.g. two "Calling" tags scoped to different
 * departments); `label` stays the display name shown to staff. New rows get `name`
 * from the create form; rows that existed before the column default to `""`. We
 * backfill those to their current `label` so existing groups aren't left with a
 * blank Group Name in Settings.
 *
 * Idempotent: only touches rows where name = ''. Safe to re-run.
 * After the DB is applied, this file may be deleted (the schema default is the record).
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
        const affected = await prisma.$executeRaw`
            UPDATE "WorkGroup" SET "name" = "label" WHERE "name" = ''
        `;
        console.log(`✓ Backfilled name on ${affected} work group(s).`);
    } finally {
        await pool.end();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
