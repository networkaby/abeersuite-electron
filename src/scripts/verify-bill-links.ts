// Prove the bill-wise link rules against a real database, then roll everything
// back. Nothing is left behind — every write happens inside one transaction that
// ends in a deliberate throw.
//
// What it proves, in the owner's words:
//
//   1. "even one party can be our customer and supplier both so we will settled
//      with purchase to sale" — a purchase and a sale on the SAME party ledger
//      link, and BOTH sides come down.
//   2. "on any linked voucher delete will make it unsettled we may link with
//      another voucher" — cancel the settling voucher, and the bill is open
//      again; hard-delete it, same; then it can be linked to a different one.
//   3. "auto will link older" — Auto fills oldest bill first.
//   4. The guards refuse what should be refused: same-side, self-link,
//      over-allocation, and a non-party ledger.
//
// Run: pnpm verify:bill-links

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const ROLLBACK = "ROLLBACK_OK";
const results: { name: string; ok: boolean; note?: string }[] = [];

function check(name: string, ok: boolean, note?: string): void {
    results.push({ name, ok, note });
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

async function main(): Promise<void> {
    const { prisma } = await import("@/shared/lib/prisma/prismaClient");
    const { accountIdsUnderGroup } = await import("@/modules/accountancy/lib/accountGroups");
    const {
        sumLinked, assertLinkable, createLink, loadLinkableDocs, loadDocOpen,
        removeLinksForVoucher, planLinks, BillLinkError,
    } = await import("@/modules/accountancy/lib/billLink");
    const { ACCOUNT_GROUPS } = await import("@/shared/lib/constants/accounting");

    // ── Pick real ledgers to act on ────────────────────────────────────────
    const debtorIds = await accountIdsUnderGroup(ACCOUNT_GROUPS.SUNDRY_DEBTORS);
    if (debtorIds.length === 0) { console.log("No Sundry Debtors ledger — nothing to verify against."); return; }
    const party = debtorIds[0];

    // Any non-party ledger for the other leg, plus a cash-like one for the
    // "not a party ledger" guard.
    const others = await prisma.account.findMany({
        where:  { id: { notIn: debtorIds }, isActive: true },
        select: { id: true, name: true },
        take:   2,
    });
    if (others.length < 2) { console.log("Need at least two non-party ledgers."); return; }
    const [income, bank] = others;

    const user = await prisma.user.findFirst({ select: { id: true } });
    if (!user) { console.log("No user row — cannot stamp createdById."); return; }

    // The party must be a real Sundry Debtor for the guard to pass.
    const partyName = (await prisma.account.findUnique({ where: { id: party }, select: { name: true } }))?.name ?? `#${party}`;
    console.log(`\n=== bill-wise link verification (rolled back) ===`);
    console.log(`party ledger: ${partyName}  ·  other leg: ${income.name}\n`);

    try {
        await prisma.$transaction(async (tx) => {
            // Build a voucher straight onto the spine: a party leg plus its
            // opposite. No engine, no balances — the link rules read GL legs and
            // the spine's status, and nothing else.
            const mk = async (type: string, partySide: "DEBIT" | "CREDIT", amount: number, daysAgo: number) => {
                const date = new Date();
                date.setDate(date.getDate() - daysAgo);
                const uv = await tx.universalVoucher.create({
                    data: {
                        type, date, description: `verify ${type}`, status: "POSTED",
                        partyAccountId: party, createdById: user.id, postedAt: date,
                    },
                    select: { id: true },
                });
                await tx.voucherGlLine.createMany({
                    data: [
                        { universalVoucherId: uv.id, accountId: party,     type: partySide, amount },
                        { universalVoucherId: uv.id, accountId: income.id, type: partySide === "DEBIT" ? "CREDIT" : "DEBIT", amount },
                    ],
                });
                return uv.id;
            };

            // A sale the party owes us, and a purchase we owe them — the dual-role case.
            const sale     = await mk("SALE",     "DEBIT",  5000, 40);
            const purchase = await mk("PURCHASE", "CREDIT", 3000, 20);

            // ── 1. Both sides are seen, with opposite signs ─────────────────
            const docs = await loadLinkableDocs(tx, party);
            const saleDoc = docs.find((d) => d.universalVoucherId === sale);
            const purchDoc = docs.find((d) => d.universalVoucherId === purchase);
            check("sale reads as receivable, ₹5000 open",
                saleDoc?.side === 1 && near(saleDoc.open, 5000),
                saleDoc ? `side ${saleDoc.side}, open ${saleDoc.open}` : "not listed");
            check("purchase reads as payable, ₹3000 open",
                purchDoc?.side === -1 && near(purchDoc.open, 3000),
                purchDoc ? `side ${purchDoc.side}, open ${purchDoc.open}` : "not listed");

            // ── 2. Purchase settles the sale, both ends come down ───────────
            const orient = await assertLinkable(tx, { accountId: party, aId: purchase, bId: sale, amount: 3000 });
            check("receivable side is stored as the target, whatever order was passed",
                orient.targetId === sale && orient.sourceId === purchase);
            await createLink(tx, { ...orient, amount: 3000, userId: user.id });

            const after = await sumLinked(tx, [sale, purchase]);
            check("purchase settles the sale — both sides net ₹3000",
                near(after[sale] ?? 0, 3000) && near(after[purchase] ?? 0, 3000),
                `sale ${after[sale] ?? 0}, purchase ${after[purchase] ?? 0}`);

            const saleOpen = await loadDocOpen(tx, party, sale);
            check("sale now shows ₹2000 open", near(saleOpen?.open ?? -1, 2000), `open ${saleOpen?.open}`);
            const purchOpen = await loadDocOpen(tx, party, purchase);
            check("purchase is fully settled", near(purchOpen?.open ?? -1, 0), `open ${purchOpen?.open}`);

            // ── 3. Cancel the settling voucher → the bill reopens ──────────
            await tx.universalVoucher.update({ where: { id: purchase }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: user.id } });
            const afterCancel = await sumLinked(tx, [sale]);
            check("CANCEL the purchase → the sale is fully open again",
                near(afterCancel[sale] ?? 0, 0), `linked ${afterCancel[sale] ?? 0}`);

            await tx.universalVoucher.update({ where: { id: purchase }, data: { status: "POSTED", cancelledAt: null, cancelledById: null } });
            const afterRevive = await sumLinked(tx, [sale]);
            check("un-cancel it → the link counts again", near(afterRevive[sale] ?? 0, 3000));

            // ── 4. Hard-delete → the bill reopens, and can take a new link ──
            await tx.universalVoucher.delete({ where: { id: purchase } });
            const afterDelete = await sumLinked(tx, [sale]);
            check("HARD-DELETE the purchase → the sale is fully open again",
                near(afterDelete[sale] ?? 0, 0), `linked ${afterDelete[sale] ?? 0}`);

            const receipt = await mk("RECEIPT", "CREDIT", 5000, 1);
            const orient2 = await assertLinkable(tx, { accountId: party, aId: sale, bId: receipt, amount: 5000 });
            await createLink(tx, { ...orient2, amount: 5000, userId: user.id });
            const afterRelink = await sumLinked(tx, [sale]);
            check("the reopened sale links to a DIFFERENT voucher",
                near(afterRelink[sale] ?? 0, 5000), `linked ${afterRelink[sale] ?? 0}`);

            // ── 5. A self-link must never net anything ─────────────────────
            await tx.voucherAllocation.create({
                data: {
                    targetType: "UNIVERSAL_VOUCHER", targetId: sale,
                    sourceType: "VOUCHER", sourceId: sale,
                    amount: 999, method: "AGAINST_REF", createdById: user.id,
                },
            });
            const afterSelf = await sumLinked(tx, [sale]);
            check("a self-link nets nothing", near(afterSelf[sale] ?? 0, 5000), `linked ${afterSelf[sale] ?? 0}`);

            // ── 6. The guards refuse what they should ──────────────────────
            const refuses = async (name: string, fn: () => Promise<unknown>) => {
                try { await fn(); check(name, false, "was allowed"); }
                catch (e) { check(name, e instanceof BillLinkError, e instanceof Error ? e.message : String(e)); }
            };
            const sale2 = await mk("SALE", "DEBIT", 100, 3);
            await refuses("refuses two vouchers on the same side",
                () => assertLinkable(tx, { accountId: party, aId: sale, bId: sale2, amount: 50 }));
            await refuses("refuses a voucher linking to itself",
                () => assertLinkable(tx, { accountId: party, aId: sale, bId: sale, amount: 50 }));
            await refuses("refuses more than the bill has open",
                () => assertLinkable(tx, { accountId: party, aId: sale2, bId: receipt, amount: 900 }));
            await refuses("refuses a ledger that is not a party ledger",
                () => assertLinkable(tx, { accountId: bank.id, aId: sale2, bId: receipt, amount: 10 }));

            // ── 6b. A sale return after a SETTLED sale opens room for the next ──
            //
            // The owner's case: a sale is settled in full, then goods come back.
            // The return credits the party, so it is a payable-side document with
            // nothing linked to it — money the customer is owed. It must then be
            // available to settle the NEXT sale, and it needs no special code:
            // a return has a party leg like anything else.
            const soldOut  = await mk("SALE",    "DEBIT",  5000, 60);
            const paidUp   = await mk("RECEIPT", "CREDIT", 5000, 59);
            const o1 = await assertLinkable(tx, { accountId: party, aId: soldOut, bId: paidUp, amount: 5000 });
            await createLink(tx, { ...o1, amount: 5000, userId: user.id });
            const settled = await loadDocOpen(tx, party, soldOut);
            check("a sale settled in full has nothing open", near(settled?.open ?? -1, 0), `open ${settled?.open}`);

            const ret = await mk("SALE_RETURN", "CREDIT", 1200, 30);
            const retDoc = await loadDocOpen(tx, party, ret);
            check("the sale return stands as ₹1200 the customer is owed",
                retDoc?.side === -1 && near(retDoc.open, 1200), `side ${retDoc?.side}, open ${retDoc?.open}`);

            const nextSale = await mk("SALE", "DEBIT", 3000, 2);
            const offered = await loadLinkableDocs(tx, party, { excludeId: nextSale, side: -1 });
            check("the return is offered against the next sale",
                offered.some((d) => d.universalVoucherId === ret),
                offered.map((d) => d.voucherType).join(", "));

            const o2 = await assertLinkable(tx, { accountId: party, aId: nextSale, bId: ret, amount: 1200 });
            await createLink(tx, { ...o2, amount: 1200, userId: user.id });
            const nextOpen = await loadDocOpen(tx, party, nextSale);
            check("settling the next sale with it leaves ₹1800 to collect",
                near(nextOpen?.open ?? -1, 1800), `open ${nextOpen?.open}`);
            const settledStill = await loadDocOpen(tx, party, soldOut);
            check("and the already-settled sale is untouched",
                settledStill === null || near(settledStill.open, 0), `open ${settledStill?.open}`);

            // ── 7. Housekeeping removes both directions ────────────────────
            const removed = await removeLinksForVoucher(tx, sale);
            check("unlinking a voucher clears links on both of its sides", removed.length >= 2, `${removed.length} removed`);
            const afterSweep = await sumLinked(tx, [sale]);
            check("after unlinking, the sale is open again", near(afterSweep[sale] ?? 0, 0));

            throw new Error(ROLLBACK);
        }, { timeout: 60_000, maxWait: 15_000 });
    } catch (e) {
        if ((e as Error)?.message !== ROLLBACK) throw e;
    }

    // ── 7b. A party's opening balance, broken into bills ───────────────────
    //
    // The point of the breakup is that each piece behaves like a real bill: it
    // shows as outstanding, it ages, and money can be settled against it. None
    // of that works while the opening is a lone number on the master with no GL
    // lines behind it.
    {
        const { prisma } = await import("@/shared/lib/prisma/prismaClient");
        const { accountIdsUnderGroup } = await import("@/modules/accountancy/lib/accountGroups");
        const { loadOpeningBills, saveOpeningBills, OpeningBillError } =
            await import("@/modules/accountancy/lib/openingBills");
        const { loadLinkableDocs, assertLinkable, createLink } =
            await import("@/modules/accountancy/lib/billLink");
        const { ACCOUNT_GROUPS } = await import("@/shared/lib/constants/accounting");

        const debtorIds = await accountIdsUnderGroup(ACCOUNT_GROUPS.SUNDRY_DEBTORS);
        const party = debtorIds[0];
        const user = await prisma.user.findFirst({ select: { id: true } });
        const others = await prisma.account.findMany({
            where: { id: { notIn: debtorIds }, isActive: true }, select: { id: true }, take: 1,
        });

        if (party && user && others[0]) {
            try {
                await prisma.$transaction(async (tx) => {
                    const saved = await saveOpeningBills(tx, {
                        accountId: party, type: "DEBIT", userId: user.id,
                        bills: [
                            { ref: "OB-1", date: "2026-04-01", amount: 600 },
                            { ref: "OB-2", date: "2026-05-15", amount: 400 },
                        ],
                    });
                    check("an opening balance splits into two real bills",
                        saved.created.length === 2 && near(saved.total, 1000), `total ${saved.total}`);

                    const bills = await loadOpeningBills(tx, party);
                    check("both read back with their own number and date",
                        bills.length === 2 && bills[0].ref === "OB-1" && bills[1].date === "2026-05-15",
                        bills.map((b) => `${b.ref}@${b.date}`).join(" "));

                    // The scalar must be gone, or the same money counts twice.
                    const acct = await tx.account.findUnique({
                        where: { id: party }, select: { openingBalance: true },
                    });
                    check("the master figure is cleared so nothing double-counts",
                        acct?.openingBalance === null, `scalar ${acct?.openingBalance}`);

                    const open = await loadLinkableDocs(tx, party, { side: 1 });
                    const ob1 = open.find((d) => d.universalVoucherId === saved.created[0]);
                    check("an opening bill is outstanding like any other bill",
                        ob1?.side === 1 && near(ob1.open, 600), `open ${ob1?.open}`);

                    // Settle one of them, exactly as a receipt would.
                    const rc = await tx.universalVoucher.create({
                        data: {
                            type: "RECEIPT", date: new Date(), description: "verify opening receipt",
                            status: "POSTED", partyAccountId: party, createdById: user.id,
                        },
                        select: { id: true },
                    });
                    await tx.voucherGlLine.createMany({
                        data: [
                            { universalVoucherId: rc.id, accountId: party, type: "CREDIT", amount: 600 },
                            { universalVoucherId: rc.id, accountId: others[0].id, type: "DEBIT", amount: 600 },
                        ],
                    });
                    const o = await assertLinkable(tx, { accountId: party, aId: saved.created[0], bId: rc.id, amount: 600 });
                    await createLink(tx, { ...o, amount: 600, userId: user.id });

                    const afterSettle = await loadOpeningBills(tx, party);
                    check("money settles against one opening bill only",
                        near(afterSettle[0].linked, 600) && near(afterSettle[1].linked, 0),
                        afterSettle.map((b) => `${b.ref}:${b.linked}`).join(" "));

                    // Dropping a settled bill would un-settle a banked receipt.
                    try {
                        await saveOpeningBills(tx, {
                            accountId: party, type: "DEBIT", userId: user.id,
                            bills: [{ universalVoucherId: saved.created[1], ref: "OB-2", date: "2026-05-15", amount: 400 }],
                        });
                        check("refuses to drop a settled opening bill", false, "was allowed");
                    } catch (e) {
                        check("refuses to drop a settled opening bill", e instanceof OpeningBillError,
                            e instanceof Error ? e.message : String(e));
                    }

                    // Bill-wise is a party idea — a bank or capital opening has
                    // no bills behind it. The UI hides the button; this is the
                    // rule underneath it.
                    try {
                        await saveOpeningBills(tx, {
                            accountId: others[0].id, type: "DEBIT", userId: user.id,
                            bills: [{ ref: "X", date: "2026-04-01", amount: 10 }],
                        });
                        check("refuses a bill-wise opening on a non-party ledger", false, "was allowed");
                    } catch (e) {
                        check("refuses a bill-wise opening on a non-party ledger", e instanceof OpeningBillError,
                            e instanceof Error ? e.message : String(e));
                    }

                    throw new Error(ROLLBACK);
                }, { timeout: 60_000, maxWait: 15_000 });
            } catch (e) {
                if ((e as Error)?.message !== ROLLBACK) throw e;
            }
        }
    }

    // ── 8. Auto is oldest-first (pure, no database) ────────────────────────
    const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
    const synthetic = [
        { universalVoucherId: 1, voucherType: "SALE", ref: "A", date: day(30), dueDate: day(0), side: 1 as const, face: 400, linked: 0, open: 400 },
        { universalVoucherId: 2, voucherType: "SALE", ref: "B", date: day(20), dueDate: day(0), side: 1 as const, face: 400, linked: 0, open: 400 },
        { universalVoucherId: 3, voucherType: "SALE", ref: "C", date: day(10), dueDate: day(0), side: 1 as const, face: 500, linked: 0, open: 500 },
    ];
    const auto = planLinks(synthetic, 1000);
    check("Auto clears the oldest bills first (400 + 400 + 200)",
        auto.length === 3 && near(auto[0].amount, 400) && near(auto[1].amount, 400) && near(auto[2].amount, 200)
        && auto[0].universalVoucherId === 1 && auto[2].universalVoucherId === 3,
        auto.map((a) => `${a.universalVoucherId}:${a.amount}`).join(" "));

    const ticked = planLinks(synthetic, 1000, [3]);
    check("ticking one bill fills only that bill",
        ticked.length === 1 && ticked[0].universalVoucherId === 3 && near(ticked[0].amount, 500),
        ticked.map((a) => `${a.universalVoucherId}:${a.amount}`).join(" "));

    // ── Report ────────────────────────────────────────────────────────────
    console.log("");
    for (const r of results) {
        console.log(`  ${r.ok ? "✓" : "✗"} ${r.name}${r.note && !r.ok ? `  — ${r.note}` : ""}`);
    }
    const failed = results.filter((r) => !r.ok);
    console.log(failed.length === 0
        ? `\nALL ${results.length} CHECKS PASSED ✓  (nothing written — transaction rolled back)\n`
        : `\n${failed.length} of ${results.length} CHECKS FAILED ✗\n`);
    if (failed.length > 0) process.exitCode = 1;
}

main()
    .catch((e: unknown) => { console.error(e); process.exitCode = 1; })
    .finally(() => process.exit(process.exitCode ?? 0));
