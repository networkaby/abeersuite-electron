// Narrow cleaner — wipes the demo PRODUCT catalog only. Contacts and settings survive.
//
// Wipes:
//   • All InvProduct rows + their cascade children (inv_product_codes,
//     inv_product_branches, stock_reservations, CouponProductRule,
//     product-scoped LoyaltyEarnRule)
//   • All transactions — NOT optional. VoucherInventoryLine.productId,
//     InvStockLedger.productId, TicketRepair.productId and InvBom are RESTRICT
//     FKs, so the books reset with the catalog. See lib/purgeDemo.ts.
//
// KEEPS: all contacts (Person / Company + their ledgers), the inventory masters
// products hang off (InvBrand / InvCategory / InvProductGroup /
// InvAttributeMaster / InvUnit / InvWarrantyTerm), all Users, all Roles +
// grants, DepartmentPermission pools, payment_gateways, POS counters + rails,
// Coupon / Loyalty config, Chat + WallPost, and everything
// bootstrap seeds.
//
// Note: party ledgers survive but their balances reset to 0 — the transactions
// that built them are gone. Opening-balance fields are untouched.
//
// Run: pnpm seed:purge-demo-products
// DESTRUCTIVE — products and every transaction are unrecoverable.

import {
    makeSeedPool, purgeTransactions, purgeProducts, printKept,
} from "./lib/purgeDemo";

const pool = makeSeedPool();

async function main(): Promise<void> {
    console.log("Purging demo product catalog (contacts + settings preserved)…\n");

    await purgeTransactions(pool, "[1/2]");
    await purgeProducts(pool, "[2/2]");

    await printKept(pool);
    console.log("\nDone. Products gone; contacts + settings untouched.");
    console.log("Products are re-entered through the UI or the product CSV importer.\n");

    await pool.end();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
