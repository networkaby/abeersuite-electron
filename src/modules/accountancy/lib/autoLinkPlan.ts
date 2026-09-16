// Which of a party's open bills a settlement voucher should clear — the planning
// half of `autoLinkSettlement.ts`.
//
// Split out for the same reason `billLinkPlan.ts` is split out of `billLink.ts`:
// everything here takes the database handle it is given and never reaches for the
// app's global client, so the reconciliation script can plan against its own
// connection, and the live doors can plan inside a transaction they already hold.
// It is the one planner — the counter, the office and the script all call it, so
// a dry run genuinely predicts what `--fix` will do.

import type { Prisma } from "@/generated/prisma/client";
import { loadLinkableDocs, planLinks, EPS, type LinkableDoc } from "./billLink";
import { round2 } from "@/shared/lib/format/moneyInr";

/**
 * The document kinds Auto is allowed to settle.
 *
 * `loadLinkableDocs` is wider than this on purpose — it returns every document
 * with an open party leg, which includes other unlinked receipts and payments.
 * Netting one settlement against another is a real thing the books allow, but it
 * is a judgement about two payments rather than an obvious consequence of taking
 * money at a till, so Auto leaves that to a person in the bill-link popup and
 * touches only bill-shaped documents here.
 */
export const AUTO_SETTLES = new Set([
    "SALE", "POS", "PURCHASE", "OPENING", "CREDIT_NOTE", "DEBIT_NOTE",
]);

export type AutoLinkPlanLine = {
    universalVoucherId: number;
    voucherType:        string;
    ref:                string;
    dueDate:            string;
    /** What this bill still had open before anything was placed on it. */
    open:               number;
    /** What this settlement puts on it. */
    amount:             number;
};

export type AutoLinkOutcome = {
    /** What was linked — or, in a dry run, what would be. */
    links:         AutoLinkPlanLine[];
    /** Σ `links[].amount`. */
    linkedTotal:   number;
    /** The part of the settlement no open bill could take — stays as an advance. */
    leftAsAdvance: number;
    /** Set when nothing was linked and the reason is worth reporting. */
    skipped:       string | null;
};

export const nothingToLink = (skipped: string | null): AutoLinkOutcome => ({
    links: [], linkedTotal: 0, leftAsAdvance: 0, skipped,
});

/**
 * Plan, without writing anything, which open bills this settlement should clear.
 *
 * Reads the party's documents off their own GL legs — NOT off `role=TENDER`
 * tags, which an edit can destroy and nothing can rebuild — so it is honest
 * about cash bills, and it sees bill-wise OPENING vouchers, which the counter's
 * older `getOpenSaleBillsForFifo` cannot. Being side-agnostic, a PAYMENT against
 * purchase bills runs through exactly the same path as a RECEIPT against sales.
 */
export async function planAutoLink(
    db: Prisma.TransactionClient,
    args: {
        voucherId: number;
        accountId: number;
        /**
         * Room on bills that an EARLIER plan in this same run has already spoken
         * for, keyed by spine id — only for a caller planning several settlements
         * against one party without writing in between.
         *
         * A write path never needs it: each link is committed before the next is
         * planned, so the next read already sees the reduced room. A DRY RUN does,
         * and badly. Two receipts for one customer, planned independently, would
         * each be shown clearing the same ₹18,350 bill in full — a listing that
         * promises twice what `--fix` will actually do. `--fix` itself is safe
         * either way (it re-plans inside the transaction and `assertLinkPlan`
         * refuses the overflow), but a dry run the owner cannot trust is worse
         * than no dry run at all.
         */
        reserved?: Map<number, number>;
    },
): Promise<AutoLinkOutcome> {
    // One read serves both halves: the settlement's own remaining room, and every
    // document on the other side it could be spent on.
    const docs = await loadLinkableDocs(db, args.accountId);

    const self = docs.find((d) => d.universalVoucherId === args.voucherId);
    // Absent means it has nothing left to place — either every rupee is already
    // linked, or it has no leg on this party at all.
    if (!self) return nothingToLink("already fully linked, or no leg on this party");

    const budget = round2(self.open);
    if (budget <= EPS) return nothingToLink("nothing left to place");

    // A receipt's own leg credits the party, so the bills it settles are the ones
    // that debit them — always the opposite side. Reading the side off the leg
    // rather than off the voucher type is what makes this work unchanged for a
    // PAYMENT, and for a party who is both our customer and our supplier.
    const wantSide = (self.side === 1 ? -1 : 1) as 1 | -1;
    const targets: LinkableDoc[] = docs
        .filter((d) => d.universalVoucherId !== args.voucherId
            && d.side === wantSide
            && AUTO_SETTLES.has(d.voucherType))
        // Take off whatever an earlier settlement in this same run already spoke
        // for, then drop anything left with no room.
        .map((d) => {
            const held = args.reserved?.get(d.universalVoucherId) ?? 0;
            return held > 0 ? { ...d, open: round2(d.open - held) } : d;
        })
        .filter((d) => d.open > EPS);
    if (targets.length === 0) return nothingToLink("no open bills on the other side");

    // The house order — overdue first, then nearest due date, smaller bill on a
    // tie — so the counter, the office Auto button and this all clear the same
    // bill with the same rupee. Leftover is not an error: it stays as the party's
    // advance, ready for the next bill.
    const { picks } = planLinks(targets, budget);
    const byId = new Map(targets.map((d) => [d.universalVoucherId, d]));

    const links: AutoLinkPlanLine[] = Object.entries(picks)
        .map(([id, amount]) => {
            const doc = byId.get(Number(id))!;
            return {
                universalVoucherId: doc.universalVoucherId,
                voucherType:        doc.voucherType,
                ref:                doc.ref,
                dueDate:            doc.dueDate,
                open:               doc.open,
                amount:             round2(amount),
            };
        })
        .filter((l) => l.amount > EPS)
        .sort((a, b) => (a.dueDate < b.dueDate ? -1
            : a.dueDate > b.dueDate ? 1
            : a.universalVoucherId - b.universalVoucherId));

    const linkedTotal = round2(links.reduce((s, l) => s + l.amount, 0));
    return {
        links,
        linkedTotal,
        leftAsAdvance: round2(budget - linkedTotal),
        skipped:       links.length === 0 ? "no open bill could take any of it" : null,
    };
}
