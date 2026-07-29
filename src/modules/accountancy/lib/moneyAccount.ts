// Which ledgers hold real, spendable money — the single definition behind every
// "Paid from" / "Received in" / payment-account / settlement-ledger picker.
//
// Bank OD A/c is included: an overdraft account IS a normal current account at
// the bank. You pay suppliers out of it and customers deposit into it, exactly
// like a plain Bank Accounts ledger. It only sits under Loans (Liability) in the
// chart of accounts because its normal balance is credit, and that placement is
// a *reporting* fact — the Balance Sheet, Ratio Analysis and Usable Fund keep
// treating it as the liability/facility it is. Outside reports it is just a bank
// account, so voucher entry must not hide it.
//
// Credit Card / BNPL / Wallets / Payment Gateway are deliberately NOT here.
// Those are special-purpose facilities, not deposit accounts.

import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";

/** Group names whose ledgers can be the money side of a voucher. */
export const MONEY_ACCOUNT_GROUPS: readonly string[] = [
    ACCOUNT_GROUPS.CASH_IN_HAND,
    ACCOUNT_GROUPS.BANK_ACCOUNTS,
    ACCOUNT_GROUPS.BANK_OD,
];

/** True when the group name is a cash / bank / OD group. */
export const isMoneyGroupName = (name?: string | null): boolean =>
    !!name && MONEY_ACCOUNT_GROUPS.includes(name);

/**
 * Bank-like = an account reached by cheque / transfer rather than over the
 * counter (Bank Accounts or Bank OD A/c). Drives the deposit-slip fields.
 */
export const isBankLikeGroupName = (name?: string | null): boolean =>
    name === ACCOUNT_GROUPS.BANK_ACCOUNTS || name === ACCOUNT_GROUPS.BANK_OD;

/** Placeholder text shared by the money-account pickers. */
export const MONEY_ACCOUNT_PLACEHOLDER = "Cash-in-Hand / Bank / OD Account…";
