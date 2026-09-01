/**
 * Creates the BackupConfig singleton (row id=1) — run ONCE after `prisma db push`
 * adds the table, WITHOUT running the full bootstrap seed.
 *
 * Part of the scheduled-backup feature: `/api/cron/backup-due` reads this table live
 * every hour to decide whether today/this-hour is due. See
 * docs/backup-schedule-activation.md for the full checklist.
 *
 * Defaults are every day at 10 PM IST — a schedule that is safe rather than clever,
 * on the reasoning that a row created by accident should still back the shop up.
 * Change it from Settings → Backup & Restore, not here.
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
            `✓ BackupConfig ready — enabled=${row.enabled} days=[${row.weekdays.join(",")}] hours=[${row.hours.join(",")}] (IST)`,
        );
    } finally {
        await pool.end();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
