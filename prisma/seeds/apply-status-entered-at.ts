/**
 * One-off backfill for Ticket.statusEnteredAt — run ONCE after `prisma db push`
 * adds the column, WITHOUT running the full bootstrap seed.
 *
 * Why: `statusEnteredAt` records when a ticket entered its CURRENT status, so the
 * status-resolve-time SLA (TicketStatus.resolveTimeHours) can flag overdue tickets
 * as "needs attention" in the Work Inbox. New rows get it via @default(now()); rows
 * that existed before the column have it NULL. We seed those to `updatedAt` — the
 * best available proxy for "last moved" — so existing tickets get a sane clock start
 * instead of counting from epoch (which would flag every old ticket at once).
 *
 * Idempotent: only touches rows where statusEnteredAt IS NULL. Safe to re-run.
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
        // Set statusEnteredAt = updatedAt wherever it's still NULL (pre-existing rows).
        // $executeRaw returns the affected-row count directly (a number).
        const affected = await prisma.$executeRaw`
            UPDATE "Ticket" SET "statusEnteredAt" = "updatedAt" WHERE "statusEnteredAt" IS NULL
        `;
        console.log(`✓ Backfilled statusEnteredAt on ${affected} ticket(s).`);
    } finally {
        await pool.end();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
