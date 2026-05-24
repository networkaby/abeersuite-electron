// HARD database clean — returns DB to exact bootstrap-seed state.
//
// Wipes everything `bootstrap-seed.ts` does NOT seed:
//   • All transactions (vouchers, JEs, invoices, payments, allocations + audits)
//   • All inventory vouchers + stock-ledger entries + their audits
//   • All shop orders, repair tickets, CRM leads, social posts, chat
//   • All non-admin Users (only admin@networkservice.in survives)
//   • All Persons / Companies / Phones / Emails (test customers)
//   • All party-linked Account rows (customer/company personal ledgers)
//   • All InvProduct catalog + InvCategory/Group/WarrantyTerm
//     (none of these are bootstrap data — they come from dummy-shop)
//   • InvAttributeMaster rows (category-specific attrs seeded by dummy-shop)
//   • ServiceCenter, ShopCoupon, PortalCredentials
//
// Preserves (everything bootstrap-seed.ts wrote, plus user-set config):
//   • Admin user (admin@networkservice.in)
//   • Roles, Permissions, RolePermissions
//   • Branches, Departments, UserPositions
//   • Pipelines, TicketStatus, TicketSubStatus, transitions
//   • AccountGroup tree + pure-GL Account chart
//   • Account.openingBalance / openingBalanceType / openingBalanceDate
//     (user-set config — survives clean)
//   • InvNamingConfig singleton (user-tuned name/slug template — survives;
//     `pnpm prisma db seed` re-runs to restore defaults if needed)
//   • InvUnit master (13 units — seeded by bootstrap, not dummy)
//   • InvBrand master (~60 brands — seeded by bootstrap, not dummy)
//   • OrgDefaults singleton (GST rate, default unit, credit periods, currency)
//   • Phone/Email XOR check constraint
//   • CompanySettings + other org-level config tables
//
// Run: pnpm seed:hard-clean
// DESTRUCTIVE — vouchers + customers + products are unrecoverable.

import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/[?&]$/, "");

const pool = new Pool({ connectionString: rawUrl, ssl: { rejectUnauthorized: false }, max: 1 });

const ADMIN_EMAIL = "admin@networkservice.in";

// Phase 1 — pure-transaction tables (CASCADE handles cross-FK)
const TRANSACTION_TABLES = [
    "pos_handovers", "pos_cash_drops", "pos_shifts",
    "JournalLine", "JournalEntry", "JournalEntryAudit",
    "VoucherAllocation", "VoucherLine", "Voucher", "VoucherAudit",
    // Invoice / InvoiceLine / InvoiceAudit / Payment / PaymentAudit tables
    // were dropped on 2026-05-24 (Invoice → InvVoucher consolidation, Layer 5b).
    "InvStockLedger", "InvVoucherExpenseLine", "InvVoucherLine", "InvVoucher", "InvVoucherAudit",
    "ShopOrderLine", "ShopOrder",
    "TicketLog", "TicketParticipant", "Ticket", "Device",
    "CrmLead", "WallPost",
    "ChatMessage", "ChatRoomMember", "ChatRoom",
    "PersonPortalCredential",
];

// Phase 5 — inventory masters that are dummy-only.
// NOTE: InvUnit + InvBrand are intentionally excluded — they are now seeded
// by bootstrap-seed.ts (section 9 + 10) and must survive a hard-clean.
const INVENTORY_MASTERS = [
    "InvStockLedger", "InvVoucherExpenseLine", "InvVoucherLine", "InvVoucher", "InvVoucherAudit",  // re-listed defensively
    "InvBomLine", "InvBom",
    "inv_product_branches",
    "InvProduct",
    "InvAttributeMaster",
    "InvCategory", "InvProductGroup", "InvWarrantyTerm",
];

// Phase 6 — other dummy-only config tables
const DUMMY_CONFIG_TABLES = [
    "ServiceCenter",
    "ShopCoupon",
];

