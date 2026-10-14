// Move everything off the party "SUSPENSE A/c" onto the ledger "Suspense A/c",
// then delete the emptied party.
//
// Owner, 2026-10-14: a Suspense customer was made under Sundry Debtors and used
// for petty-cash / bank payments and receipts; those belong on the Suspense A/c
// ledger. Per voucher:
//   - every GL line on the party moves to the ledger;
//   - payments / receipts / journals drop their party tag (a voucher to a plain
//     ledger carries partyAccountId = null, as every expense payment does);
//   - the party's opening bill (OPENING voucher) is removed and its amount is
//     added to the ledger master's own opening balance — a ledger keeps its
//     opening on the master, not as a bill.
// Then the party's Account, PersonCompany links and Person/Company row go.
//
// Refuses to touch anything if the party's vouchers carry bill-wise links
// (VoucherLink / VoucherDetail) — those would need a human look first.
//
// Safe to re-run: once the party is gone, a second pass finds nothing.
//
//   npx tsx src/scripts/suspense-party-to-ledger.ts            # dry run — writes nothing
//   npx tsx src/scripts/suspense-party-to-ledger.ts --apply    # actually move

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const APPLY = process.argv.includes("--apply");
const NAME = "suspense a/c";

const money = (n: number) => n.toFixed(2).padStart(13);
const round2 = (n: number) => Math.round(n * 100) / 100;

