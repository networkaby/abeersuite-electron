// DUMMY DATA — 4 demo logins (admin/tech/front/des @networkservice.in).
// Run only in dev; remove manually before production.
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
    { email: "admin@networkservice.in", name: "Admin",      role: "R1", password: "admin123" },
    { email: "tech@networkservice.in",  name: "Technician", role: "R2", password: "tech123"  },
    { email: "front@networkservice.in", name: "Front Desk", role: "R3", password: "front123" },
    { email: "des@networkservice.in",   name: "Despatch",   role: "R4", password: "des123"   },
];

async function main() {
    console.log("\n⚠️  DUMMY DATA — demo users with predictable passwords. DO NOT run in production.\n");

    for (const u of DEMO_USERS) {
        const password = await bcrypt.hash(u.password, 10);
        await prisma.user.upsert({
            where: { email: u.email },
            update: { role: u.role, name: u.name, password },
            create: {
                name: u.name,
                email: u.email,
                password,
                role: u.role,
            },
        });
        console.log(`  + ${u.email} (role ${u.role}) — password: ${u.password}`);
    }

    console.log(`\n✅ Seeded ${DEMO_USERS.length} demo users.`);
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    });
