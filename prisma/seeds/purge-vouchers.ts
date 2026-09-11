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
//   • POS counter sessions — shifts, cash drops, expenditures, handovers, receipts.
//     The COUNTERS and their settings are config and are left alone.
//
// With --comms it ALSO clears the communication history, which is NOT
// transaction data and is never touched by default:
//   • Call logs, internal chat (ChatRoom + members + messages), and the social
//     wall (WallPost + likes + comments).
// Opt-in because these are irreplaceable — a voucher can be re-entered from a
// paper invoice; a conversation cannot be re-had.
//
// LEAVES INTACT: chart of accounts, opening balances, products, customers,
// users, org settings, and master data like ServiceCenter.
//
// Run: pnpm seed:purge-vouchers [--comms] [--allow-remote]
// DESTRUCTIVE — every voucher / stock movement / repair ticket is gone after this.
//
// It refuses a non-local database unless --allow-remote is passed. Without that
// guard this script trusts whatever DIRECT_URL happens to hold, and a stray
// .env.local pointing at production would wipe the real books with no prompt,
// no confirmation and no undo.

import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/[?&]$/, "");

const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])/.test(rawUrl);
const withComms = process.argv.includes("--comms");
const allowRemote = process.argv.includes("--allow-remote");

// Say out loud what is about to be destroyed, and where. The host is the one
// detail worth being certain about, so it is printed every run, not just on error.
const target = rawUrl.replace(/^.*@/, "").replace(/\?.*$/, "") || "(none configured)";
console.log(`target: ${target}${isLocal ? "" : "  ← NOT LOCAL"}`);
if (!isLocal && !allowRemote) {
    console.error(
        `\nREFUSING: ${target} is not a local database, and this script TRUNCATEs without asking.\n` +
        `If you really mean to wipe a remote database, re-run with --allow-remote.\n`,
    );
    process.exit(1);
}

const pool = new Pool({ connectionString: rawUrl, ssl: isLocal ? false : { rejectUnauthorized: false }, max: 1 });

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
    // POS counter sessions. These are transaction rows like any other: a shift's
    // declared cash is only meaningful against the sales it was declared for, so
    // clearing the vouchers and leaving the shifts produces sessions that can never
    // reconcile again — and voucher links (openingContraVoucherId,
    // closingContraVoucherId, varianceJournalEntryId) left dangling. They were
    // missing from this list until 2026-09-11, when a Vyapar migration purged the
    // books and 24 shifts survived pointing at sales that no longer existed.
    // The counters themselves (pos_counters, pos_counter_payment_accounts,
    // pos_services) are CONFIG and are deliberately left alone.
    "pos_receipts",
    "pos_cash_drops",
    "pos_expenditures",
    "pos_handovers",
    "pos_shifts",
];

// Communication history — cleared only with --comms. Children are listed before
// parents for readability; TRUNCATE ... CASCADE would reach them anyway.
const COMMS_TABLES = [
    "Call",
    "ChatMessage",
    "ChatRoomMember",
    "ChatRoom",
    "WallPostLike",
    "WallPostComment",
    "WallPost",
];

async function main(): Promise<void> {
    console.log("Purging transaction tables …");

    const all = withComms ? [...TABLES, ...COMMS_TABLES] : TABLES;

    // Single TRUNCATE statement — atomic, fast, handles FKs in any order.
    const list = all.map((t) => `"${t}"`).join(", ");
    await pool.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
    for (const t of all) console.log(`  ✓ ${t}`);
    if (!withComms) console.log("  – calls / chat / wall left intact (pass --comms to clear them too)");

    // Loyalty and gift-card balances are CACHES over ledger rows that have just
    // cascaded away with the vouchers. Left alone they would claim points and
    // money with nothing behind them — a liability on the books that no ledger
    // can explain. Zero them so the replay rebuilds them honestly.
    const loy = await pool.query(`UPDATE "LoyaltyAccount" SET "totalEarned" = 0, "totalRedeemed" = 0`);
    console.log(`  ✓ LoyaltyAccount totals reset (${loy.rowCount} rows)`);
    const gc = await pool.query(`UPDATE "GiftCard" SET balance = 0`);
    console.log(`  ✓ GiftCard.balance reset (${gc.rowCount} rows)`);

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
