// Seed Tally-style account groups + standard GL ledger accounts.
// Idempotent — safe to run multiple times.
// Run: pnpm seed:accounts  (npx tsx prisma/seeds/accounts.ts)

import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/[?&]$/, "");

const pool = new Pool({ connectionString: rawUrl, ssl: { rejectUnauthorized: false }, max: 1 });

type GroupType = "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE";
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

// Resolves group by name, then upserts the ledger:
//   - if a row with the same name (case-insensitive) exists, update its groupId
//     and code (when missing) so legacy rows pick up the merge
//   - otherwise insert a fresh row
async function upsertLedger(
    name: string,
    groupName: string | null,
    normalBalance: NormBal | null,
    code?: string,
): Promise<void> {
    let groupId: number | null = null;
    if (groupName) {
        const { rows } = await pool.query<{ id: number }>(
            `SELECT id FROM "AccountGroup" WHERE name = $1 LIMIT 1`,
            [groupName],
        );
        groupId = rows[0]?.id ?? null;
    }

    const { rows } = await pool.query<{ id: number; "groupId": number | null; code: string | null }>(
        `SELECT id, "groupId", code FROM "Account"
         WHERE LOWER(name) = LOWER($1)
           AND "personId" IS NULL AND "companyId" IS NULL
         LIMIT 1`,
        [name],
    );

    if (rows[0]) {
        const updates: string[] = [];
        const vals: unknown[] = [];
        if (rows[0].groupId === null && groupId !== null) {
            vals.push(groupId);
            updates.push(`"groupId" = $${vals.length}`);
        }
        if (rows[0].code === null && code) {
            vals.push(code);
            updates.push(`code = $${vals.length}`);
        }
        if (updates.length) {
            vals.push(rows[0].id);
            await pool.query(
                `UPDATE "Account" SET ${updates.join(", ")} WHERE id = $${vals.length}`,
                vals,
            );
            console.log(`  ↻ Ledger:  ${name} → ${updates.join(" + ")}`);
        } else {
            console.log(`  ~ Ledger:  ${name} (already exists)`);
        }
        return;
    }

    await pool.query(
        `INSERT INTO "Account" (name, code, "normalBalance", "groupId", "isActive", balance, "createdAt")
         VALUES ($1, $2, $3, $4, true, 0, NOW())`,
        [name, code ?? null, normalBalance, groupId],
    );
    console.log(`  + Ledger:  ${name}${code ? ` (${code})` : ""}`);
}

// Map US-style legacy names → Tally names. When both rows exist we keep the
// Tally one (transfer code + journal/voucher lines, delete the US row).
// When only the US row exists we just rename it.
const LEGACY_RENAMES: Array<{ from: string; to: string }> = [
    { from: "Owner's Capital",  to: "Capital" },
    { from: "Service Revenue",  to: "Service Charges Income" },
    { from: "Rent Expense",     to: "Rent" },
    { from: "Salaries Expense", to: "Salary & Wages" },
];

