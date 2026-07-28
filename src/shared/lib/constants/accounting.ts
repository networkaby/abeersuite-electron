/**
 * Standard `AccountGroup.name` strings — single source of truth for the literals
 * that get matched in journal posting, party-ledger creation, and receivables /
 * payables reports.
 *
 * Seeded by `prisma/seeds/bootstrap-seed.ts` as part of the chart of accounts.
 */
export const ACCOUNT_GROUPS = {
    SUNDRY_DEBTORS:    "Sundry Debtors",
    SUNDRY_CREDITORS:  "Sundry Creditors",
    CASH_IN_HAND:      "Cash-in-Hand",
    BANK_ACCOUNTS:     "Bank Accounts",
    BANK_OD:           "Bank OD A/c",
    CREDIT_CARD:       "Credit Card",
    LOANS_LIABILITY:   "Loans (Liability)",
    SECURED_LOANS:     "Secured Loans",
    UNSECURED_LOANS:   "Unsecured Loans",
    // The only two groups whose ledgers carry inventory items in a voucher.
    // Sales Accounts → Sales A/c, Parts Revenue, Shop Sales Revenue, Sales Returns.
    // Purchase Accounts → Purchase A/c, Purchase Returns.
    // See isStockEligibleAccount() for the rule and exceptions.
    SALES_ACCOUNTS:    "Sales Accounts",
    PURCHASE_ACCOUNTS: "Purchase Accounts",
} as const;

export type AccountGroupName = (typeof ACCOUNT_GROUPS)[keyof typeof ACCOUNT_GROUPS];
