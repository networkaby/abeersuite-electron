// Take the Suspense A/c leg off every opening bill.
//
// Opening bills used to post two legs: the party, and Suspense A/c as the other
// side. Owner, 2026-10-14: "opening balance are just opening balance of the
// ledger, no counter balance need" — Tally's way. New bills post the party's leg
// only (`openingBills.ts`), and `aggregateRange` folds them into the opening
// column so the Trial Balance's Debit and Credit columns stay equal. This script
// brings the bills posted before that change into line: it deletes every leg of
// an `OPENING` voucher that is not the party's own.
//
// The party's balance, its bills, ageing and every settlement are untouched —
// all of those read the party leg. Only the other ledger (Suspense A/c) loses
// its "Opening balance — <party>" rows; what the openings disagree by then shows
// as the computed "Difference in opening balances" line instead.
//
// Safe to re-run: a second pass finds nothing left to delete.
//
//   pnpm opening:drop-suspense            # dry run — writes nothing
//   pnpm opening:drop-suspense --apply    # actually delete

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const APPLY = process.argv.includes("--apply");

const money = (n: number) => n.toFixed(2).padStart(13);

async function main(): Promise<void> {
    const { prisma } = await import("@/shared/lib/prisma/prismaClient");
    const { OPENING_TYPE } = await import("@/modules/accountancy/lib/openingBills");
    const { resetReconciliation } = await import("@/modules/accountancy/lib/reconciliation");

    // Every status, not just POSTED: a cancelled opening's stray leg would come
    // back to life on a restore.
    const vouchers = await prisma.universalVoucher.findMany({
        where:  { type: OPENING_TYPE, partyAccountId: { not: null } },
        select: {
            id: true, partyAccountId: true,
            lines: { select: { id: true, accountId: true, type: true, amount: true } },
        },
    });

    const stray = vouchers.flatMap((v) => v.lines
        .filter((l) => l.accountId !== v.partyAccountId)
        .map((l) => ({ ...l, universalVoucherId: v.id })));
    // A voucher with no party leg at all would be left empty — not expected, and
    // not something to delete blind.
    const noPartyLeg = vouchers.filter((v) => !v.lines.some((l) => l.accountId === v.partyAccountId));
    const strayOk = stray.filter((l) => !noPartyLeg.some((v) => v.id === l.universalVoucherId));

    const accountIds = [...new Set(strayOk.map((l) => l.accountId))];
    const names = new Map((await prisma.account.findMany({
        where:  { id: { in: accountIds } },
        select: { id: true, name: true },
    })).map((a) => [a.id, a.name]));

    console.log(`\n=== opening bills: drop the counter-leg  (${APPLY ? "APPLYING" : "dry run — nothing written"}) ===\n`);
    console.log(`  ${vouchers.length} opening bill(s) on the books.`);
    if (strayOk.length === 0) {
        console.log("  Nothing to delete — every opening bill already carries the party's leg only.\n");
    } else {
        for (const id of accountIds) {
            const mine = strayOk.filter((l) => l.accountId === id);
            const dr = mine.filter((l) => l.type === "DEBIT").reduce((s, l) => s + Number(l.amount), 0);
            const cr = mine.filter((l) => l.type === "CREDIT").reduce((s, l) => s + Number(l.amount), 0);
            console.log(`  ${names.get(id) ?? `#${id}`}: ${mine.length} leg(s)  Dr ${money(dr)}  Cr ${money(cr)}`);
        }
    }
    if (noPartyLeg.length > 0) {
        console.log(`\n  ${noPartyLeg.length} opening bill(s) have no party leg and are left alone: ${noPartyLeg.map((v) => v.id).join(", ")}`);
    }

    if (!APPLY || strayOk.length === 0) {
        if (!APPLY && strayOk.length > 0) console.log(`\nNothing was written. Re-run with --apply to delete.\n`);
        return;
    }

    await prisma.$transaction(async (tx) => {
        await tx.voucherGlLine.deleteMany({ where: { id: { in: strayOk.map((l) => l.id) } } });

        // Rebuild the movement cache for the ledgers that lost lines, straight
        // from what is left (same rule as `recomputeAccountBalances`, which this
        // script cannot import — its module reaches `server-only`).
        const [sums, accounts] = await Promise.all([
            tx.voucherGlLine.groupBy({
                by:    ["accountId", "type"],
                where: { accountId: { in: accountIds }, universalVoucher: { status: "POSTED" } },
                _sum:  { amount: true },
            }),
            tx.account.findMany({
                where:  { id: { in: accountIds } },
                select: { id: true, normalBalance: true, group: { select: { type: true } } },
            }),
        ]);
        for (const a of accounts) {
            const nb = a.normalBalance ?? (a.group?.type === "ASSET" || a.group?.type === "EXPENSE" ? "DEBIT" : "CREDIT");
            const balance = sums
                .filter((r) => r.accountId === a.id)
                .reduce((s, r) => s + (r.type === nb ? 1 : -1) * Number(r._sum.amount ?? 0), 0);
            await tx.account.update({ where: { id: a.id }, data: { balance: Math.round(balance * 100) / 100 } });
        }

        // Those ledgers' history changed, so their reconciliation starts over.
        await resetReconciliation(tx, accountIds);
    }, { timeout: 60_000, maxWait: 10_000 });

    console.log(`\n  Deleted ${strayOk.length} leg(s). The parties' openings are unchanged.\n`);
}

main()
    .catch((e: unknown) => { console.error(e); process.exitCode = 1; })
    .finally(() => process.exit(process.exitCode ?? 0));
