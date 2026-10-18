// Narrow cleaner — wipes demo CONTACTS only. Products and settings survive.
//
// Wipes:
//   • All Persons / Companies / Phones / Emails / PersonCompany links
//   • All party-linked Account rows (customer/company personal ledgers)
//   • All transactions — NOT optional. Account.personId / Ticket.personId /
//     TicketRepair.personId are RESTRICT FKs, and the party ledgers are pinned
//     by UniversalVoucher.accountId, so the books reset with the contacts.
//     See lib/purgeDemo.ts.
//
// KEEPS: the whole product catalog (InvProduct + brands / categories / groups),
// all Users, all Roles + grants, DepartmentPermission pools, payment_gateways,
// POS counters + rails, Coupon / Loyalty config, Chat + WallPost,
// and everything bootstrap seeds.
//
// Run: pnpm seed:purge-demo-contacts
// DESTRUCTIVE — contacts and every transaction are unrecoverable.

import {
    makeSeedPool, purgeTransactions, purgeParties, resetBalances, printKept,
} from "./lib/purgeDemo";

const pool = makeSeedPool();

async function main(): Promise<void> {
    console.log("Purging demo contacts (products + settings preserved)…\n");

    await purgeTransactions(pool, "[1/3]");
    await purgeParties(pool, "[2/3]");
    await resetBalances(pool, "[3/3]");

    await printKept(pool);
    console.log("\nDone. Contacts gone; products + settings untouched.");
    console.log("Contacts are re-entered through the UI or the customer CSV importer.\n");

    await pool.end();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