async function migrateLegacyNames() {
    for (const { from, to } of LEGACY_RENAMES) {
        const fromRow = await pool.query<{ id: number; code: string | null }>(
            `SELECT id, code FROM "Account"
             WHERE LOWER(name) = LOWER($1) AND "personId" IS NULL AND "companyId" IS NULL
             LIMIT 1`,
            [from],
        );
        if (!fromRow.rows[0]) continue;

        const toRow = await pool.query<{ id: number; code: string | null }>(
            `SELECT id, code FROM "Account"
             WHERE LOWER(name) = LOWER($1) AND "personId" IS NULL AND "companyId" IS NULL
             LIMIT 1`,
            [to],
        );

        if (toRow.rows[0]) {
            // Clear FROM code first to avoid unique conflict, then move it to TO
            if (fromRow.rows[0].code && !toRow.rows[0].code) {
                await pool.query(`UPDATE "Account" SET code = NULL WHERE id = $1`, [fromRow.rows[0].id]);
                await pool.query(`UPDATE "Account" SET code = $1 WHERE id = $2`, [fromRow.rows[0].code, toRow.rows[0].id]);
            }
            // Move any GL lines pointing at the legacy account
            await pool.query(`UPDATE "JournalLine" SET "accountId" = $1 WHERE "accountId" = $2`, [toRow.rows[0].id, fromRow.rows[0].id]);
            await pool.query(`UPDATE "VoucherLine" SET "accountId" = $1 WHERE "accountId" = $2`, [toRow.rows[0].id, fromRow.rows[0].id]);
            await pool.query(`DELETE FROM "Account" WHERE id = $1`, [fromRow.rows[0].id]);
            console.log(`  → "${from}" merged into "${to}"`);
        } else {
            await pool.query(`UPDATE "Account" SET name = $1 WHERE id = $2`, [to, fromRow.rows[0].id]);
            console.log(`  → "${from}" renamed to "${to}"`);
        }
    }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    // ── Step 0: Migrate legacy US-style names → Tally names ──────────────────
    console.log("\n── Legacy name migration ────────────────────────────────────────────────────");
    await migrateLegacyNames();

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

    // ── Step 2: Account Groups (28 standard Tally groups) ─────────────────────
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
    const salesAccountsId      = await upsertGroup("Sales Accounts",         "INCOME",    100);
    const purchaseAccountsId   = await upsertGroup("Purchase Accounts",      "EXPENSE",   110);
    const directIncomesId      = await upsertGroup("Direct Incomes",         "INCOME",    120);
    const directExpensesId     = await upsertGroup("Direct Expenses",        "EXPENSE",   130);
    const indirectIncomesId    = await upsertGroup("Indirect Incomes",       "INCOME",    140);
    const indirectExpensesId   = await upsertGroup("Indirect Expenses",      "EXPENSE",   150);

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

    // ── Step 3: Backfill customer & company accounts → Sundry Debtors ────────
    console.log("\n── Backfill customer & company accounts → Sundry Debtors ──────────────────");
    const upd = await pool.query(
        `UPDATE "Account" SET "groupId" = $1
         WHERE ("personId" IS NOT NULL OR "companyId" IS NOT NULL)
           AND "groupId" IS NULL`,
        [sundryDebtorsId],
    );
    console.log(`  ✓ Backfilled ${upd.rowCount} account(s)`);

    // ── Step 4: Standard GL Ledger Accounts ───────────────────────────────────
    // Codes preserved from legacy US-style chart so existing code paths
    // (post-invoice-je.ts, order-status.ts, PartyPicker) keep resolving.
    console.log("\n── Standard GL Ledgers ──────────────────────────────────────────────────────");

    // Cash & Bank
    await upsertLedger("Cash",                    "Cash-in-Hand",      "DEBIT",  "1000");
    await upsertLedger("Petty Cash",              "Cash-in-Hand",      "DEBIT");
    await upsertLedger("Bank Account",            "Bank Accounts",     "DEBIT",  "1010");

    // Sundry Debtors / Creditors (legacy generic accounts; per-party Tally
    // accounts created automatically when a Person/Company is added)
    await upsertLedger("Accounts Receivable",     "Sundry Debtors",    "DEBIT",  "1100");
    await upsertLedger("Accounts Payable",        "Sundry Creditors",  "CREDIT", "2000");
    await upsertLedger("Walk-in Cash Customer",   "Sundry Debtors",    "DEBIT",  "CASH-WALKIN");

    // Inventory & prepaid / advances
    await upsertLedger("Current Stock",           "Stock-in-Hand",     "DEBIT");
    await upsertLedger("Parts Inventory",         "Stock-in-Hand",     "DEBIT",  "1200");
    await upsertLedger("Prepaid Expenses",        "Loans & Advances (Asset)", "DEBIT", "1300");

    // Equity / Capital
    await upsertLedger("Profit & Loss A/c",       null,                "CREDIT");
    await upsertLedger("Capital",                 "Capital Account",   "CREDIT", "3000");
    await upsertLedger("Drawings",                "Capital Account",   "DEBIT");
    await upsertLedger("Retained Earnings",       "Reserves & Surplus", "CREDIT", "3100");

    // Sales / Purchase
    await upsertLedger("Sales A/c",               "Sales Accounts",    "CREDIT");
    await upsertLedger("Parts Revenue",           "Sales Accounts",    "CREDIT", "4100");
    await upsertLedger("Shop Sales Revenue",      "Sales Accounts",    "CREDIT", "4150");
    await upsertLedger("Purchase A/c",            "Purchase Accounts", "DEBIT");
    await upsertLedger("Sales Returns",           "Sales Accounts",    "DEBIT");
    await upsertLedger("Purchase Returns",        "Purchase Accounts", "CREDIT");

    // Tax (component-wise + legacy generic Tax Payable)
    await upsertLedger("CGST",                    "Duties & Taxes",    "CREDIT");
    await upsertLedger("SGST",                    "Duties & Taxes",    "CREDIT");
    await upsertLedger("IGST",                    "Duties & Taxes",    "CREDIT");
    await upsertLedger("UTGST",                   "Duties & Taxes",    "CREDIT");
    await upsertLedger("TDS",                     "Duties & Taxes",    "CREDIT");
    await upsertLedger("Tax Payable",             "Duties & Taxes",    "CREDIT", "2100");
    await upsertLedger("Professional Tax",        "Duties & Taxes",    "CREDIT");
    await upsertLedger("ESI Payable",             "Duties & Taxes",    "CREDIT");
    await upsertLedger("PF Payable",              "Duties & Taxes",    "CREDIT");

    // Provisions & accruals
    await upsertLedger("Accrued Expenses",        "Provisions",        "CREDIT", "2200");
    await upsertLedger("Provision for Tax",       "Provisions",        "CREDIT");
    await upsertLedger("Provision for Bad Debts", "Provisions",        "CREDIT");
    await upsertLedger("General Reserve",         "Reserves & Surplus", "CREDIT");

    // Direct Incomes
    await upsertLedger("Service Charges Income",  "Direct Incomes",    "CREDIT", "4000");
    await upsertLedger("Warranty Revenue",        "Direct Incomes",    "CREDIT", "4200");

    // Indirect Incomes
    await upsertLedger("Other Revenue",           "Indirect Incomes",  "CREDIT", "4900");
    await upsertLedger("Discount Received",       "Indirect Incomes",  "CREDIT");
    await upsertLedger("Round Off",               "Indirect Incomes",  "CREDIT");
    await upsertLedger("Interest Received",       "Indirect Incomes",  "CREDIT");
    await upsertLedger("Commission Received",     "Indirect Incomes",  "CREDIT");

    // Direct Expenses
    await upsertLedger("Cost of Parts Sold",      "Direct Expenses",   "DEBIT",  "5000");
    await upsertLedger("Tools & Equipment",       "Direct Expenses",   "DEBIT",  "6300");
    await upsertLedger("Repair & Maintenance",    "Direct Expenses",   "DEBIT");
    await upsertLedger("Consumables & Spares",    "Direct Expenses",   "DEBIT");
    await upsertLedger("Freight Charges",         "Direct Expenses",   "DEBIT");
    await upsertLedger("Carriage Inward",         "Direct Expenses",   "DEBIT");

    // Indirect Expenses
    await upsertLedger("Salary & Wages",          "Indirect Expenses", "DEBIT",  "6200");
    await upsertLedger("Rent",                    "Indirect Expenses", "DEBIT",  "6000");
    await upsertLedger("Utilities Expense",       "Indirect Expenses", "DEBIT",  "6100");
    await upsertLedger("Miscellaneous Expense",   "Indirect Expenses", "DEBIT",  "6900");
    await upsertLedger("Electricity Charges",     "Indirect Expenses", "DEBIT");
    await upsertLedger("Telephone / Internet",    "Indirect Expenses", "DEBIT");
    await upsertLedger("Discount Allowed",        "Indirect Expenses", "DEBIT");
    await upsertLedger("Bad Debts",               "Indirect Expenses", "DEBIT");
    await upsertLedger("Bank Charges",            "Indirect Expenses", "DEBIT");
    await upsertLedger("Audit Fees",              "Indirect Expenses", "DEBIT");
    await upsertLedger("Printing & Stationery",   "Indirect Expenses", "DEBIT");
    await upsertLedger("Postage & Courier",       "Indirect Expenses", "DEBIT");
    await upsertLedger("Advertisement",           "Indirect Expenses", "DEBIT");
    await upsertLedger("Travelling Expenses",     "Indirect Expenses", "DEBIT");
    await upsertLedger("Insurance",               "Indirect Expenses", "DEBIT");
    await upsertLedger("Depreciation",            "Indirect Expenses", "DEBIT");
    await upsertLedger("Interest Paid",           "Indirect Expenses", "DEBIT");
    await upsertLedger("Commission Paid",         "Indirect Expenses", "DEBIT");

    // Fixed Assets
    await upsertLedger("Furniture & Fixtures",       "Fixed Assets",   "DEBIT");
    await upsertLedger("Computer & Peripherals",     "Fixed Assets",   "DEBIT");
    await upsertLedger("Office Equipment",           "Fixed Assets",   "DEBIT");
    await upsertLedger("Plant & Machinery",          "Fixed Assets",   "DEBIT");
    await upsertLedger("CCTV & Security Equipment", "Fixed Assets",    "DEBIT");

    // Deposits & Advances
    await upsertLedger("Security Deposit",        "Deposits (Asset)",        "DEBIT");
    await upsertLedger("Earnest Money Deposit",   "Deposits (Asset)",        "DEBIT");
    await upsertLedger("Staff Advance",           "Loans & Advances (Asset)", "DEBIT");
    await upsertLedger("Advance to Suppliers",    "Loans & Advances (Asset)", "DEBIT");
    await upsertLedger("TDS Receivable",          "Loans & Advances (Asset)", "DEBIT");

    // Misc. Expenses (Asset)
    await upsertLedger("Preliminary Expenses",    "Misc. Expenses (Asset)",  "DEBIT");

    // Suspense — opening-balance imbalance auto-parks here so the trial
    // balance ties; reports show a banner prompting reconciliation.
    await upsertLedger("Difference in Opening Balances", "Suspense A/c", "CREDIT");

    console.log("\nDone.\n");
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => pool.end());
