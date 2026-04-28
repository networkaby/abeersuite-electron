// Seed role ranks, sample branches, and sample departments.
// Run: npx tsx prisma/seed-org.ts

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

// Use DIRECT_URL (port 5432) for seeds — PgBouncer (6543) blocks DDL/seeds
const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, "");
const pool = new Pool({ connectionString: rawUrl, ssl: { rejectUnauthorized: false }, max: 1 });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as never) as PrismaClient;

async function main() {
    // ── Role ranks ───────────────────────────────────────────────────────────
    const rankMap: Record<string, number> = {
        R1: 100, // Admin
        R2: 70,  // Manager
        R3: 20,  // Technician
        R4: 20,  // Front Desk
    };

    for (const [id, rank] of Object.entries(rankMap)) {
        await prisma.role.updateMany({ where: { id }, data: { rank } });
        console.log(`  Role ${id} → rank ${rank}`);
    }

    // ── Branches ─────────────────────────────────────────────────────────────
    const branches = [
        { id: "BR-HQ",  name: "Head Office",     address: "Dhaka HQ",    phone: null,         isActive: true },
        { id: "BR-MIR", name: "Mirpur Branch",   address: "Mirpur, Dhaka", phone: null,        isActive: true },
        { id: "BR-CTG", name: "Chittagong Branch", address: "Chittagong", phone: null,         isActive: true },
        { id: "BR-ONL", name: "Online / Virtual", address: null,         phone: null,          isActive: true },
    ];

    for (const b of branches) {
        await prisma.branch.upsert({
            where: { id: b.id },
            update: { name: b.name, address: b.address, phone: b.phone, isActive: b.isActive },
            create: b,
        });
        console.log(`  Branch ${b.id}: ${b.name}`);
    }

    // ── Departments ──────────────────────────────────────────────────────────
    // Cross-branch departments (branchId: null) — exist in all locations
    const departments = [
        { id: "DEP-REPAIR", name: "Repairs",      description: "Device diagnosis and repair",          branchId: null },
        { id: "DEP-SALES",  name: "Sales",         description: "Sales and customer acquisition",       branchId: null },
        { id: "DEP-DESK",   name: "Front Desk",    description: "Customer intake, calls, and receipts", branchId: null },
        { id: "DEP-FIN",    name: "Finance",        description: "Accounts, invoices, and reporting",   branchId: null },
        { id: "DEP-HR",     name: "HR",             description: "People operations and recruitment",   branchId: null },
        { id: "DEP-IT",     name: "IT / Admin",     description: "Systems, infrastructure, and admin",  branchId: null },
        { id: "DEP-DESP",   name: "Despatch",       description: "Courier, logistics, and shipping",    branchId: null },
    ];

    for (const d of departments) {
        await prisma.department.upsert({
            where: { id: d.id },
            update: { name: d.name, description: d.description, branchId: d.branchId },
            create: d,
        });
        console.log(`  Department ${d.id}: ${d.name}`);
    }

    console.log("\n✅ Org seed complete.");
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
