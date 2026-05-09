// Wipe ALL transaction rows so the books reset to opening-balance state.
//
// Truncates (cascading): JournalEntry/JournalLine, Voucher/VoucherLine/
// VoucherAllocation, InvVoucher/InvVoucherLine/InvStockLedger, and their
// audit-snapshot tables. Resets sequences so the next reference numbers
// start fresh.
//
// LEAVES INTACT: chart of accounts, opening balances, products, customers,
// users, org settings.
//
// Run: pnpm seed:purge-vouchers
// DESTRUCTIVE — every voucher / JE / stock movement is gone after this.

import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/[?&]$/, "");

const pool = new Pool({ connectionString: rawUrl, ssl: { rejectUnauthorized: false }, max: 1 });

// Ordered for clarity. CASCADE handles cross-table FKs (e.g. ShopOrder.invoiceId).
const TABLES = [
    // GL side
    "JournalLine",
    "JournalEntry",
    "JournalEntryAudit",
    // Voucher side
    "VoucherAllocation",
    "VoucherLine",
    "Voucher",
    "VoucherAudit",
    // Inventory side
    "InvStockLedger",
    "InvVoucherLine",
    "InvVoucher",
    "InvVoucherAudit",
    // Invoice/payment side (POS path) — wipe so reports don't double-count
    "Payment",
    "PaymentAudit",
    "InvoiceLine",
    "Invoice",
    "InvoiceAudit",
];

async function main(): Promise<void> {
    console.log("Purging transaction tables …");

    // Single TRUNCATE statement — atomic, fast, handles FKs in any order.
    const list = TABLES.map((t) => `"${t}"`).join(", ");
    await pool.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
    for (const t of TABLES) console.log(`  ✓ ${t}`);

    // Reset cached running balances on Account (they were derived from
    // the now-gone JournalLines). Opening-balance fields are kept.
    await pool.query(`UPDATE "Account" SET balance = 0`);
    console.log("  ✓ Account.balance reset to 0");

    // Reset cached InvProduct.stock so Purchase vouchers can rebuild it.
    // null → "not tracked" — Purchase posting will increment from the
    // posting handler. We start tracked products at 0 so increments work.
    await pool.query(`UPDATE "InvProduct" SET stock = 0 WHERE stock IS NOT NULL`);
    console.log("  ✓ InvProduct.stock zeroed (tracked products only)");

    console.log("Done. Books are now at opening-balance state.");
    await pool.end();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