async function main(): Promise<void> {
    console.log("Hard-cleaning database — returning to bootstrap state…\n");

    // ── Phase 1 — TRUNCATE transaction tables ──────────────────────────
    console.log("[1/7] Truncating transaction tables");
    const list = TRANSACTION_TABLES.map((t) => `"${t}"`).join(", ");
    await pool.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
    for (const t of TRANSACTION_TABLES) console.log(`      ✓ ${t}`);
    console.log("");

    // ── Phase 2 — Delete party-linked Account rows ─────────────────────
    console.log("[2/7] Removing party-linked ledgers");
    const partyLed = await pool.query(
        `DELETE FROM "Account" WHERE "personId" IS NOT NULL OR "companyId" IS NOT NULL`,
    );
    console.log(`      ✓ Deleted ${partyLed.rowCount} party-linked Account rows\n`);

    // ── Phase 3 — Wipe customer/company entities ───────────────────────
    console.log("[3/7] Wiping customer + company entities");
    const phones    = await pool.query(`DELETE FROM "Phone"`);
    const emails    = await pool.query(`DELETE FROM "Email"`);
    const personCos = await pool.query(`DELETE FROM "PersonCompany"`);
    const persons   = await pool.query(`DELETE FROM "Person"`);
    const cos       = await pool.query(`DELETE FROM "Company"`);
    console.log(`      ✓ Phone: ${phones.rowCount}  Email: ${emails.rowCount}  PersonCompany: ${personCos.rowCount}  Person: ${persons.rowCount}  Company: ${cos.rowCount}\n`);

    // ── Phase 4 — Delete non-bootstrap users ───────────────────────────
    console.log("[4/7] Removing non-admin users");
    const u = await pool.query(`DELETE FROM "User" WHERE email != $1`, [ADMIN_EMAIL]);
    console.log(`      ✓ Deleted ${u.rowCount} user(s); ${ADMIN_EMAIL} preserved\n`);

    // ── Phase 5 — TRUNCATE inventory masters ───────────────────────────
    console.log("[5/7] Wiping inventory masters (dummy data — InvUnit + InvBrand preserved)");
    const invList = INVENTORY_MASTERS.map((t) => `"${t}"`).join(", ");
    await pool.query(`TRUNCATE TABLE ${invList} RESTART IDENTITY CASCADE`);
    for (const t of INVENTORY_MASTERS) console.log(`      ✓ ${t}`);
    console.log("");

    // ── Phase 6 — TRUNCATE other dummy-only config tables ──────────────
    console.log("[6/7] Wiping other dummy-only config");
    const cfgList = DUMMY_CONFIG_TABLES.map((t) => `"${t}"`).join(", ");
    await pool.query(`TRUNCATE TABLE ${cfgList} RESTART IDENTITY CASCADE`);
    for (const t of DUMMY_CONFIG_TABLES) console.log(`      ✓ ${t}`);
    console.log("");

    // ── Phase 7 — Reset cached running balances on bootstrap rows ──────
    console.log("[7/7] Resetting cached running balances + legacy hygiene");
    await pool.query(`UPDATE "Account" SET balance = 0`);
    console.log("      ✓ Account.balance reset to 0 (opening fields preserved)");
    // Legacy: pre-2026-05-09 bootstrap seeded a real ledger by this name. It's
    // purely synthetic in the BS now — wipe so it doesn't double-count.
    const dop = await pool.query(
        `DELETE FROM "Account" WHERE name = 'Difference in Opening Balances'`,
    );
    console.log(`      ✓ Removed legacy 'Difference in Opening Balances' ledger (${dop.rowCount})\n`);

    // ── Summary ────────────────────────────────────────────────────────
    const k = await pool.query<{ users: string; roles: string; groups: string; accounts: string; pipelines: string; products: string; units: string; brands: string }>(`
        SELECT
            (SELECT COUNT(*) FROM "User")         AS users,
            (SELECT COUNT(*) FROM "Role")         AS roles,
            (SELECT COUNT(*) FROM "AccountGroup") AS groups,
            (SELECT COUNT(*) FROM "Account")      AS accounts,
            (SELECT COUNT(*) FROM "Pipeline")     AS pipelines,
            (SELECT COUNT(*) FROM "InvProduct")   AS products,
            (SELECT COUNT(*) FROM "InvUnit")      AS units,
            (SELECT COUNT(*) FROM "InvBrand")     AS brands
    `);
    const r = k.rows[0]!;
    console.log("Kept (bootstrap state):");
    console.log(`  users=${r.users}  roles=${r.roles}  account-groups=${r.groups}  accounts=${r.accounts}  pipelines=${r.pipelines}`);
    console.log(`  products=${r.products}  units=${r.units}  brands=${r.brands}`);
    console.log("\nDone. DB matches bootstrap-seed.ts state.");
    console.log("Run `pnpm seed:dummy-all` to repopulate demo data.\n");

    await pool.end();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
