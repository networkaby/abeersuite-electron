/**
 * Creates the BackupConfig singleton (row id=1) — run ONCE after `prisma db push`
 * adds the table, WITHOUT running the full bootstrap seed.
 *
 * Part of the scheduled-backup feature, which is BUILT BUT NOT SWITCHED ON. Running
 * this script alone changes no behaviour: nothing reads the table until the cron
 * route is wired up. See docs/backup-schedule-activation.md for the full checklist.
 *
 * Defaults deliberately mirror what vercel.json does today — enabled, daily, 21:00
 * UTC (02:30 IST) — so that on the day scheduling is switched on, the schedule the
 * UI shows is the schedule that was already running. No surprise change of time.
 *
 * Idempotent: upsert on id=1, and update does nothing. Safe to re-run, and safe on
 * live — it will not overwrite a schedule an admin has since edited.
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
        const row = await prisma.backupConfig.upsert({
            where: { id: 1 },
            create: { id: 1 },
            update: {},
        });
        console.log(
            `✓ BackupConfig ready — enabled=${row.enabled} ${row.frequency} at ${String(row.hourUtc).padStart(2, "0")}:${String(row.minuteUtc).padStart(2, "0")} UTC`,
        );
    } finally {
        await pool.end();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
