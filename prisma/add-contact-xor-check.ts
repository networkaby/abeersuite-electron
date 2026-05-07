// Adds the XOR ownership CHECK constraint on Phone and Email tables.
// Each row must be owned by exactly one of (personId, companyId) — neither
// nor both. Prisma can't express this in the schema DSL, so we apply it
// after `db push` / migration via raw SQL. Idempotent.
//
// Run: npx tsx prisma/add-contact-xor-check.ts

import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/[?&]$/, "");

const pool = new Pool({ connectionString: rawUrl, ssl: { rejectUnauthorized: false }, max: 1 });

async function ensureCheck(table: "Phone" | "Email", constraintName: string) {
    const { rows } = await pool.query(
        `SELECT conname FROM pg_constraint WHERE conname = $1`,
        [constraintName],
    );
    if (rows.length > 0) {
        console.log(`  ~ ${constraintName}: already exists`);
        return;
    }
    await pool.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${constraintName}"
         CHECK (("personId" IS NULL) <> ("companyId" IS NULL))`,
    );
    console.log(`  + ${constraintName}: added`);
}

async function main() {
    console.log("\n── Contact XOR CHECK constraints ────────────────────────────────────────────");
    await ensureCheck("Phone", "Phone_owner_xor");
    await ensureCheck("Email", "Email_owner_xor");
    console.log("Done.\n");
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => pool.end());
