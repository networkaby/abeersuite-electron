// Wipe ALL transaction rows so the books reset to opening-balance state.
//
// Truncates (RESTART IDENTITY CASCADE, so sequences and FK-dependent children
// go too) the current transaction model:
//   • Vouchers — the UniversalVoucher spine (the lone GL + document rep since
//     the JournalEntry/JournalLine and Voucher/VoucherLine drops) with its
//     VoucherGlLine / VoucherInventoryLine / VoucherDetail / VoucherLink lines
//     and VoucherAllocation bill-wise links.
//   • Inventory — InvStockLedger movements.
//   • Repair tickets — the merged Ticket + its 1:1 detail riders (TicketRepair,
//     TicketDeal, TicketOrder(+Line), TicketDelivery, TicketRefund), TicketLog,
//     TicketParticipant, and the per-intake Device (parent of TicketRepair, so
//     it does NOT cascade off Ticket — listed explicitly to avoid orphans).
//   • AuditLog — the unified recycle-bin (replaced the 3 *Audit tables 2026-06-09).
//
// LEAVES INTACT: chart of accounts, opening balances, products, customers,
// users, org settings, and master data like ServiceCenter.
//
// Run: pnpm seed:purge-vouchers
// DESTRUCTIVE — every voucher / stock movement / repair ticket is gone after this.

import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/[?&]$/, "");

const pool = new Pool({ connectionString: rawUrl, ssl: /@(localhost|127\.0\.0\.1)/.test(rawUrl) ? false : { rejectUnauthorized: false }, max: 1 });

// One TRUNCATE ... RESTART IDENTITY CASCADE handles cross-table FKs and ordering.
// Children that cascade off a listed parent (the Ticket riders off Ticket, the
// voucher lines off UniversalVoucher) are listed anyway to document the model and
// stay correct if a cascade rule ever changes. Device is the exception that MUST
// be listed — it is the parent of TicketRepair, so Ticket's cascade won't reach it.
const TABLES = [
    // Repair tickets — merged Ticket spine + its 1:1 detail riders + logs.
    "TicketLog",
    "TicketParticipant",
    "TicketOrderLine",
    "TicketRepair",
    "TicketDeal",
    "TicketOrder",
    "TicketDelivery",
    "TicketRefund",
    "Ticket",
    "Device",              // per-intake repair device (parent of TicketRepair — no cascade off Ticket)
    // GL side — the UniversalVoucher spine is the lone GL + document representation
    // since the JournalEntry/JournalLine and Voucher/VoucherLine drops. Its lines
    // (VoucherGlLine, VoucherInventoryLine, VoucherDetail, VoucherLink) cascade off it.
    "VoucherGlLine",
    "VoucherInventoryLine",
    "VoucherDetail",
    "VoucherLink",
    "VoucherAllocation",
    "UniversalVoucher",
    // Inventory side — stock movements.
    "InvStockLedger",
    // AuditLog — unified recycle-bin (replaced the 3 *Audit tables 2026-06-09).
    "AuditLog",
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
