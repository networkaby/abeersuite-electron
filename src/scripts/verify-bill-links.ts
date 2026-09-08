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
