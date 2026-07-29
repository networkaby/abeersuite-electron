/**
 * Incremental AccountGroup applier — adds the handful of new groups a recent
 * Usable Fund change needs, WITHOUT running the full bootstrap seed.
 *
 * Why: `pnpm prisma db seed` re-touches all master data and prunes — expensive
 * and risky on the live production DB. When a change only ADDS a couple of
 * groups, that whole pass is wasteful. This script upserts just the rows in
 * ADDITIONS (by name, matching bootstrap-seed.ts's own upsertGroup rule) —
 * idempotent, no prune, nothing else touched.
 *
 * "Payment Gateway" is NOT here — it already exists as a real-config group
 * (see personal.local.json), created before this feature existed.
 *
 * Requires the bnplJson / walletJson / gatewayJson columns to already exist
 * on Account (run `npx prisma db push` first) — this script only touches
 * AccountGroup rows, but the ledger create/edit UI that follows needs those
 * columns to actually save a BNPL/Wallet ledger's particulars.
 *
 * After the change ships and the DB is applied, ADDITIONS may be cleared (it
 * is a scratchpad, not a record — bootstrap-seed.ts is the record for future
 * new clients).
 */
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

type GroupType = "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE";

// The groups to add for the CURRENT change. parentName is resolved to an id
// at run time (must already exist — both do, seeded by bootstrap-seed.ts).
const ADDITIONS: { name: string; type: GroupType; sortOrder: number; parentName: string }[] = [
    { name: "BNPL A/c", type: "LIABILITY", sortOrder: 17, parentName: "Loans (Liability)" },
    { name: "Wallets", type: "ASSET", sortOrder: 65, parentName: "Current Assets" },
];

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
        let created = 0;
        for (const g of ADDITIONS) {
            const parent = await prisma.accountGroup.findFirst({ where: { name: g.parentName }, select: { id: true } });
            if (!parent) {
                console.warn(`  ⚠ skipped "${g.name}" — parent group "${g.parentName}" not found`);
                continue;
            }
            const existing = await prisma.accountGroup.findFirst({ where: { name: g.name }, select: { id: true } });
            if (existing) {
                await prisma.accountGroup.update({
                    where: { id: existing.id },
                    data: { type: g.type, sortOrder: g.sortOrder, parentId: parent.id },
                });
            } else {
                await prisma.accountGroup.create({
                    data: { name: g.name, type: g.type, sortOrder: g.sortOrder, parentId: parent.id },
                });
                created++;
            }
        }
        console.log(`✓ Applied ${ADDITIONS.length} group(s); created ${created} new.`);
    } finally {
        await pool.end();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
