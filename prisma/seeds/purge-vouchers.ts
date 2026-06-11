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

const pool = new Pool({ connectionString: rawUrl, ssl: /@(localhost|127\.0\.0\.1)/.test(rawUrl) ? false : { rejectUnauthorized: false }, max: 1 });

// Ordered for clarity. CASCADE handles cross-table FKs (e.g. ShopOrder.invoiceId).
const TABLES = [
    // Repair tickets
    "TicketLog",
    "TicketParticipant",
    "Ticket",
    // GL side
    "JournalLine",
    "JournalEntry",
    // Voucher side
    "VoucherAllocation",
    "VoucherLine",
    "Voucher",
    // Inventory side
    "InvStockLedger",
    "InvVoucherLine",
    "InvVoucher",
    // AuditLog — unified recycle-bin (replaced the 3 *Audit tables 2026-06-09)
    "AuditLog",
    // Invoice / Payment family was dropped on 2026-05-24 (Invoice →
    // InvVoucher consolidation, Layer 5b) and no longer exists.
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

    // Reset every product to stock = 0 so Purchase increments actually move the
    // cache. (NULL + 1 = NULL in Postgres — see init-product-stock.ts comment.)
    await pool.query(`UPDATE "InvProduct" SET stock = 0`);
    console.log("  ✓ InvProduct.stock zeroed (all products)");

    console.log("Done. Books are now at opening-balance state.");
    await pool.end();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
