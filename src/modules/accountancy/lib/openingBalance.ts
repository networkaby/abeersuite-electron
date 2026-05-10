// Opening balance helpers — keep the "Difference in Opening Balances" suspense
// ledger in sync whenever an Account or InvProduct opening figure changes.
// Reports read Account.openingBalance directly (see aggregateLedger.ts), so the
// suspense account just needs its own openingBalance kept current and reports
// will fall in line.

import { prisma } from "@/shared/lib/prisma/prismaClient";

const SUSPENSE_NAME = "Difference in Opening Balances";

/** Recomputes the opening-balance imbalance and stores it on the suspense
 *  ledger so the trial balance ties. Safe to call after any opening edit. */
export async function reconcileOpeningSuspense(): Promise<void> {
    const suspense = await prisma.account.findFirst({
        where: { name: SUSPENSE_NAME },
        select: { id: true },
    });
    if (!suspense) return; // Suspense ledger not seeded — nothing to do.

    const accounts = await prisma.account.findMany({
        where: {
            openingBalance: { not: null },
            id: { not: suspense.id },
        },
        select: { openingBalance: true, openingBalanceType: true },
    });

    let drTotal = 0, crTotal = 0;
    for (const a of accounts) {
        const amt = Number(a.openingBalance ?? 0);
        if (a.openingBalanceType === "DEBIT") drTotal += amt;
        else if (a.openingBalanceType === "CREDIT") crTotal += amt;
    }

    // Convention: more Dr than Cr → park residual as a Cr in suspense (acts as a credit
    // until the user adds the missing capital / loan).
    const diff = drTotal - crTotal;
    if (Math.abs(diff) < 0.005) {
        await prisma.account.update({
            where: { id: suspense.id },
            data: {
                openingBalance:     null,
                openingBalanceType: null,
                openingBalanceDate: null,
            },
        });
        return;
    }
    await prisma.account.update({
        where: { id: suspense.id },
        data: {
            openingBalance:     Math.abs(diff),
            openingBalanceType: diff > 0 ? "CREDIT" : "DEBIT",
            openingBalanceDate: new Date(),
        },
    });
}
