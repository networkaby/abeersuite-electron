import type { Prisma } from "@/generated/prisma/client";
import { resolveEffectiveCreditLimit } from "./creditLimit";
import { effectiveAccountBalance, EFFECTIVE_BALANCE_SELECT_FIELDS } from "@/modules/accountancy/lib/balance";

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
// The EFFECTIVE limit is resolved via resolveEffectiveCreditLimit — the higher
// of the per-customer manual limit and the config-driven AUTO limit (Y% of the
// customer's sales in the last X days). With auto OFF this is deny-by-default:
//   effective IS 0   → no credit sales allowed; any additionalDebit > 0 throws
//   effective > 0    → throws when (current balance + additionalDebit) > effective
// With auto ON a customer with no manual limit can still buy on credit up to
// their auto number.
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
        select: { creditLimit: true, ...EFFECTIVE_BALANCE_SELECT_FIELDS },
    });

    // Unknown account — let the FK constraint handle it.
    if (!account) return;

    // Effective limit = max(manual, auto). Manual null → 0; auto is 0 unless the
    // config switches it on. Both 0 → no credit (deny-by-default).
    const manual  = account.creditLimit === null ? 0 : Number(account.creditLimit);
    const { effective: limit } = await resolveEffectiveCreditLimit(tx, accountId, manual);
    // Effective balance — cached GL movements PLUS the master opening balance,
    // the same figure the Persons list / ledger report / trial balance show. A
    // bare `Account.balance` misses an opening-balance-only customer entirely.
    const current = effectiveAccountBalance(account);    // positive = customer owes us

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
