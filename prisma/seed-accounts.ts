// Seed Tally-style default account groups and standard GL ledger accounts.
// Idempotent — safe to run multiple times.
// Run: npx tsx prisma/seed-accounts.ts

import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/[?&]$/, "");

const pool = new Pool({ connectionString: rawUrl, ssl: { rejectUnauthorized: false }, max: 1 });

type GroupType = "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE";
type GlType    = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
type NormBal   = "DEBIT" | "CREDIT";

// ── Helpers ───────────────────────────────────────────────────────────────────

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
        console.log(`  ↻ Group:   ${name} (type=${type})`);
        return rows[0].id;
    }
    const ins = await pool.query<{ id: number }>(
        `INSERT INTO "AccountGroup" (name, type, "sortOrder", "parentId", "isActive")
         VALUES ($1, $2, $3, $4, true) RETURNING id`,
        [name, type, sortOrder, parentId ?? null],
    );
    console.log(`  + Group:   ${name}`);
    return ins.rows[0].id;
}

async function upsertLedger(
    name: string,
    groupName: string | null,
    type: GlType | null,
    normalBalance: NormBal | null,
): Promise<void> {
    // Resolve groupId
    let groupId: number | null = null;
    if (groupName) {
        const { rows } = await pool.query<{ id: number }>(
            `SELECT id FROM "AccountGroup" WHERE name = $1 LIMIT 1`,
            [groupName],
        );
        groupId = rows[0]?.id ?? null;
    }

    // Check if ledger already exists (GL accounts only)
    const { rows } = await pool.query<{ id: number; "groupId": number | null }>(
        `SELECT id, "groupId" FROM "Account"
         WHERE LOWER(name) = LOWER($1)
           AND "personId" IS NULL AND "companyId" IS NULL
         LIMIT 1`,
        [name],
    );

    if (rows[0]) {
        // Update groupId if it was null (repair unmapped accounts)
        if (rows[0].groupId === null && groupId !== null) {
            await pool.query(
                `UPDATE "Account" SET "groupId" = $1 WHERE id = $2`,
                [groupId, rows[0].id],
            );
            console.log(`  ↻ Ledger:  ${name} → mapped to ${groupName}`);
        } else {
            console.log(`  ~ Ledger:  ${name} (already exists)`);
        }
        return;
    }

    await pool.query(
        `INSERT INTO "Account" (name, type, "normalBalance", "groupId", "isActive", balance, "createdAt")
         VALUES ($1, $2, $3, $4, true, 0, NOW())`,
        [name, type, normalBalance, groupId],
    );
    console.log(`  + Ledger:  ${name}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    // ── Step 1: Remove duplicate GL accounts (keep lowest id) ─────────────────
    console.log("\n── Deduplication ────────────────────────────────────────────────────────────");
    const del = await pool.query(`
        DELETE FROM "Account"
        WHERE id NOT IN (
            SELECT MIN(id)
            FROM "Account"
            WHERE "personId" IS NULL AND "companyId" IS NULL
            GROUP BY LOWER(name)
        )
        AND "personId" IS NULL
        AND "companyId" IS NULL
    `);
    console.log(`  ✓ Removed ${del.rowCount} duplicate GL account(s)`);

    // ── Step 2: Account Groups ─────────────────────────────────────────────────
    console.log("\n── Account Groups ───────────────────────────────────────────────────────────");

    // Primary groups
    const capitalAccountId     = await upsertGroup("Capital Account",        "LIABILITY", 10);
    const loansLiabilityId     = await upsertGroup("Loans (Liability)",      "LIABILITY", 20);
    const currentLiabilitiesId = await upsertGroup("Current Liabilities",    "LIABILITY", 30);
    const fixedAssetsId        = await upsertGroup("Fixed Assets",           "ASSET",     40);
    const investmentsId        = await upsertGroup("Investments",            "ASSET",     50);
    const currentAssetsId      = await upsertGroup("Current Assets",         "ASSET",     60);
    const branchDivisionsId    = await upsertGroup("Branch / Divisions",     "ASSET",     70);
    const miscExpensesId       = await upsertGroup("Misc. Expenses (Asset)", "ASSET",     80);
    const suspenseId           = await upsertGroup("Suspense A/c",           "ASSET",     90);
    // Income/Expense primary groups — corrected types
    const salesAccountsId      = await upsertGroup("Sales Accounts",         "INCOME",    100);
    const purchaseAccountsId   = await upsertGroup("Purchase Accounts",      "EXPENSE",   110);
    const directIncomesId      = await upsertGroup("Direct Incomes",         "INCOME",    120);
    const directExpensesId     = await upsertGroup("Direct Expenses",        "EXPENSE",   130);
    const indirectIncomesId    = await upsertGroup("Indirect Incomes",       "INCOME",    140);
    const indirectExpensesId   = await upsertGroup("Indirect Expenses",      "EXPENSE",   150);

    // Suppress unused-variable warnings
    void fixedAssetsId; void investmentsId; void branchDivisionsId;
    void miscExpensesId; void suspenseId;
    void salesAccountsId; void purchaseAccountsId;
    void directIncomesId; void directExpensesId;
    void indirectIncomesId; void indirectExpensesId;

    // Sub-groups under Capital Account
    await upsertGroup("Reserves & Surplus",       "LIABILITY", 10, capitalAccountId);

    // Sub-groups under Loans (Liability)
    await upsertGroup("Bank OD A/c",              "LIABILITY", 10, loansLiabilityId);
    await upsertGroup("Secured Loans",            "LIABILITY", 20, loansLiabilityId);
    await upsertGroup("Unsecured Loans",          "LIABILITY", 30, loansLiabilityId);

    // Sub-groups under Current Liabilities
    await upsertGroup("Duties & Taxes",           "LIABILITY", 10, currentLiabilitiesId);
    await upsertGroup("Provisions",               "LIABILITY", 20, currentLiabilitiesId);
    await upsertGroup("Sundry Creditors",         "LIABILITY", 30, currentLiabilitiesId);

    // Sub-groups under Current Assets
    await upsertGroup("Stock-in-Hand",            "ASSET",     10, currentAssetsId);
    await upsertGroup("Deposits (Asset)",         "ASSET",     20, currentAssetsId);
    await upsertGroup("Loans & Advances (Asset)", "ASSET",     30, currentAssetsId);
    const sundryDebtorsId = await upsertGroup("Sundry Debtors", "ASSET", 40, currentAssetsId);
    await upsertGroup("Cash-in-Hand",             "ASSET",     50, currentAssetsId);
    await upsertGroup("Bank Accounts",            "ASSET",     60, currentAssetsId);

    // ── Step 3: Backfill customer & company accounts → Sundry Debtors ───────────
    // All buyers (individuals and corporates) are Sundry Debtors.
    // Suppliers will be placed under Sundry Creditors manually when needed.
    console.log("\n── Backfill customer & company accounts → Sundry Debtors ──────────────────");
    const upd = await pool.query(
        `UPDATE "Account" SET "groupId" = $1
         WHERE ("personId" IS NOT NULL OR "companyId" IS NOT NULL)
           AND "groupId" IS NULL`,
        [sundryDebtorsId],
    );
    console.log(`  ✓ Backfilled ${upd.rowCount} account(s)`);

    // ── Step 4: Standard GL Ledger Accounts ───────────────────────────────────
    console.log("\n── Standard GL Ledgers ──────────────────────────────────────────────────────");

    // Cash & Bank
    await upsertLedger("Cash",                    "Cash-in-Hand",      "ASSET",    "DEBIT");
    await upsertLedger("Petty Cash",              "Cash-in-Hand",      "ASSET",    "DEBIT");

    // Equity / Capital
    await upsertLedger("Profit & Loss A/c",       null,                "EQUITY",   "CREDIT");
    await upsertLedger("Capital",                 "Capital Account",   "LIABILITY","CREDIT");
    await upsertLedger("Drawings",                "Capital Account",   "LIABILITY","DEBIT");

    // Inventory
    await upsertLedger("Current Stock",           "Stock-in-Hand",     "ASSET",    "DEBIT");

    // Sales & Purchase
    await upsertLedger("Sales A/c",               "Sales Accounts",    "REVENUE",  "CREDIT");
    await upsertLedger("Purchase A/c",            "Purchase Accounts", "EXPENSE",  "DEBIT");

    // Tax (component-wise; no "GST Payable" — used in both purchase & sale)
    await upsertLedger("CGST",                    "Duties & Taxes",    "LIABILITY","CREDIT");
    await upsertLedger("SGST",                    "Duties & Taxes",    "LIABILITY","CREDIT");
    await upsertLedger("IGST",                    "Duties & Taxes",    "LIABILITY","CREDIT");
    await upsertLedger("TDS",                     "Duties & Taxes",    "LIABILITY","CREDIT");

    // Indirect Expenses
    await upsertLedger("Salary & Wages",          "Indirect Expenses", "EXPENSE",  "DEBIT");
    await upsertLedger("Rent",                    "Indirect Expenses", "EXPENSE",  "DEBIT");
    await upsertLedger("Electricity Charges",     "Indirect Expenses", "EXPENSE",  "DEBIT");
    await upsertLedger("Telephone / Internet",    "Indirect Expenses", "EXPENSE",  "DEBIT");
    await upsertLedger("Discount Allowed",        "Indirect Expenses", "EXPENSE",  "DEBIT");
    await upsertLedger("Bad Debts",               "Indirect Expenses", "EXPENSE",  "DEBIT");
    await upsertLedger("Miscellaneous Expense",   "Indirect Expenses", "EXPENSE",  "DEBIT");

    // Direct Expenses
    await upsertLedger("Repair & Maintenance",    "Direct Expenses",   "EXPENSE",  "DEBIT");
    await upsertLedger("Consumables & Spares",    "Direct Expenses",   "EXPENSE",  "DEBIT");

    // Income
    await upsertLedger("Service Charges Income",  "Direct Incomes",    "REVENUE",  "CREDIT");
    await upsertLedger("Discount Received",       "Indirect Incomes",  "REVENUE",  "CREDIT");

    // Round-off & misc adjustments (used by InvVoucher GL auto-post)
    await upsertLedger("Round Off",               "Indirect Incomes",  "REVENUE",  "CREDIT");

    // Tally-style suspense ledger for opening-balance imbalance.
    // Reports compute Σ(opening Dr) − Σ(opening Cr) − Σ(opening stock); any non-zero
    // residual is presented as a virtual line on this account so the trial balance
    // ties, with a banner prompting the user to reconcile.
    await upsertLedger("Difference in Opening Balances", "Suspense A/c", "LIABILITY", "CREDIT");

    console.log("\nDone.\n");
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => pool.end());
