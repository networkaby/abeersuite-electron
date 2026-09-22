/**
 * Ensure the four leave types exist. Targeted and idempotent — run it as often as
 * you like.
 *
 *   pnpm tsx prisma/seeds/ensure-leave-types.ts
 *
 * CREATES a missing type from the code defaults. It does NOT touch one that is
 * already there: the quota is master data the owner edits on Calendar & Hours, and
 * a seed that reasserted 12 every time would quietly undo his decision the next
 * time anybody reseeded. The one thing it will repair is a type that was somehow
 * left inactive, because an inactive type hides a kind that requests still carry.
 */

import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import { LEAVE_TYPE_DEFAULTS } from "../../src/shared/lib/hr/leaveTypeDefaults";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

// Same connection dance as the other seed scripts: the app's shared client is
// configured for the server and does not start in a CLI.
const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/[?&]$/, "");
const pool = new Pool({
    connectionString: rawUrl,
    ssl: /@(localhost|127\.0\.0\.1)/.test(rawUrl) ? false : { rejectUnauthorized: false },
    max: 2,
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
    let made = 0;
    let woken = 0;
    for (const d of LEAVE_TYPE_DEFAULTS) {
        const existing = await prisma.leaveType.findUnique({ where: { code: d.code } });
        if (!existing) {
            await prisma.leaveType.create({
                data: {
                    code: d.code, name: d.name, paid: d.paid,
                    yearlyQuota: d.yearlyQuota, noticeDays: d.noticeDays, sortOrder: d.sortOrder,
                },
            });
            made++;
            console.log(`  + ${d.code} — ${d.name}, ${d.yearlyQuota === null ? "no limit" : `${d.yearlyQuota} days`}`);
            continue;
        }
        if (!existing.active) {
            await prisma.leaveType.update({ where: { id: existing.id }, data: { active: true } });
            woken++;
            console.log(`  ~ ${d.code} — was inactive, switched back on`);
        }
    }
    const total = await prisma.leaveType.count({ where: { active: true } });
    console.log(`[leave-types] ${made} created, ${woken} reactivated, ${total} active in all.`);
}

main()
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
