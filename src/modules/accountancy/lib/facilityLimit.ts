// "Available" balance for revolving-credit ledgers (Bank OD A/c, Credit Card) —
// how much more can still be drawn against the sanctioned limit right now.
//
// `balance` follows the app-wide signed convention (positive = the account's
// normal side). OD/Credit Card are always Credit-normal, so a positive balance
// is money drawn against the facility and a negative balance is our own money
// sitting in it beyond zero (e.g. we deposited into the OD account without
// ever drawing on it). Available = Limit − balance handles both directions
// without clamping — deposit past zero and Available rises above the limit;
// draw past the limit and Available goes negative (a visible over-limit flag).

import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { parseBank } from "@/modules/accountancy/lib/bankParticulars";
import { parseCreditCard } from "@/modules/accountancy/lib/creditCardParticulars";

type LimitShaped = {
    group?: { name?: string | null } | null;
    bankJson?: unknown;
    creditCardJson?: unknown;
};

/** The sanctioned limit for this ledger, or null when it's not an OD/Credit
 *  Card ledger, or the limit was never entered. */
export function accountLimit(account: LimitShaped): number | null {
    const groupName = account.group?.name;
    if (groupName === ACCOUNT_GROUPS.BANK_OD) {
        const raw = parseBank(account.bankJson).limit;
        const n = Number(raw);
        return raw !== "" && Number.isFinite(n) ? n : null;
    }
    if (groupName === ACCOUNT_GROUPS.CREDIT_CARD) {
        const raw = parseCreditCard(account.creditCardJson).limit;
        const n = Number(raw);
        return raw !== "" && Number.isFinite(n) ? n : null;
    }
    return null;
}

/** Available = Limit − signed balance. Not clamped — see file header. */
export function computeAvailable(limit: number, balance: number): number {
    return limit - balance;
}

/** Convenience: resolve the limit from the account, then compute Available.
 *  Returns null when there's no limit to compute against. */
export function availableBalance(account: LimitShaped & { balance?: number | null }): number | null {
    const limit = accountLimit(account);
    if (limit == null) return null;
    return computeAvailable(limit, account.balance ?? 0);
}
