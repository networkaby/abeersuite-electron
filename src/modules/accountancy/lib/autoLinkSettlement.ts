// Auto bill-wise linking for a settlement voucher (a RECEIPT or a PAYMENT) — the
// writing half. The planning half, which never touches the global client, is
// `autoLinkPlan.ts`.
//
// THE PROBLEM THIS EXISTS FOR
//
// A bill and the money that settles it are two separate vouchers. The party's
// ledger balance comes out right either way — both vouchers touch their account,
// one Dr and one Cr — but "which bills are still open" can only be answered by a
// `VoucherAllocation` row saying this receipt settles that bill. No link row, no
// settlement, and the bill stands open for ever.
//
// Only one door ever wrote those rows: the POS sale's collect-on-the-go surplus
// (`/api/pos/sale`). The two plain "party is settling up" doors — the counter's
// receipt panel and the office Receipt/Payment form — wrote none. On live that
// left 413 of 483 posted settlements unlinked, ₹27,00,512 across 177 parties, and
// customers shown as overdue for bills they had paid the same day. Because the
// credit limit reads the same figure, it could also refuse a credit sale to
// someone who owed nothing.
//
// WHY IT RUNS AFTER THE VOUCHER'S OWN TRANSACTION, NOT INSIDE IT
//
// Every refusal `assertLinkPlan` can raise is a `BillLinkError` thrown inside the
// caller's transaction. Hooked into the receipt's own save, ANY of them — a
// deactivated party ledger, a party sitting outside Sundry Debtors/Creditors, a
// bill someone else settled a moment earlier — would roll the whole save back.
// The cashier would not lose a link; they would lose the receipt, with the money
// already in the drawer, and no way to explain it.
//
// So linking is a second, separate transaction that runs once the voucher is
// safely committed and posted, and it NEVER throws at its caller: a refusal comes
// back as `skipped` and the voucher simply stays unlinked — which is what every
// one of them used to be, and what `pnpm reconcile:bill-links` can put right at
// any time. Standing apart from the save is also what lets it use the FULL
// validated path rather than the unchecked shortcut `postSettlementVoucher` must
// take inside its own transaction, hold the same party lock the manual popup
// holds, and take the 30s it may need on a party with a long history instead of
// the caller's 5s default.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { assertLinkPlan, createLink, BillLinkError } from "./billLink";
import { planAutoLink, nothingToLink, type AutoLinkOutcome } from "./autoLinkPlan";

// One import site for callers: the doors want the plan types too, and should not
// have to know which half a name lives in.
export { planAutoLink, AUTO_SETTLES } from "./autoLinkPlan";
export type { AutoLinkOutcome, AutoLinkPlanLine } from "./autoLinkPlan";

/**
 * Plan and WRITE the links for one settlement voucher, in its own transaction.
 *
 * Never throws. A refusal, a lock timeout, a party ledger deactivated since —
 * all of it comes back as `skipped`, because the caller is a save that has
 * already taken the party's money and must not be undone by a bookkeeping
 * nicety.
 */
export async function autoLinkSettlement(args: {
    /** The spine id of the POSTED receipt / payment. */
    voucherId: number;
    /** The party ledger the link is measured on. */
    accountId: number;
    userId:    number;
    /** Stamped on the link rows, so the ledger shows where they came from. */
    reference?: string | null;
}): Promise<AutoLinkOutcome> {
    try {
        return await prisma.$transaction(async (tx) => {
            // One lock per party — the same one the manual popup takes. The pair
            // unique key stops a second ROW for a pair, not a doubled amount on
            // the one row, so without this two tills can read the same open room
            // on a bill and both spend it.
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(4711, ${args.accountId})`;

            const planned = await planAutoLink(tx, args);
            if (planned.links.length === 0) return planned;

            const plan = await assertLinkPlan(tx, {
                accountId: args.accountId,
                voucherId: args.voucherId,
                links:     planned.links.map((l) => ({ voucherId: l.universalVoucherId, amount: l.amount })),
                // "set" = what the pair should TOTAL. A retry then lands on the
                // same figure instead of adding a second helping.
                mode:      "set",
            });
            for (const link of plan) {
                await createLink(tx, {
                    targetId:  link.targetId,
                    sourceId:  link.sourceId,
                    amount:    link.amount,
                    reference: args.reference ?? null,
                    userId:    args.userId,
                    mode:      "set",
                });
            }
            return planned;
        }, { timeout: 30_000, maxWait: 10_000 });
    } catch (e) {
        // Deliberately swallowed — see the header. The voucher is already saved
        // and correct on the ledger; only the bill-wise link is missing, and that
        // is recoverable at any time.
        const why = e instanceof BillLinkError ? e.message : "could not be linked automatically";
        console.warn(`[autoLinkSettlement] voucher ${args.voucherId} left unlinked: ${why}`);
        return nothingToLink(why);
    }
}
