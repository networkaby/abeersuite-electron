// HARD database clean — returns DB to exact bootstrap-seed state.
//
// Wipes everything `bootstrap-seed.ts` does NOT seed:
//   • All transactions (vouchers, JEs, invoices, payments, allocations + audits)
//   • All inventory vouchers + stock-ledger entries + their audits
//   • All shop orders, repair tickets, CRM leads, social posts, chat
//   • All non-admin Users (only admin@networkservice.in survives)
//   • All Persons / Companies / Phones / Emails (test customers)
//   • All party-linked Account rows (customer/company personal ledgers)
//   • All InvProduct catalog + InvCategory/Group/Brand (trade-specific
//     reference data — seeded by helper-inventory-masters.ts, not bootstrap)
//   • InvAttributeMaster rows (category-specific attrs seeded by dummy-shop)
//   • ServiceCenter, PortalCredentials
//
// Preserves (everything bootstrap-seed.ts wrote, plus user-set config):
//   • Admin user (admin@networkservice.in)
//   • R1 (Admin) role, all Permissions, R1's RolePermissions
//     (NON-system roles — the helper-roles.ts starter set + any admin-created
//     roles — are wiped here; re-run `pnpm seed:helper-roles` to restore them)
//   • Branches, Departments, UserPositions
//   • Pipelines, TicketStatus, TicketWorker, transitions
//   • AccountGroup tree + pure-GL Account chart
//   • Account.openingBalance / openingBalanceType / openingBalanceDate
//     (user-set config — survives clean)
//   • InvNamingConfig singleton (user-tuned name/slug template — survives;
//     `pnpm prisma db seed` re-runs to restore defaults if needed)
//   • InvUnit master (13 units — universal, seeded by bootstrap)
//   • InvWarrantyTerm master (~10 terms — universal, seeded by bootstrap)
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

const pool = new Pool({ connectionString: rawUrl, ssl: /@(localhost|127\.0\.0\.1)/.test(rawUrl) ? false : { rejectUnauthorized: false }, max: 1 });

const ADMIN_EMAIL = "admin@networkservice.in";

// Phase 1 — pure-transaction tables (CASCADE handles cross-FK)
const TRANSACTION_TABLES = [
    "pos_handovers", "pos_cash_drops", "pos_expenditures", "pos_receipts", "pos_shifts",
    "JournalLine", "JournalEntry",
    // Phase 4 universal-voucher spine + GL-arm lines (transitional dual-write
    // target; transactional, never bootstrap). Child before parent; cascade also
    // covers the child when the spine is truncated.
    "VoucherGlLine", "UniversalVoucher",
    "VoucherAllocation", "VoucherLine", "Voucher",
    // AuditLog — unified recycle-bin for hard-deleted vouchers/JEs (2026-06-09,
    // replaced the 3 *Audit tables). Transactional snapshot data, wiped here.
    "AuditLog",
    // Invoice / InvoiceLine / InvoiceAudit / Payment / PaymentAudit tables
    // were dropped on 2026-05-24 (Invoice → InvVoucher consolidation, Layer 5b).
    "InvStockLedger", "InvVoucherLine", "InvVoucher",
    // Pricing-strategy additional-cost pool draws — transaction/history data,
    // not bootstrap config. FKs to JournalLine + InvProduct (both wiped here /
    // phase 5), so truncate it in phase 1. Bootstrap seeds nothing into it.
    "additional_cost_allocations",
    "ShopOrderLine", "ShopOrder",
    // Loyalty wallet movement tables (the LoyaltyConfig + LoyaltyEarnRule +
    // LoyaltyMilestone config and the "Loyalty Points Redeemed" GL ledger are NOT
    // listed — they survive a hard-clean like other bootstrap/admin config).
    "LoyaltyMilestoneAward", "LoyaltyLedger", "LoyaltyLot", "LoyaltyAccount",
    // Coupon REDEMPTIONS + the gift-card instruments/txns are transactional (the
    // Coupon + CouponProductRule + CouponConfig masters and the "Coupon Discounts"
    // / "Gift Card Liability" ledgers survive — they're admin config). Gift cards
    // are issued value backed by the liability ledger (truncated above), so they
    // must be wiped too or they'd orphan after a clean.
    "CouponRedemption", "GiftCardTxn", "GiftCard",
    // O2C redemption holds (Phase 2b) — reward value HELD against open orders.
    // Polymorphic order key, so NO FK cascade reaches it (unlike stock_reservations,
    // which cascade-truncates via its InvProduct FK) — it must be listed explicitly.
    // Bootstrap seeds nothing into it.
    "redemption_holds",
    // O2C delivery + refund sub-pipeline rows (P8 / P9). Transactional — spawned per
    // order; the pipelines themselves survive (bootstrap config).
    "deliveries", "refunds",
    "TicketLog", "TicketParticipant", "Ticket", "Device",
    "TaskComment", "Task",
    "DealActivity", "Deal", "WallPost",
    "ChatMessage", "ChatRoomMember", "ChatRoom",
    "PersonPortalCredential",
];

