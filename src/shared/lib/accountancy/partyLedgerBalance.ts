import { prisma } from "@/shared/lib/prisma/prismaClient";
import { toNumber, balanceDelta } from "@/modules/accountancy/lib/balance";
import { ledgerStatusFilterUv } from "@/modules/accountancy/lib/aggregateLedger";
import { defaultNormalBalanceForGroupType } from "@/modules/accountancy/lib/groupNature";

/**
 * Party ledger balance around one voucher — what the party owed BEFORE it and
 * what they owe AFTER it.
 *
 * "After" = opening balance + every POSTED line on the account; "before" = that
 * minus this voucher's own lines. Deriving `before` by subtraction (rather than
 * summing everything dated earlier) keeps a reprint correct no matter when it
 * happens or what was entered in between.
 *
 * Returns null when the voucher has no party ledger — a walk-in has no account,
 * so there is no balance to print.
 */
export interface PartyLedgerBalance {
    before:  number;
    after:   number;
    /** "Rs. 1,234.00 Dr" — signed onto the account's normal side. */
    format:  (n: number) => string;
}

export async function partyBalanceAroundVoucher(
    partyAccountId: number | null | undefined,
    universalVoucherId: number | null | undefined,
): Promise<PartyLedgerBalance | null> {
    if (partyAccountId == null) return null;

    const acct = await prisma.account.findUnique({
        where:  { id: partyAccountId },
        select: {
            normalBalance: true, openingBalance: true, openingBalanceType: true,
            group: { select: { type: true } },
        },
    });
    if (!acct) return null;

    const nb = acct.normalBalance
        ?? (acct.group?.type ? defaultNormalBalanceForGroupType(acct.group.type) : "DEBIT");

    const [allLines, ownLines] = await Promise.all([
        prisma.voucherGlLine.findMany({
            where:  { accountId: partyAccountId, universalVoucher: ledgerStatusFilterUv() },
            select: { type: true, amount: true },
        }),
        universalVoucherId != null
            ? prisma.voucherGlLine.findMany({
                where:  { accountId: partyAccountId, universalVoucherId },
                select: { type: true, amount: true },
            })
            : Promise.resolve([]),
    ]);

    let after = allLines.reduce((bal, l) => bal + balanceDelta(nb, l.type, toNumber(l.amount)), 0);
    if (acct.openingBalance && acct.openingBalanceType) {
        after += balanceDelta(nb, acct.openingBalanceType, toNumber(acct.openingBalance));
    }
    const own    = ownLines.reduce((bal, l) => bal + balanceDelta(nb, l.type, toNumber(l.amount)), 0);
    const before = after - own;

    // Positive = the account's normal side (customer Dr / supplier Cr).
    const format = (n: number) => {
        const side = n >= 0
            ? (nb === "DEBIT" ? "Dr" : "Cr")
            : (nb === "DEBIT" ? "Cr" : "Dr");
        const amt = Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return `Rs. ${amt} ${side}`;
    };

    return { before, after, format };
}
