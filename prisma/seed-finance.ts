import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "");
const pool = new Pool({ connectionString: rawUrl, ssl: { rejectUnauthorized: false } });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const CHART_OF_ACCOUNTS = [
    // ── ASSETS (normal balance: DEBIT) ─────────────────────────────────────────
    { code: "1000", name: "Cash",                 type: "ASSET",     normalBalance: "DEBIT",  description: "Physical cash and petty cash" },
    { code: "1010", name: "Bank Account",          type: "ASSET",     normalBalance: "DEBIT",  description: "Main business bank account" },
    { code: "1100", name: "Accounts Receivable",   type: "ASSET",     normalBalance: "DEBIT",  description: "Amounts owed by customers" },
    { code: "1200", name: "Parts Inventory",       type: "ASSET",     normalBalance: "DEBIT",  description: "Spare parts and components in stock" },
    { code: "1300", name: "Prepaid Expenses",      type: "ASSET",     normalBalance: "DEBIT",  description: "Prepaid rent, insurance, subscriptions" },
    // ── LIABILITIES (normal balance: CREDIT) ───────────────────────────────────
    { code: "2000", name: "Accounts Payable",      type: "LIABILITY", normalBalance: "CREDIT", description: "Amounts owed to suppliers" },
    { code: "2100", name: "Tax Payable",           type: "LIABILITY", normalBalance: "CREDIT", description: "VAT / sales tax collected from customers" },
    { code: "2200", name: "Accrued Expenses",      type: "LIABILITY", normalBalance: "CREDIT", description: "Expenses incurred but not yet paid" },
    // ── EQUITY (normal balance: CREDIT) ────────────────────────────────────────
    { code: "3000", name: "Owner's Capital",       type: "EQUITY",    normalBalance: "CREDIT", description: "Owner's investment in the business" },
    { code: "3100", name: "Retained Earnings",     type: "EQUITY",    normalBalance: "CREDIT", description: "Accumulated profits carried forward" },
    // ── REVENUE (normal balance: CREDIT) ───────────────────────────────────────
    { code: "4000", name: "Service Revenue",       type: "REVENUE",   normalBalance: "CREDIT", description: "Income from repair and service work" },
    { code: "4100", name: "Parts Revenue",         type: "REVENUE",   normalBalance: "CREDIT", description: "Income from parts sales" },
    { code: "4200", name: "Warranty Revenue",      type: "REVENUE",   normalBalance: "CREDIT", description: "Income from warranty claim work" },
    { code: "4900", name: "Other Revenue",         type: "REVENUE",   normalBalance: "CREDIT", description: "Miscellaneous income" },
    // ── EXPENSES (normal balance: DEBIT) ───────────────────────────────────────
    { code: "5000", name: "Cost of Parts Sold",    type: "EXPENSE",   normalBalance: "DEBIT",  description: "Cost of parts used in repairs" },
    { code: "6000", name: "Rent Expense",          type: "EXPENSE",   normalBalance: "DEBIT",  description: "Shop / office rent" },
    { code: "6100", name: "Utilities Expense",     type: "EXPENSE",   normalBalance: "DEBIT",  description: "Electricity, water, internet" },
    { code: "6200", name: "Salaries Expense",      type: "EXPENSE",   normalBalance: "DEBIT",  description: "Staff wages and salaries" },
    { code: "6300", name: "Tools & Equipment",     type: "EXPENSE",   normalBalance: "DEBIT",  description: "Tools, equipment and small asset purchases" },
    { code: "6900", name: "Miscellaneous Expense", type: "EXPENSE",   normalBalance: "DEBIT",  description: "Other business expenses" },
] as const;

async function main() {
    console.log("Seeding chart of accounts…");

    for (const account of CHART_OF_ACCOUNTS) {
        await prisma.glAccount.upsert({
            where: { code: account.code },
            update: { name: account.name, description: account.description },
            create: {
                code: account.code,
                name: account.name,
                type: account.type,
                normalBalance: account.normalBalance,
                description: account.description,
            },
        });
    }

    console.log(`✓ Seeded ${CHART_OF_ACCOUNTS.length} GL accounts`);
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
