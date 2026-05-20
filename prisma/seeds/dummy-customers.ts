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

// ── Identity records (Person / Company fields only) ──────────────────────────

// Sundry Debtors — individual customers (persons)
const PERSONS = [
    { name: "Anita Sharma",  phone: "9810000001", email: "anita@example.com" },
    { name: "Rahul Verma",   phone: "9810000002", email: "rahul@example.com" },
    { name: "Priya Iyer",    phone: "9810000003", email: "priya@example.com" },
    { name: "Mohammed Khan", phone: "9810000004", email: "mkhan@example.com" },
    { name: "Sneha Patil",   phone: "9810000005", email: "sneha@example.com" },
];

// Sundry Debtors — business customers (companies)
const COMPANIES = [
    { name: "Acme Hardware Pvt Ltd",   phone: "01140000001", email: "ops@acme.example.com",         gstin: "07AAAAA0000A1Z5" },
    { name: "TechBridge Solutions",    phone: "01140000002", email: "info@techbridge.example.com",   gstin: null              },
    { name: "Sunrise Office Supplies", phone: "01140000003", email: "billing@sunrise.example.com",   gstin: null              },
];

// Sundry Creditors — suppliers we buy from on credit (identity only)
const SUPPLIERS = [
    { name: "Global Tech Distributors", phone: "01140000010", email: "sales@globaltech.example.com",    gstin: "07BBBBB0001B1Z5" },
    { name: "Prime Components Ltd",     phone: "01140000011", email: "orders@primecomp.example.com",    gstin: "07CCCCC0002C1Z5" },
    { name: "Rapid Supply Co",          phone: "01140000012", email: "billing@rapidsupply.example.com", gstin: null              },
];

// ── Account-level settings (creditLimit lives on Account, not on Person/Company) ──
// null = no limit enforced.
const ACCOUNT_CREDIT_LIMITS: Record<string, number | null> = {
    // Sundry Debtors — persons
    "Anita Sharma":  25000,
    "Rahul Verma":   50000,
    "Priya Iyer":    25000,
    "Mohammed Khan": 75000,
    "Sneha Patil":   10000,
    // Sundry Debtors — customer companies
    "Acme Hardware Pvt Ltd":   200000,
    "TechBridge Solutions":    100000,
    "Sunrise Office Supplies":  50000,
    // Sundry Creditors — supplier companies
    "Global Tech Distributors": 500000,
    "Prime Components Ltd":     300000,
    "Rapid Supply Co":          150000,
};

async function ensureAccount(
    entityId: number,
    name: string,
    field: "personId" | "companyId",
    groupId: number | null,
    creditLimit: number | null,
) {
    const existing = await pool.query<{ id: number }>(
        `SELECT id FROM "Account" WHERE "${field}" = $1 LIMIT 1`,
        [entityId],
    );
    if (existing.rows[0]) {
        // Update creditLimit on existing account (idempotent re-run)
        await pool.query(
            `UPDATE "Account" SET "creditLimit" = $1 WHERE "${field}" = $2`,
            [creditLimit, entityId],
        );
        return;
    }
    await pool.query(
        `INSERT INTO "Account" (name, "${field}", "groupId", balance, "creditLimit", "createdAt")
         VALUES ($1, $2, $3, 0, $4, NOW())`,
        [name, entityId, groupId, creditLimit],
    );
}