async function main(): Promise<void> {
    const { prisma } = await import("@/shared/lib/prisma/prismaClient");
    const { OPENING_TYPE } = await import("@/modules/accountancy/lib/openingBills");
    const { resetReconciliation } = await import("@/modules/accountancy/lib/reconciliation");

    console.log(`\n=== Suspense: party → ledger  (${APPLY ? "APPLYING" : "dry run — nothing written"}) ===\n`);

    const named = await prisma.account.findMany({
        where:  { name: { equals: NAME, mode: "insensitive" } },
        select: {
            id: true, name: true, personId: true, companyId: true,
            openingBalance: true, openingBalanceType: true,
        },
    });
    const parties = named.filter((a) => a.personId !== null || a.companyId !== null);
    const ledgers = named.filter((a) => a.personId === null && a.companyId === null);

    if (parties.length === 0) {
        console.log("  No party named SUSPENSE A/c — nothing to move.\n");
        return;
    }
    if (parties.length > 1 || ledgers.length !== 1) {
        console.log(`  Expected one party and one ledger; found ${parties.length} party(ies), ${ledgers.length} ledger(s). Stopping.\n`);
        process.exitCode = 1;
        return;
    }
    const party = parties[0];
    const ledger = ledgers[0];
    console.log(`  Party : #${party.id} ${party.name} (${party.personId ? `person ${party.personId}` : `company ${party.companyId}`})`);
    console.log(`  Ledger: #${ledger.id} ${ledger.name}\n`);

    const vouchers = await prisma.universalVoucher.findMany({
        where: {
            OR: [
                { partyAccountId: party.id },
                { lines: { some: { accountId: party.id } } },
            ],
        },
        select: {
            id: true, type: true, voucherNo: true, date: true, status: true, partyAccountId: true,
            lines: { select: { id: true, accountId: true, type: true, amount: true } },
        },
        orderBy: [{ date: "asc" }, { id: "asc" }],
    });
    const ids = vouchers.map((v) => v.id);

    const [links, details, devices] = await Promise.all([
        prisma.voucherLink.count({ where: { universalVoucherId: { in: ids } } }),
        prisma.voucherDetail.count({
            where: { OR: [{ universalVoucherId: { in: ids } }, { refVoucherId: { in: ids } }] },
        }),
        prisma.device.count({ where: { accountId: party.id } }),
    ]);
    if (links + details + devices > 0) {
        console.log(`  Blocked: ${links} bill link(s), ${details} voucher detail(s), ${devices} device(s) hang off the party. Nothing moved.\n`);
        process.exitCode = 1;
        return;
    }

    const openings = vouchers.filter((v) => v.type === OPENING_TYPE);
    const others = vouchers.filter((v) => v.type !== OPENING_TYPE);

    // Signed, debit-positive.
    const signed = (type: string, amount: unknown) => (type === "DEBIT" ? 1 : -1) * Number(amount);
    let moveDr = 0, moveCr = 0;
    for (const v of others) {
        const mine = v.lines.filter((l) => l.accountId === party.id);
        const amt = mine.reduce((s, l) => s + signed(l.type, l.amount), 0);
        if (v.status === "POSTED") for (const l of mine) l.type === "DEBIT" ? (moveDr += Number(l.amount)) : (moveCr += Number(l.amount));
        console.log(`  ${v.date.toISOString().slice(0, 10)}  ${v.type.padEnd(8)} ${(v.voucherNo ?? "").padEnd(8)} #${String(v.id).padEnd(6)} ${v.status.padEnd(9)} ${amt >= 0 ? "Dr" : "Cr"} ${money(Math.abs(amt))}`);
    }

    // Openings: only POSTED ones count toward the master figure; any cancelled
    // one is removed too (it is the party's, and the party is going).
    let openingAdd = 0;
    for (const v of openings) {
        const amt = v.lines.filter((l) => l.accountId === party.id).reduce((s, l) => s + signed(l.type, l.amount), 0);
        if (v.status === "POSTED") openingAdd += amt;
        console.log(`  ${v.date.toISOString().slice(0, 10)}  OPENING  ${"".padEnd(8)} #${String(v.id).padEnd(6)} ${v.status.padEnd(9)} ${amt >= 0 ? "Dr" : "Cr"} ${money(Math.abs(amt))}  → ledger master`);
    }
    // The party's own master opening, if it has one, goes across too.
    if (party.openingBalance && Number(party.openingBalance) !== 0) {
        const amt = signed(party.openingBalanceType ?? "DEBIT", party.openingBalance);
        openingAdd += amt;
        console.log(`  party master opening ${amt >= 0 ? "Dr" : "Cr"} ${money(Math.abs(amt))}  → ledger master`);
    }

    const ledgerOpening = ledger.openingBalance
        ? signed(ledger.openingBalanceType ?? "DEBIT", ledger.openingBalance)
        : 0;
    const newOpening = round2(ledgerOpening + openingAdd);

    console.log(`\n  ${others.length} voucher(s) move: Dr ${money(moveDr)}  Cr ${money(moveCr)}`);
    console.log(`  ${openings.length} opening bill(s) removed; ledger opening ${ledgerOpening >= 0 ? "Dr" : "Cr"} ${money(Math.abs(ledgerOpening))}  →  ${newOpening >= 0 ? "Dr" : "Cr"} ${money(Math.abs(newOpening))}`);
    console.log(`  Then the party is deleted.`);

    if (!APPLY) {
        console.log(`\nNothing was written. Re-run with --apply to move.\n`);
        return;
    }

    await prisma.$transaction(async (tx) => {
        // 1. Opening bills: drop their lines, then the vouchers.
        const openingIds = openings.map((v) => v.id);
        if (openingIds.length > 0) {
            await tx.voucherGlLine.deleteMany({ where: { universalVoucherId: { in: openingIds } } });
            await tx.universalVoucher.deleteMany({ where: { id: { in: openingIds } } });
        }

        // 2. Every other line on the party → the ledger; untag the vouchers.
        await tx.voucherGlLine.updateMany({ where: { accountId: party.id }, data: { accountId: ledger.id } });
        await tx.universalVoucher.updateMany({ where: { partyAccountId: party.id }, data: { partyAccountId: null } });

        // 3. Ledger master opening.
        await tx.account.update({
            where: { id: ledger.id },
            data:  newOpening === 0
                ? { openingBalance: null, openingBalanceType: null }
                : { openingBalance: Math.abs(newOpening), openingBalanceType: newOpening > 0 ? "DEBIT" : "CREDIT" },
        });

        // 4. The ledger's history changed, so its reconciliation starts over.
        await resetReconciliation(tx, [ledger.id]);

        // 5. The emptied party.
        if (party.personId) {
            await tx.personCompany.deleteMany({ where: { personId: party.personId } });
            await tx.account.delete({ where: { id: party.id } });
            await tx.person.delete({ where: { id: party.personId } });
        } else if (party.companyId) {
            await tx.personCompany.deleteMany({ where: { companyId: party.companyId } });
            await tx.account.delete({ where: { id: party.id } });
            await tx.company.delete({ where: { id: party.companyId } });
        }
    }, { timeout: 60_000, maxWait: 10_000 });

    console.log(`\n  Done. ${others.length} voucher(s) now post to ${ledger.name}; the party is deleted.\n`);
}

main()
    .catch((e: unknown) => { console.error(e); process.exitCode = 1; })
    .finally(() => process.exit(process.exitCode ?? 0));
