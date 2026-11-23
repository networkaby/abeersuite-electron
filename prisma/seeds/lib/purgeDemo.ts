// Shared pieces for the demo cleaners (purge-demo-contacts / purge-demo-products).
//
// Both cleaners need the SAME transaction purge before they can touch their
// target, so the table list and the purge steps live here once rather than being
// copied into each script.
//
// Why every cleaner must purge transactions first: the parties and the products
// are pinned by RESTRICT foreign keys —
//   Person / Company  ← Account.personId, Ticket.personId, TicketRepair.personId
//   InvProduct        ← VoucherInventoryLine.productId, InvStockLedger.productId,
//                       TicketRepair.productId, InvBom (BomOutput / BomConsume)
// and the party ledgers themselves are pinned by UniversalVoucher.accountId /
// VoucherGlLine.accountId. Postgres will refuse the DELETE while those rows
// exist, so the books reset either way.

import { Pool } from "pg";
import * as dotenv from "dotenv";
import { scriptDbUrl } from "../../../src/shared/lib/db/dbTargets";

/** Build the seed-script pg pool from DIRECT_URL / DATABASE_URL. */
export function makeSeedPool(): Pool {
    dotenv.config({ path: ".env.local" });
    dotenv.config({ path: ".env" });

    const rawUrl = scriptDbUrl()
        .replace(/[?&]sslmode=[^&]*/g, "")
        .replace(/[?&]$/, "");

    return new Pool({
        connectionString: rawUrl,
        ssl: /@(localhost|127\.0\.0\.1)/.test(rawUrl) ? false : { rejectUnauthorized: false },
        max: 1,
    });
}

// Transaction tables. Every one either holds a RESTRICT FK to InvProduct /
// Person / Company, or hangs off something that does.
//
// Deliberately NOT here (unlike hard-clean): WallPost, ChatMessage,
// ChatRoomMember, ChatRoom — they reference User only, so nothing forces their
// removal and the staff social/chat demo survives.
export const TRANSACTION_TABLES = [
    // POS movement — pos_counters + pos_counter_payment_accounts are config and survive.
    "pos_handovers", "pos_cash_drops", "pos_expenditures", "pos_receipts", "pos_shifts",
    // Universal-voucher spine — the lone GL representation since the
    // JournalEntry/JournalLine drop (G5). VoucherSeries / VoucherPrintTemplate are
    // config (the spine points AT them, not the reverse) and survive.
    "VoucherGlLine", "UniversalVoucher",
    "VoucherAllocation",
    // Unified recycle-bin for hard-deleted vouchers (2026-06-09).
    "AuditLog",
    "InvStockLedger", "VoucherInventoryLine", "VoucherDetail",
    // Pricing-strategy cost-pool draws — FK to VoucherGlLine + InvProduct.
    "additional_cost_allocations",
    "TicketOrderLine", "TicketOrder",
    // Loyalty MOVEMENT. LoyaltyConfig / LoyaltyEarnRule / LoyaltyMilestone are
    // config and survive (product-scoped earn rules cascade off InvProduct when
    // the product cleaner runs, which is unavoidable once the product is gone).
    "LoyaltyMilestoneAward", "LoyaltyLedger", "LoyaltyLot", "LoyaltyAccount",
    // Coupon REDEMPTIONS + gift-card instruments/txns are transactional; the
    // Coupon / CouponProductRule / CouponConfig masters survive.
    "CouponRedemption", "GiftCardTxn", "GiftCard",
    // Polymorphic order key — no FK cascade reaches it, so list it explicitly.
    "redemption_holds",
    // Stock reservations cascade off InvProduct, listed for clarity.
    "stock_reservations",
    // Every pipeline flavour is a Ticket + optional 1:1 detail. The pipelines and
    // statuses themselves are config and survive.
    "TicketDelivery", "TicketRefund", "TicketDeal", "TicketRepair",
    "TicketLog", "TicketParticipant", "Ticket", "Device",
    // FK to Person (cascade), but truncating here keeps the party purge a clean DELETE.
    "PersonPortalCredential",
    // RESTRICT FK to InvProduct (BomOutput / BomConsume) — must precede the product purge.
    "InvBomLine", "InvBom",
];