async function main() {
    console.log("\n⚠️  DUMMY DATA — sample Persons + Companies. Removed by pnpm seed:hard-clean.\n");

    // Resolve group ids for debtors and creditors.
    const [debtorRow, creditorRow] = await Promise.all([
        pool.query<{ id: number }>(`SELECT id FROM "AccountGroup" WHERE name = 'Sundry Debtors' LIMIT 1`),
        pool.query<{ id: number }>(`SELECT id FROM "AccountGroup" WHERE name = 'Sundry Creditors' LIMIT 1`),
    ]);
    const sundryDebtorsId: number | null  = debtorRow.rows[0]?.id   ?? null;
    const sundryCreditorId: number | null = creditorRow.rows[0]?.id ?? null;

    // ── Persons (Sundry Debtors) ──────────────────────────────────────────
    console.log(`[1/3] Persons — Sundry Debtors (${PERSONS.length})`);
    for (const p of PERSONS) {
        // Check if already exists by phone
        const existing = await pool.query<{ id: number }>(
            `SELECT p.id FROM "Person" p
             JOIN "Phone" ph ON ph."personId" = p.id
             WHERE ph.phone = $1 LIMIT 1`,
            [p.phone],
        );
        const limit = ACCOUNT_CREDIT_LIMITS[p.name] ?? null;
        if (existing.rows[0]) {
            const personId = existing.rows[0].id;
            await ensureAccount(personId, p.name, "personId", sundryDebtorsId, limit);
            console.log(`      ~ ${p.name} (already exists, account creditLimit updated)`);
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
        await ensureAccount(personId, p.name, "personId", sundryDebtorsId, limit);
        const limitStr = limit != null ? `₹${limit.toLocaleString("en-IN")}` : "none";
        console.log(`      + ${p.name} (${p.phone}, account creditLimit ${limitStr})`);
    }

    // ── Customer Companies (Sundry Debtors) ──────────────────────────────
    console.log(`\n[2/3] Customer Companies — Sundry Debtors (${COMPANIES.length})`);
    for (const c of COMPANIES) {
        const limit = ACCOUNT_CREDIT_LIMITS[c.name] ?? null;
        const existing = await pool.query<{ id: number }>(
            `SELECT id FROM "Company" WHERE name = $1 LIMIT 1`,
            [c.name],
        );
        if (existing.rows[0]) {
            const companyId = existing.rows[0].id;
            await ensureAccount(companyId, c.name, "companyId", sundryDebtorsId, limit);
            console.log(`      ~ ${c.name} (already exists, account creditLimit updated)`);
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
        await ensureAccount(companyId, c.name, "companyId", sundryDebtorsId, limit);
        const limitStr = limit != null ? `₹${limit.toLocaleString("en-IN")}` : "none";
        console.log(`      + ${c.name} (${c.phone}, account creditLimit ${limitStr})`);
    }

    // ── Supplier Companies (Sundry Creditors) ────────────────────────────
    console.log(`\n[3/3] Supplier Companies — Sundry Creditors (${SUPPLIERS.length})`);
    for (const s of SUPPLIERS) {
        const limit = ACCOUNT_CREDIT_LIMITS[s.name] ?? null;
        const existing = await pool.query<{ id: number }>(
            `SELECT id FROM "Company" WHERE name = $1 LIMIT 1`,
            [s.name],
        );
        if (existing.rows[0]) {
            const companyId = existing.rows[0].id;
            await ensureAccount(companyId, s.name, "companyId", sundryCreditorId, limit);
            console.log(`      ~ ${s.name} (already exists, account creditLimit updated)`);
            continue;
        }
        const ins = await pool.query<{ id: number }>(
            `INSERT INTO "Company" (name, gstin, "createdAt")
             VALUES ($1, $2, NOW()) RETURNING id`,
            [s.name, s.gstin],
        );
        const companyId = ins.rows[0].id;
        await pool.query(
            `INSERT INTO "Phone" (phone, "companyId", "isPrimary", "createdAt")
             VALUES ($1, $2, true, NOW())`,
            [s.phone, companyId],
        );
        await pool.query(
            `INSERT INTO "Email" (email, "companyId", "isPrimary", "createdAt")
             VALUES ($1, $2, true, NOW())`,
            [s.email, companyId],
        );
        await ensureAccount(companyId, s.name, "companyId", sundryCreditorId, limit);
        const limitStr = limit != null ? `₹${limit.toLocaleString("en-IN")}` : "none";
        console.log(`      + ${s.name} (${s.phone}, account creditLimit ${limitStr})`);
    }

    console.log("\n✅ Done.\n");
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => pool.end());
