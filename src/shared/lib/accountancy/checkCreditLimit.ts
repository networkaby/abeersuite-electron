import type { Prisma } from "@/generated/prisma/client";

// ── CreditLimitError ─────────────────────────────────────────────────────────
// Thrown by checkCreditLimit when a sale would breach the account's credit
// limit.  Route catch-blocks use `instanceof CreditLimitError` to return 422
// instead of the default 500.

export class CreditLimitError extends Error {
    readonly code: "CREDIT_LIMIT_EXCEEDED" | "NO_CREDIT_ALLOWED";
    constructor(
        reason: string,
        code: "CREDIT_LIMIT_EXCEEDED" | "NO_CREDIT_ALLOWED" = "CREDIT_LIMIT_EXCEEDED",
    ) {
        super(reason);
        this.name = "CreditLimitError";
        this.code = code;
    }
}

// ── checkCreditLimit ─────────────────────────────────────────────────────────
// Must be called INSIDE a prisma.$transaction so the balance read is fresh
// and consistent with the writes that follow.
//
// Rules:
//   creditLimit IS NULL  → no restriction; returns silently (unlimited account)
//   creditLimit IS 0     → no credit sales allowed; any additionalDebit > 0 throws
//   otherwise            → throws when (current balance + additionalDebit) > creditLimit
//
// @param tx              Prisma transaction client
// @param accountId       Customer AR account id (Account.id)
// @param additionalDebit Amount being added to AR — i.e. the on-credit portion
//                        of the sale.  Pass 0 for fully-collected cash sales.

export async function checkCreditLimit(
    tx: Prisma.TransactionClient,
    accountId: number,
    additionalDebit: number,
): Promise<void> {
    // Fully-paid sale — nothing is being added to AR, nothing to check.
    if (additionalDebit <= 0) return;

    const account = await tx.account.findUnique({
        where:  { id: accountId },
        select: { creditLimit: true, balance: true },
    });

    // Unknown account or unlimited credit — let the FK constraint handle
    // the former; skip the check for the latter.
    if (!account || account.creditLimit === null) return;

    const limit   = Number(account.creditLimit);
    const current = Number(account.balance);    // positive = customer owes us

    if (limit === 0) {
        throw new CreditLimitError(
            "No credit facility — the sale must be paid in full.",
            "NO_CREDIT_ALLOWED",
        );
    }

    if (current + additionalDebit > limit) {
        throw new CreditLimitError(
            `Credit limit ₹${limit.toLocaleString("en-IN")} exceeded. ` +
            `Outstanding: ₹${Math.max(0, current).toLocaleString("en-IN")}, ` +
            `this sale adds: ₹${additionalDebit.toLocaleString("en-IN")} on credit.`,
        );
    }
}