// Phase 5 — inventory masters that are NOT bootstrap data.
// NOTE: InvUnit + InvWarrantyTerm are intentionally excluded — they are
// universal masters seeded by bootstrap-seed.ts (sections 9 + 10) and must
// survive a hard-clean. InvBrand / InvCategory / InvProductGroup are
// trade-specific reference data seeded by helper-inventory-masters.ts (NOT
// bootstrap), so they are wiped here and restored by `pnpm seed:helper-inventory`.
const INVENTORY_MASTERS = [
    "InvStockLedger", "InvVoucherLine", "InvVoucher",  // re-listed defensively
    "InvBomLine", "InvBom",
    "inv_product_branches",
    "InvProduct",
    "InvAttributeMaster",
    "InvCategory", "InvProductGroup", "InvBrand",
];

// Phase 6 — other dummy-only config tables.
// NOTE: payment_gateways (Settings → Payment Methods) is NOT listed here — it's
// cleared with an explicit DELETE in Phase 6 so its ON DELETE SET NULL fires and
// preserves the counter payment rails. See the DELETE below.
const DUMMY_CONFIG_TABLES = [
    "ServiceCenter",
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

    // ── Phase 4b — Reset roles to bootstrap (R1 only) ──────────────────
    // Bootstrap seeds only R1 (isSystem=true). Every other role — the
    // helper-roles.ts starter set and any admin-created role — is non-system
    // and trade-specific, so it's wiped here. Unlink positions first because
    // PositionRole → Role is a restrict FK (no cascade).
    console.log("[4b] Resetting roles to bootstrap (R1 only)");
    await pool.query(
        `DELETE FROM "PositionRole"
         WHERE "roleId" IN (SELECT id FROM "Role" WHERE "isSystem" = false)`,
    );
    await pool.query(
        `DELETE FROM "RolePermission" WHERE "roleId" IN (SELECT id FROM "Role" WHERE "isSystem" = false)`,
    );
    const delRoles = await pool.query(`DELETE FROM "Role" WHERE "isSystem" = false`);
    // Department permission pools are seeded by helper-roles.ts (bootstrap seeds
    // none — DEP-ADMIN is all-access with no rows), so wipe them back to the
    // bootstrap state. Department rows themselves are bootstrap-seeded → preserved.
    const delPool = await pool.query(`DELETE FROM "DepartmentPermission"`);
    console.log(`      ✓ Deleted ${delRoles.rowCount} non-system role(s); R1 preserved · ${delPool.rowCount} department-pool entries cleared\n`);

    // ── Phase 5 — TRUNCATE inventory masters ───────────────────────────
    console.log("[5/7] Wiping inventory masters (trade-specific — InvUnit + InvWarrantyTerm preserved)");
    const invList = INVENTORY_MASTERS.map((t) => `"${t}"`).join(", ");
    await pool.query(`TRUNCATE TABLE ${invList} RESTART IDENTITY CASCADE`);
    for (const t of INVENTORY_MASTERS) console.log(`      ✓ ${t}`);
    console.log("");

    // ── Phase 6 — TRUNCATE other dummy-only config tables ──────────────
    console.log("[6/7] Wiping other dummy-only config");
    const cfgList = DUMMY_CONFIG_TABLES.map((t) => `"${t}"`).join(", ");
    await pool.query(`TRUNCATE TABLE ${cfgList} RESTART IDENTITY CASCADE`);
    for (const t of DUMMY_CONFIG_TABLES) console.log(`      ✓ ${t}`);

    // Payment-gateway catalog (Settings → Payment Methods) — operator config, not
    // bootstrap-seeded, so it's wiped here. We DELETE (not TRUNCATE … CASCADE) so the
    // ON DELETE SET NULL on pos_counter_payment_accounts.gatewayId fires: counter
    // payment rails (also operator config) are PRESERVED, just unlinked from the
    // deleted gateways. A TRUNCATE CASCADE would instead wipe those rails too.
    const pg = await pool.query(`DELETE FROM "payment_gateways"`);
    console.log(`      ✓ payment_gateways (${pg.rowCount} deleted; counter rails preserved, unlinked)`);
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
    const k = await pool.query<{ users: string; roles: string; groups: string; accounts: string; pipelines: string; products: string; units: string; warranty: string }>(`
        SELECT
            (SELECT COUNT(*) FROM "User")             AS users,
            (SELECT COUNT(*) FROM "Role")             AS roles,
            (SELECT COUNT(*) FROM "AccountGroup")     AS groups,
            (SELECT COUNT(*) FROM "Account")          AS accounts,
            (SELECT COUNT(*) FROM "Pipeline")         AS pipelines,
            (SELECT COUNT(*) FROM "InvProduct")       AS products,
            (SELECT COUNT(*) FROM "InvUnit")          AS units,
            (SELECT COUNT(*) FROM "InvWarrantyTerm")  AS warranty
    `);
    const r = k.rows[0]!;
    console.log("Kept (bootstrap state):");
    console.log(`  users=${r.users}  roles=${r.roles}  account-groups=${r.groups}  accounts=${r.accounts}  pipelines=${r.pipelines}`);
    console.log(`  products=${r.products}  units=${r.units}  warranty-terms=${r.warranty}`);
    console.log("\nDone. DB matches bootstrap-seed.ts state.");
    console.log("Run `pnpm seed:dummy-all` to repopulate demo data.\n");

    await pool.end();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
