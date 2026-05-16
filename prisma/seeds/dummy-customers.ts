// DUMMY DATA — sample Persons + Companies + Phones + Emails for testing
// party-linked vouchers, repair tickets, and shop orders.
// `pnpm seed:hard-clean` removes everything seeded here.
//
// Run: pnpm seed:dummy-customers

import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/[?&]$/, "");

const pool = new Pool({ connectionString: rawUrl, ssl: { rejectUnauthorized: false }, max: 1 });

const PERSONS = [
    { name: "Anita Sharma",   phone: "9810000001", email: "anita@example.com" },
    { name: "Rahul Verma",    phone: "9810000002", email: "rahul@example.com" },
    { name: "Priya Iyer",     phone: "9810000003", email: "priya@example.com" },
    { name: "Mohammed Khan",  phone: "9810000004", email: "mkhan@example.com" },
    { name: "Sneha Patil",    phone: "9810000005", email: "sneha@example.com" },
];

const COMPANIES = [
    { name: "Acme Hardware Pvt Ltd",       phone: "01140000001", email: "ops@acme.example.com",   gstin: "07AAAAA0000A1Z5" },
    { name: "TechBridge Solutions",        phone: "01140000002", email: "info@techbridge.example.com", gstin: null },
    { name: "Sunrise Office Supplies",     phone: "01140000003", email: "billing@sunrise.example.com", gstin: null },
];

async function ensureAccount(entityId: number, name: string, field: "personId" | "companyId", groupId: number | null) {
    const existing = await pool.query<{ id: number }>(
        `SELECT id FROM "Account" WHERE "${field}" = $1 LIMIT 1`,
        [entityId],
    );
    if (existing.rows[0]) return;
    await pool.query(
        `INSERT INTO "Account" (name, "${field}", "groupId", balance, "createdAt")
         VALUES ($1, $2, $3, 0, NOW())`,
        [name, entityId, groupId],
    );
}

async function main() {
    console.log("\n⚠️  DUMMY DATA — sample Persons + Companies. Removed by pnpm seed:hard-clean.\n");

    // Resolve Sundry Debtors group id (used for all customer ledger accounts).
    const groupRow = await pool.query<{ id: number }>(
        `SELECT id FROM "AccountGroup" WHERE name = 'Sundry Debtors' LIMIT 1`,
    );
    const sundryDebtorsId: number | null = groupRow.rows[0]?.id ?? null;

    // ── Persons ──────────────────────────────────────────────────────────
    console.log(`[1/2] Persons (${PERSONS.length})`);
    for (const p of PERSONS) {
        // Check if already exists by phone
        const existing = await pool.query<{ id: number }>(
            `SELECT p.id FROM "Person" p
             JOIN "Phone" ph ON ph."personId" = p.id
             WHERE ph.phone = $1 LIMIT 1`,
            [p.phone],
        );
        if (existing.rows[0]) {
            const personId = existing.rows[0].id;
            await ensureAccount(personId, p.name, "personId", sundryDebtorsId);
            console.log(`      ~ ${p.name} (already exists)`);
            continue;
        }
        const ins = await pool.query<{ id: number }>(
            `INSERT INTO "Person" (name, "createdAt")
             VALUES ($1, NOW()) RETURNING id`,
            [p.name],
        );
        const personId = ins.rows[0].id;
        await pool.query(
            `INSERT INTO "Phone" (phone, "personId", "isPrimary", "createdAt")
             VALUES ($1, $2, true, NOW())`,
            [p.phone, personId],
        );
        await pool.query(
            `INSERT INTO "Email" (email, "personId", "isPrimary", "createdAt")
             VALUES ($1, $2, true, NOW())`,
            [p.email, personId],
        );
        await ensureAccount(personId, p.name, "personId", sundryDebtorsId);
        console.log(`      + ${p.name} (${p.phone})`);
    }

    // ── Companies ────────────────────────────────────────────────────────
    console.log(`\n[2/2] Companies (${COMPANIES.length})`);
    for (const c of COMPANIES) {
        const existing = await pool.query<{ id: number }>(
            `SELECT id FROM "Company" WHERE name = $1 LIMIT 1`,
            [c.name],
        );
        if (existing.rows[0]) {
            const companyId = existing.rows[0].id;
            await ensureAccount(companyId, c.name, "companyId", sundryDebtorsId);
            console.log(`      ~ ${c.name} (already exists)`);
            continue;
        }
        const ins = await pool.query<{ id: number }>(
            `INSERT INTO "Company" (name, gstin, "createdAt")
             VALUES ($1, $2, NOW()) RETURNING id`,
            [c.name, c.gstin],
        );
        const companyId = ins.rows[0].id;
        await pool.query(
            `INSERT INTO "Phone" (phone, "companyId", "isPrimary", "createdAt")
             VALUES ($1, $2, true, NOW())`,
            [c.phone, companyId],
        );
        await pool.query(
            `INSERT INTO "Email" (email, "companyId", "isPrimary", "createdAt")
             VALUES ($1, $2, true, NOW())`,
            [c.email, companyId],
        );
        await ensureAccount(companyId, c.name, "companyId", sundryDebtorsId);
        console.log(`      + ${c.name} (${c.phone})`);
    }

    console.log("\n✅ Done.\n");
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => pool.end());
