/**
 * Format an account's signed-by-normal-balance amount as "X,XXX.XX Dr"/"Cr"
 * for the "Cur Bal:" hint surfaced under account pickers in voucher dialogs.
 *
 * Convention: `balance` is positive when the account sits on its normal side
 * (e.g. an asset with a positive balance is Dr; a liability with a positive
 * balance is Cr). A negative balance flips the side label.
 */

import { fmt } from "@/utils/constants";
import { availableBalance } from "@/modules/accountancy/lib/facilityLimit";

export type BalanceShaped = {
    balance?: number | null;
    normalBalance?: "DEBIT" | "CREDIT" | null;
    // Present when the caller has a Bank OD A/c / Credit Card ledger on hand —
    // lets formatAvailable() below compute the "Available" figure.
    group?: { name?: string | null } | null;
    bankJson?: unknown;
    creditCardJson?: unknown;
};

export function formatBalanceWithSide(account: BalanceShaped | undefined | null): string {
    if (!account) return "";
    const v = account.balance ?? 0;
    if (v === 0) return "Nil";
    const nb = account.normalBalance;
    const onNormal = v > 0;
    const side = onNormal
        ? (nb === "CREDIT" ? "Cr" : "Dr")
        : (nb === "CREDIT" ? "Dr" : "Cr");
    return `${fmt(Math.abs(v))} ${side}`;
}

/** "Available: ₹X" for a Bank OD A/c / Credit Card ledger with a limit set —
 *  null when the account isn't one of those, or has no limit entered. */
export function formatAvailable(account: BalanceShaped | undefined | null): string | null {
    if (!account) return null;
    const available = availableBalance({ ...account, balance: account.balance ?? 0 });
    return available == null ? null : fmt(available);
}
