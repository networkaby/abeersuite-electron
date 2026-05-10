/**
 * Standard `AccountGroup.name` strings — single source of truth for the literals
 * that get matched in journal posting, party-ledger creation, and receivables /
 * payables reports.
 *
 * Seeded by `prisma/seeds/bootstrap-seed.ts` as part of the chart of accounts.
 */
export const ACCOUNT_GROUPS = {
    SUNDRY_DEBTORS:   "Sundry Debtors",
    SUNDRY_CREDITORS: "Sundry Creditors",
    CASH_IN_HAND:     "Cash-in-Hand",
    BANK_ACCOUNTS:    "Bank Accounts",
} as const;

export type AccountGroupName = (typeof ACCOUNT_GROUPS)[keyof typeof ACCOUNT_GROUPS];
