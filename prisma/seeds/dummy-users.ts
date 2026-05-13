// DUMMY DATA — 3 demo non-admin staff logins (tech / front / des).
// Admin is seeded by bootstrap-seed.ts (production), not here.
// Run only in dev. `pnpm seed:hard-clean` removes these.
// Run: pnpm seed:dummy-users  (npx tsx prisma/seeds/dummy-users.ts)

import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "");
const pool = new Pool({ connectionString: rawUrl, ssl: { rejectUnauthorized: false } });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const DEMO_USERS: { email: string; name: string; role: string; password: string }[] = [
    { email: "tech@networkservice.in",  name: "Technician", role: "R2", password: "tech123"  },
    { email: "front@networkservice.in", name: "Front Desk", role: "R3", password: "front123" },
    { email: "des@networkservice.in",   name: "Despatch",   role: "R4", password: "des123"   },
];

// Find or create a Cash-in-Hand ledger account for a cashier user.
// Per-staff tills are how POS shifts route cash receipts. Returns the
// account id so the caller can wire it onto User.tillAccountId.
async function ensureTillAccount(userName: string): Promise<number> {
    const name = `Cash – ${userName}`;
    const existing = await prisma.account.findFirst({
        where: { name, personId: null, companyId: null },
        select: { id: true },
    });
    if (existing) return existing.id;
    const group = await prisma.accountGroup.findFirst({
        where: { name: "Cash-in-Hand" },
        select: { id: true },
    });
    const created = await prisma.account.create({
        data: {
            name,
            normalBalance: "DEBIT",
            groupId: group?.id ?? null,
            isActive: true,
        },
        select: { id: true },
    });
    return created.id;
}

async function main() {
    console.log("\n⚠️  DUMMY DATA — demo users with predictable passwords. DO NOT run in production.\n");

    for (const u of DEMO_USERS) {
        const password = await bcrypt.hash(u.password, 10);
        const user = await prisma.user.upsert({
            where: { email: u.email },
            update: { role: u.role, name: u.name, password },
            create: {
                name: u.name,
                email: u.email,
                password,
                role: u.role,
            },
            select: { id: true, tillAccountId: true },
        });

        // Cashier roles (R3 Front Desk, R4 Despatch) get a personal till
        // under Cash-in-Hand. Skip if already assigned.
        if ((u.role === "R3" || u.role === "R4") && !user.tillAccountId) {
            const tillId = await ensureTillAccount(u.name);
            await prisma.user.update({
                where: { id: user.id },
                data:  { tillAccountId: tillId },
            });
            console.log(`  + ${u.email} (role ${u.role}) — password: ${u.password}  · till: Cash – ${u.name}`);
        } else {
            console.log(`  + ${u.email} (role ${u.role}) — password: ${u.password}`);
        }
    }

    console.log(`\n✅ Seeded ${DEMO_USERS.length} demo users.`);
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    });
