// DUMMY DATA — stub for sample accounting vouchers.
// TODO: when filled out, this would seed a few balanced Contra / Payment /
// Receipt vouchers (and maybe one SALE / PURCHASE InvVoucher) so the BS / P&L
// reports have something to display in dev. For now we just no-op so
// `pnpm seed:dummy-all` doesn't break.
//
// Run: pnpm seed:dummy-vouchers

async function main() {
    console.log("\n⚠️  DUMMY DATA — sample vouchers (stub).");
    console.log("    Not implemented yet. Use the UI (e.g. /office/accountancy/voucher/new)");
    console.log("    to create test vouchers, or extend this file with sample inserts.\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
