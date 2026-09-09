// Does every posted trading voucher's LEDGER still say what its INVOICE says?
//
// A voucher carries the same money twice: once as the invoice (VoucherDetail's
// totalAmount, which the items add up to) and once as the ledger entry (the GL
// legs on its spine). They are written together and are supposed to stay that
// way. When they drift, nothing complains — the invoice prints one figure, the
// party's ledger carries another, and the reports believe whichever they read.
//
// That is exactly how POS-26-27-0039 went unnoticed for a month: an in-place
// edit raised the invoice to ₹211,885.84 and left the ledger at ₹78,159.31.
// The code that allowed it is fixed (see `tenderCoverageComplaint` and
// `GlSkipReason`); this script is how you find out, in one run, whether
// anything else in the books ever slipped through — including rows written by
// a seed, an import, or a hand-edited database.
//
// READ ONLY. It writes nothing and changes nothing.
//
// Run: pnpm check:voucher-ledger

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

/** Legs that carry MONEY, as opposed to what the money bought. The role tags
 *  say so directly on anything posted by the current builder; older rows have
 *  no roles, so fall back to "not one of the accounting-side legs". */
function isMoneyLeg(role: string | null, accountName: string): boolean {
    if (role) return role === "TENDER";
    return !/discount|coupon|round ?off|sales a\/c|purchase a\/c|cgst|sgst|igst|cess|shipping|freight/i
        .test(accountName);
}

async function main(): Promise<void> {
    const { prisma } = await import("@/shared/lib/prisma/prismaClient");

    // The trading types that must carry a ledger entry. GRN / Challan /
    // Rejection / Physical Stock / Branch Transfer move goods without money and
    // legitimately have no GL legs at all.
    const TYPES = ["SALE", "POS", "ONLINE_INVOICE", "PURCHASE", "SALE_RETURN", "PURCHASE_RETURN"];

    const rows = await prisma.voucherDetail.findMany({
        where: { universalVoucher: { status: "POSTED", deletedAt: null, type: { in: TYPES } } },
        select: {
            id: true, totalAmount: true, updatedAt: true,
            universalVoucher: {
                select: {
                    id: true, type: true, voucherNo: true, date: true, postedAt: true,
                    lines: { select: { type: true, amount: true, role: true, accountId: true } },
                },
            },
        },
        orderBy: { id: "asc" },
    });

    // VoucherGlLine carries only an accountId, so read the names once and map.
    const accountName = new Map<number, string>(
        (await prisma.account.findMany({ select: { id: true, name: true } })).map((a) => [a.id, a.name]),
    );

    const noLedger: string[] = [];
    const mismatched: { ref: string; type: string; invoice: number; money: number; gap: number; edited: boolean }[] = [];

    for (const r of rows) {
        const uv = r.universalVoucher;
        if (!uv) continue;
        const invoice = Number(r.totalAmount);
        if (uv.lines.length === 0) {
            noLedger.push(`${uv.voucherNo ?? `#${uv.id}`} (${uv.type}) — invoice ₹${invoice.toFixed(2)}, no ledger entry at all`);
            continue;
        }
        // The money side sits on the counter side of the voucher: debits on a
        // sale (what came in or is owed to us), credits on a purchase.
        const want = uv.type === "PURCHASE" || uv.type === "PURCHASE_RETURN" ? "CREDIT" : "DEBIT";
        const money = uv.lines
            .filter((l) => l.type === want && isMoneyLeg(l.role, accountName.get(l.accountId) ?? ""))
            .reduce((s, l) => s + Number(l.amount), 0);
        const gap = invoice - money;
        if (Math.abs(gap) > 1) {
            mismatched.push({
                ref: uv.voucherNo ?? `#${uv.id}`,
                type: uv.type,
                invoice, money, gap,
                // An edit after posting is the likeliest cause, and worth seeing.
                edited: uv.postedAt != null && r.updatedAt.getTime() - uv.postedAt.getTime() > 60_000,
            });
        }
    }

    console.log(`\n=== invoice vs ledger — ${rows.length} posted trading vouchers ===\n`);

    if (noLedger.length > 0) {
        console.log(`  ${noLedger.length} posted with NO ledger entry:`);
        for (const n of noLedger) console.log(`    ✗ ${n}`);
        console.log("");
    }

    if (mismatched.length === 0 && noLedger.length === 0) {
        console.log("  ✓ every voucher's ledger says what its invoice says\n");
        return;
    }

    if (mismatched.length > 0) {
        console.log(`  ${mismatched.length} whose money side does not match the invoice:`);
        for (const m of mismatched.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))) {
            console.log(
                `    ✗ ${m.ref.padEnd(18)} ${m.type.padEnd(9)} invoice ₹${m.invoice.toFixed(2).padStart(12)}` +
                ` · ledger ₹${m.money.toFixed(2).padStart(12)} · gap ₹${m.gap.toFixed(2).padStart(12)}` +
                (m.edited ? "  (edited after posting)" : ""),
            );
        }
        console.log("");
        console.log("  A gap is not always a fault: a service CHARGE row is collected on top of");
        console.log("  the goods, so the ledger legitimately exceeds `totalAmount`. Read each one");
        console.log("  before touching it — and never repair a voucher by inventing the side that");
        console.log("  is missing.\n");
    }

    process.exitCode = 1;
}

main()
    .catch((e: unknown) => { console.error(e); process.exitCode = 1; })
    .finally(() => process.exit(process.exitCode ?? 0));
