// Turn every party's master opening figure into ONE opening bill.
//
// An opening balance used to be a single number on the master (`Account.
// openingBalance`) with no GL lines behind it — reports folded it in at display
// time. That made money carried over from the old books invisible to
// Receivables, Payables and bill-wise linking, all three of which read GL legs.
// It could not be aged, and it could not be settled against.
//
// `openingBills.ts` turns that number into a real POSTED `OPENING` voucher with
// a party leg, at which point every existing rule treats it as an ordinary bill.
// This script is how you run that over the whole book. The breakup into SEVERAL
// bills stays a per-party job in the bill-wise editor; this only gets the money
// out of the invisible scalar.
//
// Party ledgers only. An opening on Cash or Capital is not a "bill" — nothing to
// age, nothing to settle — so it is left exactly as it is.
//
// Safe to re-run: converting an account clears its scalar, so a second pass no
// longer sees it. An account whose opening has already been broken up by hand is
// skipped outright rather than flattened back into one bill.
//
//   pnpm opening:to-bills            # dry run — writes nothing
//   pnpm opening:to-bills --apply    # actually convert
//
// Read `pnpm opening:preview` FIRST. Converting moves `Account.balance`, which
// is what the POS credit check reads, so a customer who looks clear today can
// start hitting their credit limit at the counter. That is correct accounting
// and still a live change on the shop floor — it should be a decision, not a
// surprise.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const APPLY = process.argv.includes("--apply");

const money = (n: number) => n.toFixed(2).padStart(13);

async function main(): Promise<void> {
    const { prisma } = await import("@/shared/lib/prisma/prismaClient");
    const { accountIdsUnderGroup } = await import("@/modules/accountancy/lib/accountGroups");
    const { ACCOUNT_GROUPS } = await import("@/shared/lib/constants/accounting");
    const {
        saveOpeningBills, defaultOpeningDateIso, DEFAULT_OPENING_REF, OPENING_TYPE, OpeningBillError,
    } = await import("@/modules/accountancy/lib/openingBills");

    const user = await prisma.user.findFirst({ select: { id: true, name: true } });
    if (!user) { console.log("No active user to stamp the vouchers with."); return; }

    const [debtors, creditors] = await Promise.all([
        accountIdsUnderGroup(ACCOUNT_GROUPS.SUNDRY_DEBTORS),
        accountIdsUnderGroup(ACCOUNT_GROUPS.SUNDRY_CREDITORS),
    ]);
    const partyIds = [...new Set([...debtors, ...creditors])];

    const candidates = await prisma.account.findMany({
        where: {
            id:                 { in: partyIds },
            openingBalance:     { not: null },
            openingBalanceType: { not: null },
        },
        select:  { id: true, name: true, openingBalance: true, openingBalanceType: true },
        orderBy: { name: "asc" },
    });

    // An account that already has bill-wise openings is left alone. It should not
    // be possible to have both — converting nulls the scalar — but flattening
    // someone's hand-made breakup back into one bill is not a mistake worth
    // risking on a whole book at once.
    const alreadyBillWise = new Set(
        (await prisma.universalVoucher.findMany({
            where:  { type: OPENING_TYPE, partyAccountId: { in: partyIds }, status: { not: "CANCELLED" } },
            select: { partyAccountId: true },
            distinct: ["partyAccountId"],
        })).map((v) => v.partyAccountId).filter((x): x is number => x !== null),
    );

    const work = candidates.filter((a) => Number(a.openingBalance) !== 0 && !alreadyBillWise.has(a.id));
    const skipped = candidates.filter((a) => alreadyBillWise.has(a.id));

    const date = defaultOpeningDateIso();
    const total = work.reduce((s, a) => s + Number(a.openingBalance), 0);

    console.log(`\n=== opening balances → bills  (${APPLY ? "APPLYING" : "dry run — nothing written"}) ===`);
    console.log(`bill date ${date} · ref "${DEFAULT_OPENING_REF}" · posted as ${user.name}\n`);

    if (work.length === 0) {
        console.log("  Nothing to convert — every party opening is already bill-wise, or zero.\n");
    } else {
        for (const a of work) {
            console.log(`  ${money(Number(a.openingBalance))} ${a.openingBalanceType === "DEBIT" ? "Dr" : "Cr"}  ${a.name}`);
        }
        console.log(`\n  ${work.length} account(s), ₹${total.toFixed(2)} in total.`);
    }
    if (skipped.length > 0) {
        console.log(`  ${skipped.length} account(s) already broken up bill-wise — left untouched.`);
    }

    if (!APPLY) {
        console.log(`\nNothing was written. Re-run with --apply to convert.`);
        console.log(`Check 'pnpm opening:preview' first — this moves Account.balance, which the POS credit check reads.\n`);
        return;
    }

    // One transaction per account, not one for all of them: a single failure —
    // a missing Suspense ledger, say — should not undo the eighty that were fine.
    const done: string[] = [];
    const failed: { name: string; reason: string }[] = [];

    for (const a of work) {
        try {
            await prisma.$transaction(
                (tx) => saveOpeningBills(tx, {
                    accountId: a.id,
                    type:      a.openingBalanceType!,
                    userId:    user.id,
                    bills:     [{ ref: DEFAULT_OPENING_REF, date, amount: Number(a.openingBalance) }],
                }),
                { timeout: 30_000, maxWait: 10_000 },
            );
            done.push(a.name);
        } catch (e) {
            failed.push({
                name:   a.name,
                reason: e instanceof OpeningBillError ? e.message : (e as Error)?.message ?? "Unexpected error",
            });
        }
    }

    console.log(`\n  converted ${done.length} of ${work.length}`);
    for (const f of failed) console.log(`  ✗ ${f.name} — ${f.reason}`);
    console.log(failed.length === 0
        ? `\nDone. These now age and settle like any other bill.\n`
        : `\nDone with ${failed.length} refusal(s) — fix those and re-run; the ones that converted are not touched again.\n`);
    if (failed.length > 0) process.exitCode = 1;
}

main()
    .catch((e: unknown) => { console.error(e); process.exitCode = 1; })
    .finally(() => process.exit(process.exitCode ?? 0));
