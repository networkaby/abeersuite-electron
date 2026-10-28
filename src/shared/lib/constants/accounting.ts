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
    BNPL:              "BNPL A/c",
    WALLETS:           "Wallets",
    // Already live as a real-config group before
    // this constant existed — Usable Fund wires it in via this name.
    PAYMENT_GATEWAY:   "Payment Gateway",
    // The only two groups whose ledgers carry inventory items in a voucher.
    // Sales Accounts → Sales A/c, Parts Revenue, Shop Sales Revenue, Sales Returns.
    // Purchase Accounts → Purchase A/c, Purchase Returns.
    // See isStockEligibleAccount() for the rule and exceptions.
    SALES_ACCOUNTS:    "Sales Accounts",
    PURCHASE_ACCOUNTS: "Purchase Accounts",
    // Expense groups a payment can go straight to (rent, electricity, tea…) —
    // the phone's quick Pay lists every ledger under these two, sub-groups included.
    DIRECT_EXPENSES:   "Direct Expenses",
    INDIRECT_EXPENSES: "Indirect Expenses",
    // HR & People — every staff member's own ledger lives here (LIABILITY under
    // Current Liabilities). Salary accrues INTO it, advances and payments go
    // OUT of it, so its balance reads "owed to them" or "advance outstanding".
    SALARY_PAYABLE:    "Salary Payable",
} as const;

export type AccountGroupName = (typeof ACCOUNT_GROUPS)[keyof typeof ACCOUNT_GROUPS];

/**
 * Standard `Account.name` strings — Tally-standard ledger names, so they are fixed
 * and safe to match exactly. Seeded by `prisma/seeds/bootstrap-seed.ts` alongside
 * the chart of accounts (see `upsertLedger("Petty Cash", "Cash-in-Hand", …)`).
 *
 * Match these by equality, never by substring/regex: a fuzzy `/petty/i` scan can
 * also hit an operator-created till that merely mentions the word.
 */
export const ACCOUNT_LEDGERS = {
    PETTY_CASH:   "Petty Cash",
    WALK_IN:      "Walk-in Cash Customer",
    // The default Dr side of a payroll journal when a staff profile names no
    // expense ledger of its own (StaffProfile.expenseAccountId).
    SALARY_WAGES: "Salary & Wages",
} as const;

/**
 * Payment instrument — HOW money moved on a Payment / Receipt voucher (the
 * `method` + `reference` columns on the Cash/Bank GL line). Mirrors the
 * Prisma `PaymentMethod` enum; the labels are what the form and the printed
 * receipt show. Optional on the form — a plain cash receipt leaves it blank.
 */
export const PAYMENT_INSTRUMENTS = [
    { value: "CASH",           label: "Cash" },
    { value: "MOBILE_PAYMENT", label: "UPI" },
    { value: "CARD",           label: "Card" },
    { value: "CHEQUE",         label: "Cheque" },
    { value: "BANK_TRANSFER",  label: "Bank transfer" },
    { value: "OTHER",          label: "Other" },
] as const;

export type PaymentInstrument = (typeof PAYMENT_INSTRUMENTS)[number]["value"];

export const PAYMENT_INSTRUMENT_VALUES = PAYMENT_INSTRUMENTS.map((i) => i.value) as [PaymentInstrument, ...PaymentInstrument[]];

/** Days a bill is given before it falls due when the bill carries no credit period
 *  of its own (VoucherDetail.creditPeriodDays — the voucher form pre-fills that from
 *  Org Defaults' sale / purchase credit period). Sets each bill's due date, and so
 *  the Auto-Link order. The ageing buckets count from the bill date and do not read it. */
export const DEFAULT_DUE_DAYS = 30;

/** "UPI (4532…)" / "Cheque (483920)" / "Cash" — for print and lists; "" when nothing captured. */
export function paymentInstrumentText(method?: string | null, reference?: string | null): string {
    const label = PAYMENT_INSTRUMENTS.find((i) => i.value === method)?.label ?? "";
    const ref = (reference ?? "").trim();
    if (label && ref) return `${label} (${ref})`;
    return label || ref;
}
