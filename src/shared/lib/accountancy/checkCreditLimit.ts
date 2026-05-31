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
// Rules (deny-by-default — credit is a privilege that must be granted):
//   creditLimit IS NULL  → treated exactly like 0 — NO credit sales allowed
//   creditLimit IS 0     → no credit sales allowed; any additionalDebit > 0 throws
//   creditLimit > 0      → throws when (current balance + additionalDebit) > creditLimit
//   An explicit POSITIVE limit is the ONLY way to permit a credit sale.
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

    // Unknown account — let the FK constraint handle it.
    if (!account) return;

    // Deny-by-default: a NULL limit is treated exactly like 0 (no credit). An
    // account can only buy on credit when an explicit positive limit is set.
    const limit   = account.creditLimit === null ? 0 : Number(account.creditLimit);
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
