import type { Prisma } from "@/generated/prisma/client";
import { resolveEffectiveCreditLimit } from "./creditLimit";
import { closingForAccounts } from "@/modules/accountancy/lib/aggregateLedger";

// ── CreditLimitError ─────────────────────────────────────────────────────────
// Thrown by checkCreditLimit when a sale would breach the account's credit
// limit.  Route catch-blocks use `instanceof CreditLimitError` to return 422
// instead of the default 500.

/** Everything the office's "raise the limit" dialog needs to explain itself and
 *  suggest a number — carried on the error so the screen never has to ask the
 *  server a second question about the same refusal. Absent on the walk-in
 *  refusal, which no limit can fix. */
export type CreditLimitDetail = {
    accountId:   number;
    /** Effective limit that was applied — max(manual, auto). */
    limit:       number;
    /** The customer's own Account.creditLimit (0 when never set). */
    manualLimit: number;
    /** Signed ledger balance; positive = the customer owes us. */
    balance:     number;
    /** What this sale puts on credit. */
    onCredit:    number;
    /** balance + onCredit — the limit needed for this sale to pass. */
    required:    number;
};

export class CreditLimitError extends Error {
    readonly code: "CREDIT_LIMIT_EXCEEDED" | "NO_CREDIT_ALLOWED" | "NO_NAMED_CUSTOMER";
    readonly detail: CreditLimitDetail | null;
    constructor(
        reason: string,
        code: "CREDIT_LIMIT_EXCEEDED" | "NO_CREDIT_ALLOWED" | "NO_NAMED_CUSTOMER" = "CREDIT_LIMIT_EXCEEDED",
        detail: CreditLimitDetail | null = null,
    ) {
        super(reason);
        this.name = "CreditLimitError";
        this.code = code;
        this.detail = detail;
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
// An anonymous ledger (no person / no company behind it — the walk-in cash
// customer, a counter ledger) never gets credit, whatever its limit says.
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
        select: { creditLimit: true, personId: true, companyId: true },
    });

    // Unknown account — let the FK constraint handle it.
    if (!account) return;

    // Credit needs someone to collect FROM. An anonymous ledger — the seeded
    // "Walk-in Cash Customer", a counter ledger — has no person or company
    // behind it, so a due on it can never be chased. Refused before the limit
    // is even read, so a stray limit typed onto that ledger cannot open a door
    // to nameless credit.
    if (account.personId === null && account.companyId === null) {
        // No detail: raising a limit cannot fix this one, so the office dialog
        // must not offer to.
        throw new CreditLimitError(
            "Walk-in customer — credit needs a named customer. Attach one, or collect the full amount.",
            "NO_NAMED_CUSTOMER",
        );
    }

    // Effective limit = max(manual, auto). Manual null → 0; auto is 0 unless the
    // config switches it on. Both 0 → no credit (deny-by-default).
    const manual  = account.creditLimit === null ? 0 : Number(account.creditLimit);
    const { effective: limit } = await resolveEffectiveCreditLimit(tx, accountId, manual);
    // What the customer owes, summed from this one account's GL lines plus its
    // master opening — not the `Account.balance` cache. This is the gate that
    // decides whether goods leave the counter unpaid, so it reads the ledger
    // itself: a cache that has drifted low silently extends credit nobody
    // approved. One account, indexed, on the counter's own replica — the read
    // is cheap enough that there is no case for the cached column here.
    //
    // Runs on `tx` before the sale writes anything, so the figure is the
    // customer's pre-sale position, exactly as `additionalDebit` assumes.
    //
    // No date ceiling (`asOf = null`): a sale dated next week is still money
    // owed, and the cache this replaces counted it too. Excluding it would
    // understate the balance and widen the limit.
    const current = (await closingForAccounts(null, [accountId], tx)).get(accountId) ?? 0;

    const detail: CreditLimitDetail = {
        accountId,
        limit,
        manualLimit: manual,
        balance:     current,
        onCredit:    additionalDebit,
        required:    current + additionalDebit,
    };

    if (limit === 0) {
        throw new CreditLimitError(
            "No credit facility — the sale must be paid in full.",
            "NO_CREDIT_ALLOWED",
            detail,
        );
    }

    if (current + additionalDebit > limit) {
        throw new CreditLimitError(
            `Credit limit ₹${limit.toLocaleString("en-IN")} exceeded. ` +
            `Outstanding: ₹${Math.max(0, current).toLocaleString("en-IN")}, ` +
            `this sale adds: ₹${additionalDebit.toLocaleString("en-IN")} on credit.`,
            "CREDIT_LIMIT_EXCEEDED",
            detail,
        );
    }
}

// ── checkSaleCreditLimit ─────────────────────────────────────────────────────
// The office form of the same rule. On an office sale the unpaid part is a
// tender row pointing at the party's OWN ledger (the read-only "Balance" row —
// see tenderCoverageComplaint), so that row IS the credit being taken. One
// place to read it, so the create path and the post-a-draft path cannot come to
// different answers about the same voucher.
//
// SALE only, deliberately: POS calls checkCreditLimit itself with the shortfall
// it worked out, and ONLINE_INVOICE stays out so a webshop order is not refused
// at the invoicing step by a limit the shopper never saw.
export async function checkSaleCreditLimit(
    tx: Prisma.TransactionClient,
    voucher: {
        type:            string;
        partyAccountId?: number | null;
        tenders:         Array<{ accountId: number; amount: Prisma.Decimal | number | string }>;
    },
): Promise<void> {
    if (voucher.type !== "SALE") return;
    const partyLedgerId = voucher.partyAccountId;
    if (partyLedgerId == null) return;

    const onCredit = voucher.tenders
        .filter((t) => t.accountId === partyLedgerId)
        .reduce((sum, t) => sum + Number(t.amount), 0);

    // Sub-paise residue is rounding, not credit — the same tolerance the counter
    // applies to its own shortfall.
    if (onCredit > 0.005) await checkCreditLimit(tx, partyLedgerId, onCredit);
}