/** Wipe every transaction row. Shared prerequisite for both demo cleaners. */
export async function purgeTransactions(pool: Pool, step: string): Promise<void> {
    console.log(`${step} Truncating transaction tables (shared prerequisite)`);
    const list = TRANSACTION_TABLES.map((t) => `"${t}"`).join(", ");
    await pool.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
    console.log(`      ✓ ${TRANSACTION_TABLES.length} tables truncated\n`);
}

/**
 * Delete the demo contacts: party-linked ledgers, then the parties themselves.
 * Pure-GL ledgers (personId + companyId both NULL) are bootstrap config → kept.
 */
export async function purgeParties(pool: Pool, step: string): Promise<void> {
    console.log(`${step} Wiping contacts (persons + companies)`);
    const partyLed = await pool.query(
        `DELETE FROM "Account" WHERE "personId" IS NOT NULL OR "companyId" IS NOT NULL`,
    );
    const phones    = await pool.query(`DELETE FROM "Phone"`);
    const emails    = await pool.query(`DELETE FROM "Email"`);
    const personCos = await pool.query(`DELETE FROM "PersonCompany"`);
    const persons   = await pool.query(`DELETE FROM "Person"`);
    const cos       = await pool.query(`DELETE FROM "Company"`);
    console.log(`      ✓ party ledgers: ${partyLed.rowCount}  Phone: ${phones.rowCount}  Email: ${emails.rowCount}`);
    console.log(`      ✓ PersonCompany: ${personCos.rowCount}  Person: ${persons.rowCount}  Company: ${cos.rowCount}\n`);
}

/**
 * Delete the demo product catalog.
 *
 * DELETE, never TRUNCATE … CASCADE: Coupon.freeProductId / .buyProductId are
 * ON DELETE SET NULL, but Postgres cascades on FK *existence* and ignores the
 * onDelete action — a TRUNCATE "InvProduct" CASCADE would truncate the whole
 * Coupon table and destroy the coupon config. A DELETE fires the SET NULL, so
 * coupons survive with their product links blanked.
 *
 * Cascade children cleared automatically: inv_product_codes,
 * inv_product_branches, stock_reservations, CouponProductRule,
 * product-scoped LoyaltyEarnRule.
 *
 * InvBrand / InvCategory / InvProductGroup / InvAttributeMaster are NOT touched
 * — products point at them, not the reverse.
 */
export async function purgeProducts(pool: Pool, step: string): Promise<void> {
    console.log(`${step} Wiping product catalog (brands / categories / groups preserved)`);
    const prods = await pool.query(`DELETE FROM "InvProduct"`);
    console.log(`      ✓ Deleted ${prods.rowCount} InvProduct rows (+ cascade children)\n`);
}

/** Print what survived, so settings can be confirmed at a glance. */
export async function printKept(pool: Pool): Promise<void> {
    const k = await pool.query<Record<string, string>>(`
        SELECT
            (SELECT COUNT(*) FROM "Person")           AS persons,
            (SELECT COUNT(*) FROM "Company")          AS companies,
            (SELECT COUNT(*) FROM "InvProduct")       AS products,
            (SELECT COUNT(*) FROM "User")             AS users,
            (SELECT COUNT(*) FROM "Role")             AS roles,
            (SELECT COUNT(*) FROM "payment_gateways") AS gateways,
            (SELECT COUNT(*) FROM "InvBrand")         AS brands,
            (SELECT COUNT(*) FROM "InvCategory")      AS categories,
            (SELECT COUNT(*) FROM "InvProductGroup")  AS groups,
            (SELECT COUNT(*) FROM "Coupon")           AS coupons,
            (SELECT COUNT(*) FROM "Account")          AS accounts
    `);
    const r = k.rows[0]!;
    console.log("Now in DB:");
    console.log(`  persons=${r.persons}  companies=${r.companies}  products=${r.products}`);
    console.log("Kept (settings intact):");
    console.log(`  users=${r.users}  roles=${r.roles}  payment-gateways=${r.gateways}  coupons=${r.coupons}`);
    console.log(`  brands=${r.brands}  categories=${r.categories}  product-groups=${r.groups}  accounts=${r.accounts}`);
}
