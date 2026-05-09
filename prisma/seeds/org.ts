// Seed role ranks, branches, and departments.
// Depends on roles existing (run baseline first).
// Run: pnpm seed:org  (npx tsx prisma/seeds/org.ts)

import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/[?&]$/, "");

const pool = new Pool({ connectionString: rawUrl, ssl: { rejectUnauthorized: false }, max: 1 });

async function main() {
    // ── Role ranks ───────────────────────────────────────────────────────────
    const rankMap: Record<string, number> = {
        R1: 100, // Admin
        R2: 70,  // Manager
        R3: 20,  // Technician
        R4: 20,  // Front Desk
    };

    for (const [id, rank] of Object.entries(rankMap)) {
        const r = await pool.query(`UPDATE "Role" SET rank = $1 WHERE id = $2`, [rank, id]);
        console.log(`  Role ${id} → rank ${rank} (${r.rowCount} updated)`);
    }

    // ── Branches ─────────────────────────────────────────────────────────────
    const branches: Array<{ id: string; name: string; address: string | null; phone: string | null }> = [
        { id: "BR-HQ",  name: "Head Office",         address: "Dhaka HQ",      phone: null },
        { id: "BR-MIR", name: "Mirpur Branch",       address: "Mirpur, Dhaka", phone: null },
        { id: "BR-CTG", name: "Chittagong Branch",   address: "Chittagong",    phone: null },
        { id: "BR-ONL", name: "Online / Virtual",    address: null,             phone: null },
    ];

    for (const b of branches) {
        await pool.query(
            `INSERT INTO "Branch" (id, name, address, phone, "isActive")
             VALUES ($1, $2, $3, $4, true)
             ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, address = EXCLUDED.address, phone = EXCLUDED.phone, "isActive" = true`,
            [b.id, b.name, b.address, b.phone],
        );
        console.log(`  Branch ${b.id}: ${b.name}`);
    }

    // ── Departments (cross-branch; branchId NULL) ────────────────────────────
    const departments: Array<{ id: string; name: string; description: string }> = [
        { id: "DEP-REPAIR", name: "Repairs",     description: "Device diagnosis and repair" },
        { id: "DEP-SALES",  name: "Sales",       description: "Sales and customer acquisition" },
        { id: "DEP-DESK",   name: "Front Desk",  description: "Customer intake, calls, and receipts" },
        { id: "DEP-FIN",    name: "Finance",     description: "Accounts, invoices, and reporting" },
        { id: "DEP-HR",     name: "HR",          description: "People operations and recruitment" },
        { id: "DEP-IT",     name: "IT / Admin",  description: "Systems, infrastructure, and admin" },
        { id: "DEP-DESP",   name: "Despatch",    description: "Courier, logistics, and shipping" },
    ];

    for (const d of departments) {
        await pool.query(
            `INSERT INTO "Department" (id, name, description, "branchId")
             VALUES ($1, $2, $3, NULL)
             ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description`,
            [d.id, d.name, d.description],
        );
        console.log(`  Department ${d.id}: ${d.name}`);
    }

    console.log("\n✅ Org seed complete.");
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => pool.end());
