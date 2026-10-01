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
//   3. "kill overdue, then nearest due date, for same due date lowest amount" —
//      the order Auto settles in, and its promise never to touch a tick the user
//      made by hand.
//   4. The guards refuse what should be refused: same-side, self-link,
//      over-allocation, and a non-party ledger.
//   5. Saving the same plan twice settles the bill once, not twice.
//   6. A voucher cannot be edited below what is already settled against it.
//   7. A voucher's money side must equal its goods side — an edit that breaks
//      that is refused, and the ledger it already had is left alone. This is
//      the hole POS-26-27-0039 fell through: goods went to ₹211,885.84, the
//      payment rows stayed at ₹76,319, and the edit saved anyway.
//
// Run: pnpm verify:bill-links

import * as dotenv from "dotenv";
import { systemBranchId } from "@/shared/lib/org/systemBranch";
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
        removeLinksForVoucher, planLinks, autoLinkOrder, dueDateOf, BillLinkError,
        assertLinkPlan, assertLinksSurviveEdit,
    } = await import("@/modules/accountancy/lib/billLink");
    const { reconcilePicks, assignSources } = await import("@/modules/accountancy/lib/billLinkPlan");
    const { tenderCoverageComplaint, GlBuildError } = await import("@/modules/accountancy/lib/postInvVoucher");
    const { reapplyTradingVoucherInPlace } = await import("@/modules/accountancy/lib/reapplyTradingVoucher");
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
                        branchId: await systemBranchId(tx),
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

            // ── 6b. Saving the same plan twice settles the bill ONCE ───────
            //
            // The hazard this closes is not really the double click — that was
            // already refused for having no room left. It is the PARTIAL retry:
            // a plan of several links commits, the response is lost, and the
            // retry used to add the whole lot again on any bill that still had
            // room. Stating the pair's TOTAL rather than what to add makes the
            // second attempt land on the same figure.
            const idemBill    = await mk("SALE",    "DEBIT",  1000, 15);
            const idemReceipt = await mk("RECEIPT", "CREDIT",  400, 2);

            const firstPass = await assertLinkPlan(tx, {
                accountId: party, voucherId: idemReceipt, mode: "set",
                links: [{ voucherId: idemBill, amount: 400 }],
            });
            for (const l of firstPass) {
                await createLink(tx, { targetId: l.targetId, sourceId: l.sourceId, amount: l.amount, userId: user.id, mode: "set" });
            }
            const afterFirst = (await sumLinked(tx, [idemBill]))[idemBill] ?? 0;

            // The very same request again — the client re-sends the pair total it
            // was shown, which is what it already is.
            const secondPass = await assertLinkPlan(tx, {
                accountId: party, voucherId: idemReceipt, mode: "set",
                links: [{ voucherId: idemBill, amount: 400 }],
            });
            for (const l of secondPass) {
                await createLink(tx, { targetId: l.targetId, sourceId: l.sourceId, amount: l.amount, userId: user.id, mode: "set" });
            }
            const afterSecond = (await sumLinked(tx, [idemBill]))[idemBill] ?? 0;

            check("saving the same plan twice settles the bill once, not twice",
                near(afterFirst, 400) && near(afterSecond, 400),
                `first ${afterFirst}, second ${afterSecond}`);

            const rows = await tx.voucherAllocation.count({
                where: { targetType: "UNIVERSAL_VOUCHER", targetId: idemBill, sourceId: idemReceipt },
            });
            check("and it leaves ONE allocation row for the pair, not two", rows === 1, `${rows} rows`);

            // ── 6b². The money side must equal the goods side ───────────────
            // A trading voucher whose payment rows do not add up to its total
            // cannot be given a ledger entry, and an edit that leaves it that
            // way must not be saved with the OLD ledger still standing.
            const balancedVoucher = (total: number, tender: number) => ({
                id: 0,
                type: "SALE",
                reference: "verify-tender",
                date: new Date(),
                description: "verify tender coverage",
                partyJson: null,
                subtotal: total, taxAmount: 0, shippingAmt: 0, roundOff: 0,
                totalAmount: total,
                tenders: [{ accountId: party, amount: tender }],
                charges: [],
            });

            const editable = await mk("SALE", "DEBIT", 1000, 5);
            const glBefore = await tx.voucherGlLine.findMany({
                where:  { universalVoucherId: editable },
                select: { accountId: true, type: true, amount: true },
                orderBy: { id: "asc" },
            });

            let refusedRebuild: unknown = null;
            try {
                await reapplyTradingVoucherInPlace(tx, {
                    // Goods say ₹1000, the payment rows say ₹400 — the shape of
                    // the voucher that broke.
                    voucher:        balancedVoucher(1000, 400) as never,
                    branchId:       "",
                    lines:          [],
                    journalEntryId: editable,
                    previousDate:   new Date(),
                });
            } catch (e) { refusedRebuild = e; }
            check("an edit whose payment rows no longer cover the total is refused",
                refusedRebuild instanceof GlBuildError,
                refusedRebuild instanceof Error ? refusedRebuild.message : "no error thrown");

            const glAfter = await tx.voucherGlLine.findMany({
                where:  { universalVoucherId: editable },
                select: { accountId: true, type: true, amount: true },
                orderBy: { id: "asc" },
            });
            check("and the ledger entry it already had is left exactly as it was",
                JSON.stringify(glBefore) === JSON.stringify(glAfter),
                `${glBefore.length} legs before, ${glAfter.length} after`);

            // ── 6c. A settled voucher cannot be edited out from under its link ──
            check("a voucher may still be edited while it covers what it settles",
                await (async () => {
                    try {
                        await assertLinksSurviveEdit(tx, { spineId: idemReceipt, partyBefore: party, partyAfter: party });
                        return true;
                    } catch { return false; }
                })());

            // Shrink the receipt below the ₹400 it has settled — the very edit
            // that used to leave the bill paid by money that no longer exists.
            await tx.voucherGlLine.updateMany({ where: { universalVoucherId: idemReceipt }, data: { amount: 100 } });
            let refusedEdit = false;
            try {
                await assertLinksSurviveEdit(tx, { spineId: idemReceipt, partyBefore: party, partyAfter: party });
            } catch (e) { refusedEdit = e instanceof BillLinkError; }
            check("refuses to shrink a voucher below what is settled against it", refusedEdit);

            let refusedParty = false;
            try {
                await assertLinksSurviveEdit(tx, { spineId: idemReceipt, partyBefore: party, partyAfter: bank.id });
            } catch (e) { refusedParty = e instanceof BillLinkError; }
            check("refuses to move a settled voucher onto another party", refusedParty);

            await tx.voucherGlLine.updateMany({ where: { universalVoucherId: idemReceipt }, data: { amount: 400 } });

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
                            branchId: await systemBranchId(tx),
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

    // ── 7b. An opening bill reaches the REPORTS, not just the link popup ───
    //
    // Checked against committed data rather than inside the rolled-back
    // transaction above, because `getLedgerOutstanding` reads through its own
    // client and cannot see uncommitted rows. This is the check whose absence
    // let the gap live: the harness proved opening bills were linkable, and
    // nobody asked whether Receivables could see them.
    const { getLedgerOutstanding } = await import("@/modules/accountancy/lib/outstandings");
    const anyOpening = await prisma.universalVoucher.findFirst({
        where:  { type: "OPENING", partyAccountId: { not: null }, status: "POSTED" },
        select: { id: true, partyAccountId: true, voucherNo: true },
        orderBy: { id: "desc" },
    });
    if (!anyOpening) {
        console.log("  · no bill-wise opening balances in this database — report check skipped");
    } else {
        const report = await getLedgerOutstanding(anyOpening.partyAccountId!, new Date());
        const row = report?.bills.find((b) => b.universalVoucherId === anyOpening.id);
        check("an opening bill shows up in the ledger's outstanding report",
            row !== undefined && row.voucherType === "OPENING",
            row ? `₹${row.outstanding}` : `${anyOpening.voucherNo ?? anyOpening.id} missing from ${report?.bills.length ?? 0} bills`);
    }

    // ── 8. Auto's priority and its promise not to override (pure, no database) ──
    //
    // The owner's rule, in their words: "kill overdue, then nearest due date, for
    // same due date lowest amount". Note bill DATE is deliberately not part of it
    // — B below is raised before D but falls due at the same time, and the
    // smaller of the two is settled first.
    const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
    const bill = (id: number, ref: string, days: number, due: number, open: number) => ({
        universalVoucherId: id, voucherType: "SALE", ref, date: day(days), dueDate: day(due),
        side: 1 as const, face: open, linked: 0, open,
    });
    const synthetic = [
        bill(1, "A", 30, 10, 400),    // overdue 10 days
        bill(2, "B", 20, 20, 400),    // overdue 20 days — but the bigger of the pair
        bill(3, "C", 10, -5, 500),    // not due for another 5 days
        bill(4, "D",  5, 20, 100),    // overdue 20 days, and the smaller — goes first
    ];

    // The order itself, asked of the comparator. (It cannot be read back off the
    // plan: a plan is keyed by voucher id, and JavaScript walks integer-like keys
    // in numeric order no matter which order they were put in.)
    const order = autoLinkOrder(synthetic).map((d) => d.universalVoucherId).join(",");
    check("Auto kills the most overdue first, smaller bill on a tie (D, B, A, then C)",
        order === "4,2,1,3", order);

    const { picks: auto } = planLinks(synthetic, 1000);
    check("Auto spends the money in that order — only the last bill is left part-paid",
        near(auto[4] ?? 0, 100) && near(auto[2] ?? 0, 400) && near(auto[1] ?? 0, 400) && near(auto[3] ?? 0, 100),
        Object.entries(auto).map(([id, a]) => `${id}:${a}`).join(" "));

    // The whole point of the rule: a hand-made choice survives Auto untouched,
    // and Auto is only allowed to spend what is still unplaced.
    const { picks: kept } = planLinks(synthetic, 1000, { existing: { 3: 500 } });
    check("Auto never overrides a manual tick — it fills only the remainder",
        near(kept[3] ?? 0, 500) && near(kept[4] ?? 0, 100) && near(kept[2] ?? 0, 400)
        && kept[1] === undefined
        && near(Object.values(kept).reduce((s, n) => s + n, 0), 1000),
        Object.entries(kept).map(([id, a]) => `${id}:${a}`).join(" "));

    const { picks: full } = planLinks(synthetic, 100, { existing: { 3: 500 } });
    check("a manual tick larger than the money is left alone, not trimmed to fit",
        near(full[3] ?? 0, 500) && Object.keys(full).length === 1,
        Object.entries(full).map(([id, a]) => `${id}:${a}`).join(" "));

    const { picks: ticked } = planLinks(synthetic, 1000, { pickedIds: [3] });
    check("ticking one bill fills only that bill",
        Object.keys(ticked).length === 1 && near(ticked[3] ?? 0, 500),
        Object.entries(ticked).map(([id, a]) => `${id}:${a}`).join(" "));

    // Ticks made on the form travel to the popup, which reloads the list. One
    // that no longer fits must be said out loud, not silently dropped at save.
    const gone = reconcilePicks(synthetic, { 99: 200, 4: 999 });
    check("a tick whose bill has gone is dropped, and an oversized one is trimmed",
        gone.picks[99] === undefined && near(gone.picks[4] ?? 0, 100)
        && gone.clamped.includes(99) && gone.clamped.includes(4),
        `clamped ${gone.clamped.join(",")}`);

    // Reset is a client-side act by design: a tick is only a proposal, so
    // clearing every one of them proposes nothing and leaves saved links alone.
    check("Reset (no ticks) proposes nothing, so saved links cannot be touched",
        Object.keys(planLinks(synthetic, 1000, { existing: {}, pickedIds: [] }).picks).length === 0);

    // ── 9. Who pays which bill, when the money comes from two places ───────
    //
    // The owner's case: ₹50 received closes ₹1,050 of bills, because the party
    // already had ₹1,000 lying with us. The receipt pays first, the credit
    // finishes the job, and every link is still one ordinary pair.
    const paid = assignSources(
        [{ id: 200, amount: 630 }, { id: 19, amount: 420 }],   // two bills, ₹1,050
        50,                                                     // the receipt
        [{ id: 17, amount: 1000 }],                             // credit already with us
    );
    const own = paid.find((p) => p.sourceId === null);
    const cred = paid.find((p) => p.sourceId === 17);
    check("the voucher pays first, the credit finishes the bills",
        own?.links.length === 1 && near(own.links[0].amount, 50) && own.links[0].universalVoucherId === 200
        && cred?.links.length === 2
        && near(cred.links[0].amount, 580) && near(cred.links[1].amount, 420),
        paid.map((p) => `${p.sourceId ?? "self"}:[${p.links.map((l) => `${l.universalVoucherId}=${l.amount}`).join(",")}]`).join(" "));

    const everyLink = paid.flatMap((p) => p.links).reduce((s, l) => s + l.amount, 0);
    check("and the links add up to exactly the bills being closed",
        near(everyLink, 1050), `${everyLink}`);

    // Nothing to spend, nothing assigned — a credit on its own settles no bill.
    check("a credit with no bill ticked produces no links",
        assignSources([], 0, [{ id: 17, amount: 1000 }]).length === 0);

    // The one rule both the create and the edit route now call. It is a pure
    // function precisely so neither route can hold its own private copy again.
    check("the payment rows must add up to the voucher total",
        tenderCoverageComplaint([{ amount: 400 }], 1000) !== null);
    check("rows that do add up pass",
        tenderCoverageComplaint([{ amount: 600 }, { amount: 400 }], 1000) === null);
    check("a paisa of rounding is not an error",
        tenderCoverageComplaint([{ amount: 999.99 }], 1000) === null);
    check("a voucher with no payment rows is left to the GL builder to judge",
        tenderCoverageComplaint([], 1000) === null);

    // Due dates are whole days on top of the bill date, computed in UTC so the
    // answer does not move with the machine's timezone.
    const dd = dueDateOf(new Date("2026-04-01T00:00:00.000Z"), 45);
    check("due date = bill date + credit period, in UTC",
        dd.toISOString().slice(0, 10) === "2026-05-16", dd.toISOString());
    check("a bill with no credit period falls due on the house default",
        dueDateOf(new Date("2026-04-01T00:00:00.000Z"), null).toISOString().slice(0, 10) === "2026-05-01");

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
