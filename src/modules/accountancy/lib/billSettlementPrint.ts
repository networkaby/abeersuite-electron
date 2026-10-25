import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { Prisma } from "@/generated/prisma/client";
import { toNumber } from "@/modules/accountancy/lib/balance";
import { loadTenderLines } from "@/modules/accountancy/lib/outstandings";
import { partyBalanceAroundVoucher } from "@/shared/lib/accountancy/partyLedgerBalance";
import { round2 } from "@/shared/lib/format";

// ── Printed settlement of one bill ───────────────────────────────────────────
//
// The "Received in · Balance due · Previous / Closing balance" block both the
// office SALE print (voucherReceiptSample) and the POS counter print
// (InvoiceReceipt) carry. One reader, so a POS reprint and a Sale reprint can
// never disagree about what a bill still owes.

export interface BillSettlementPrint {
    /** Money received against the bill, one row per tender ledger / link. */
    receipts:      { label: string; amount: number }[] | null;
    /** Still owed on THIS bill; null when it is fully paid. */
    balanceDue:    number | null;
    /** Party's running account around the bill, "₹ 1,234.00 Dr". */
    balanceBefore: string | null;
    balanceAfter:  string | null;
}

export async function loadBillSettlementPrint({
    uvId, partyAccountId, total, partyBalance,
}: {
    uvId:           number | null | undefined;
    partyAccountId: number | null | undefined;
    total:          number;
    /** Read the party's running account too. It sums the party's whole ledger,
     *  so callers ask only when it will print (template toggle on, a named party). */
    partyBalance:   boolean;
}): Promise<BillSettlementPrint> {
    // ── What has actually been received against this bill ───────────────────
    // The LEDGER is the truth, not the form's settlement input. Two sources,
    // exactly as the Outstandings report computes `paid`:
    //   1. role=TENDER GL lines on this voucher — cash/UPI/bank taken AT the
    //      counter. The party's own AR leg is excluded: on a credit sale that
    //      row is the amount still OWED, not money received.
    //   2. VoucherAllocation rows targeting this voucher — an ADVANCE taken
    //      before the bill existed, or a RECEIPT entered afterwards. Reading
    //      these is what makes a reprint show payments made since the sale —
    //      and what settles a POS bill the customer overpaid, whose money sits
    //      on the linked RV-… receipt rather than on the bill's own tenders.
    const [tenderLines, allocations] = await Promise.all([
        uvId != null
            ? loadTenderLines(prisma, [uvId])
            : Promise.resolve(new Map<number, { accountId: number; amount: number }[]>()),
        // BOTH sides of the link, not just the target side. A bill is the target
        // only when it is the receivable one; a PURCHASE settled against a sale —
        // the dual-role party the whole feature exists for — sits on the SOURCE
        // side, and reading one side alone printed it as still fully unpaid. That
        // is a wrong number handed to a supplier.
        uvId != null
            ? prisma.voucherAllocation.findMany({
                where: {
                    targetType: "UNIVERSAL_VOUCHER",
                    sourceType: { in: ["VOUCHER", "PAYMENT"] },
                    OR: [{ targetId: uvId }, { sourceId: uvId }],
                },
                select: { targetId: true, sourceId: true, amount: true, reference: true },
            })
            : Promise.resolve([] as { targetId: number; sourceId: number; amount: Prisma.Decimal; reference: string | null }[]),
    ]);

    // Only a link whose other end is still alive settles anything — the same rule
    // `sumLinked` applies, so the printed figure and the ledger cannot disagree.
    // The bill rides the same read for its shift (see `visitIds` below).
    const otherEnds = [...new Set(allocations.map((a) => (a.targetId === uvId ? a.sourceId : a.targetId)))];
    const ends = otherEnds.length === 0 ? [] : await prisma.universalVoucher.findMany({
        where:  { id: { in: uvId != null ? [...otherEnds, uvId] : otherEnds } },
        select: { id: true, status: true, sourceShiftId: true },
    });
    const liveEnds = new Set(
        ends.filter((r) => r.id !== uvId && r.status === "POSTED").map((r) => r.id),
    );

    // The bill plus every live voucher linked to it on the SAME POS shift — the
    // RV-… an overpayment books alongside the sale, or a Rcv taken in the same
    // sitting. The party balance treats them as one visit, so "Previous balance"
    // is the balance before the customer walked up, not their old dues already
    // netted off by this visit's own receipt. Office bills carry no shift.
    const billShift = ends.find((r) => r.id === uvId)?.sourceShiftId ?? null;
    const visitIds = [
        ...(uvId != null ? [uvId] : []),
        ...(billShift == null ? [] : ends
            .filter((r) => liveEnds.has(r.id) && r.sourceShiftId === billShift)
            .map((r) => r.id)),
    ];

    const tenders = (uvId != null ? tenderLines.get(uvId) ?? [] : [])
        .filter((t) => Math.abs(t.amount) > 0.005 && t.accountId !== partyAccountId);
    const [tenderAcctNames, ledgerBalance] = await Promise.all([
        tenders.length
            ? prisma.account.findMany({
                where:  { id: { in: [...new Set(tenders.map((t) => t.accountId))] } },
                select: { id: true, name: true },
            }).then((rows) => new Map(rows.map((a) => [a.id, a.name])))
            : Promise.resolve(new Map<number, string>()),
        // Party's running account around this bill. Rendered only when the
        // template opts in (`showPartyBalance`) — it discloses the customer's
        // whole outstanding on a document that may be handed to anyone.
        partyBalance ? partyBalanceAroundVoucher(partyAccountId, visitIds) : Promise.resolve(null),
    ]);

    const receipts: { label: string; amount: number }[] = tenders.map((t) => ({
        label:  tenderAcctNames.get(t.accountId) ?? "Received",
        amount: t.amount,
    }));
    for (const a of allocations) {
        const amt = toNumber(a.amount);
        if (Math.abs(amt) < 0.005) continue;
        if (a.targetId === a.sourceId) continue;
        const other = a.targetId === uvId ? a.sourceId : a.targetId;
        if (!liveEnds.has(other)) continue;
        // Every link written today is an AGAINST_REF one; the old ADVANCE branch
        // that used to label these was reading a method nothing writes any more,
        // so it never once chose the other wording.
        receipts.push({
            label:  a.reference ? `Payment adjusted (${a.reference})` : "Payment adjusted",
            amount: amt,
        });
    }
    const balanceDue = round2(total - receipts.reduce((s, r) => s + r.amount, 0));

    return {
        receipts:      receipts.length ? receipts : null,
        balanceDue:    balanceDue > 0.005 ? balanceDue : null,
        balanceBefore: ledgerBalance ? ledgerBalance.format(ledgerBalance.before) : null,
        balanceAfter:  ledgerBalance ? ledgerBalance.format(ledgerBalance.after)  : null,
    };
}
