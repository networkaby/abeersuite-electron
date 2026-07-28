/**
 * One-off applier — adds the "Credit Card" AccountGroup (Liability, under
 * "Loans (Liability)", sibling of "Bank OD A/c") to the live DB WITHOUT
 * running the full bootstrap seed.
 *
 * Mirrors the row added to `bootstrap-seed.ts` (the generic new-client
 * installer, which doesn't touch this DB directly — see prisma.config.ts).
 * Idempotent: safe to re-run, upserts by name.
 *
 * Run: `pnpm seed:apply-credit-card-group`. Delete this file (or clear it)
 * once the group exists — it's a one-shot scratchpad, not a record; the
 * seed (bootstrap-seed.ts) is the record.
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
        const parent = await prisma.accountGroup.findFirst({ where: { name: "Loans (Liability)" }, select: { id: true } });
        if (!parent) throw new Error('Parent group "Loans (Liability)" not found — is the chart of accounts seeded?');

        const existing = await prisma.accountGroup.findFirst({ where: { name: "Credit Card" }, select: { id: true } });
        if (existing) {
            await prisma.accountGroup.update({
                where: { id: existing.id },
                data: { type: "LIABILITY", parentId: parent.id, sortOrder: 15 },
            });
            console.log(`✓ "Credit Card" group already existed (id ${existing.id}) — re-asserted type/parent/sortOrder.`);
        } else {
            const created = await prisma.accountGroup.create({
                data: { name: "Credit Card", type: "LIABILITY", parentId: parent.id, sortOrder: 15 },
            });
            console.log(`✓ Created "Credit Card" group (id ${created.id}) under "Loans (Liability)".`);
        }
    } finally {
        await pool.end();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
