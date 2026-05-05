// Seed Tally-style default account groups and backfill existing customer accounts.
// Run: npx tsx prisma/seed-accounts.ts

import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/[?&]$/, "");

const pool = new Pool({ connectionString: rawUrl, ssl: { rejectUnauthorized: false }, max: 1 });

type GroupType = "ASSET" | "LIABILITY";

async function upsertGroup(
    name: string,
    type: GroupType,
    sortOrder: number,
    parentId?: number,
): Promise<number> {
    const { rows } = await pool.query<{ id: number }>(
        `SELECT id FROM "AccountGroup" WHERE name = $1 LIMIT 1`,
        [name],
    );
    if (rows[0]) {
        await pool.query(
            `UPDATE "AccountGroup" SET type = $1, "sortOrder" = $2, "parentId" = $3 WHERE id = $4`,
            [type, sortOrder, parentId ?? null, rows[0].id],
        );
        console.log(`  ↻ Updated:  ${name}`);
        return rows[0].id;
    }
    const ins = await pool.query<{ id: number }>(
        `INSERT INTO "AccountGroup" (name, type, "sortOrder", "parentId", "isActive")
         VALUES ($1, $2, $3, $4, true) RETURNING id`,
        [name, type, sortOrder, parentId ?? null],
    );
    console.log(`  + Created:  ${name}`);
    return ins.rows[0].id;
}

async function main() {
    console.log("\n── Account Groups ───────────────────────────────────────────────────────────");

    // ── Primary groups ────────────────────────────────────────────────────────
    const capitalAccountId     = await upsertGroup("Capital Account",         "LIABILITY", 10);
    const loansLiabilityId     = await upsertGroup("Loans (Liability)",       "LIABILITY", 20);
    const currentLiabilitiesId = await upsertGroup("Current Liabilities",     "LIABILITY", 30);
    const fixedAssetsId        = await upsertGroup("Fixed Assets",            "ASSET",     40);
    const investmentsId        = await upsertGroup("Investments",             "ASSET",     50);
    const currentAssetsId      = await upsertGroup("Current Assets",          "ASSET",     60);
    const branchDivisionsId    = await upsertGroup("Branch / Divisions",      "ASSET",     70);
    const miscExpensesId       = await upsertGroup("Misc. Expenses (Asset)",  "ASSET",     80);
    const suspenseId           = await upsertGroup("Suspense A/c",            "ASSET",     90);
    const salesAccountsId      = await upsertGroup("Sales Accounts",          "LIABILITY", 100);
    const purchaseAccountsId   = await upsertGroup("Purchase Accounts",       "ASSET",     110);
    const directIncomesId      = await upsertGroup("Direct Incomes",          "LIABILITY", 120);
    const directExpensesId     = await upsertGroup("Direct Expenses",         "ASSET",     130);
    const indirectIncomesId    = await upsertGroup("Indirect Incomes",        "LIABILITY", 140);
    const indirectExpensesId   = await upsertGroup("Indirect Expenses",       "ASSET",     150);

    void fixedAssetsId; void investmentsId; void branchDivisionsId;
    void miscExpensesId; void suspenseId; void salesAccountsId;
    void purchaseAccountsId; void directIncomesId; void directExpensesId;
    void indirectIncomesId; void indirectExpensesId;

    // ── Sub-groups under Capital Account ──────────────────────────────────────
    await upsertGroup("Reserves & Surplus",        "LIABILITY", 10, capitalAccountId);

    // ── Sub-groups under Loans (Liability) ────────────────────────────────────
    await upsertGroup("Bank OD A/c",               "LIABILITY", 10, loansLiabilityId);
    await upsertGroup("Secured Loans",             "LIABILITY", 20, loansLiabilityId);
    await upsertGroup("Unsecured Loans",           "LIABILITY", 30, loansLiabilityId);

    // ── Sub-groups under Current Liabilities ──────────────────────────────────
    await upsertGroup("Duties & Taxes",            "LIABILITY", 10, currentLiabilitiesId);
    await upsertGroup("Provisions",                "LIABILITY", 20, currentLiabilitiesId);
    await upsertGroup("Sundry Creditors",          "LIABILITY", 30, currentLiabilitiesId);

    // ── Sub-groups under Current Assets ───────────────────────────────────────
    await upsertGroup("Stock-in-Hand",             "ASSET",     10, currentAssetsId);
    await upsertGroup("Deposits (Asset)",          "ASSET",     20, currentAssetsId);
    await upsertGroup("Loans & Advances (Asset)",  "ASSET",     30, currentAssetsId);
    const sundryDebtorsId = await upsertGroup("Sundry Debtors", "ASSET", 40, currentAssetsId);
    await upsertGroup("Cash-in-Hand",              "ASSET",     50, currentAssetsId);
    await upsertGroup("Bank Accounts",             "ASSET",     60, currentAssetsId);

    // ── Backfill existing customer accounts ───────────────────────────────────
    console.log("\n── Backfill customer accounts → Sundry Debtors ─────────────────────────────");
    const upd = await pool.query(
        `UPDATE "Account" SET "groupId" = $1
         WHERE "customerId" IS NOT NULL AND "groupId" IS NULL`,
        [sundryDebtorsId],
    );
    console.log(`  ✓ Backfilled ${upd.rowCount} customer accounts`);

    console.log("\nDone.\n");
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => pool.end());
