// Loan-ledger particulars (ledgers under "Loans (Liability)" / "Secured Loans" /
// "Unsecured Loans") — informational details about the borrowing itself.
// Mirrors bankParticulars.ts's shape/pattern.

import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";

export type LoanFields = {
    lender: string;
    loanAccountNumber: string;
    principalAmount: string;
    interestRate: string;
    tenureMonths: string;
    emiAmount: string;
};

export const EMPTY_LOAN: LoanFields = {
    lender: "", loanAccountNumber: "", principalAmount: "", interestRate: "", tenureMonths: "", emiAmount: "",
};

export const hasLoanData = (l: LoanFields): boolean =>
    !!(l.lender || l.loanAccountNumber || l.principalAmount || l.interestRate || l.tenureMonths || l.emiAmount);

export function parseLoan(v: unknown): LoanFields {
    if (v == null || typeof v !== "object" || Array.isArray(v)) return { ...EMPTY_LOAN };
    const o = v as Record<string, unknown>;
    const s = (x: unknown): string => (typeof x === "string" ? x : "");
    return {
        lender: s(o.lender),
        loanAccountNumber: s(o.loanAccountNumber),
        principalAmount: s(o.principalAmount),
        interestRate: s(o.interestRate),
        tenureMonths: s(o.tenureMonths),
        emiAmount: s(o.emiAmount),
    };
}

export const LOAN_FIELD_LABELS: { key: keyof LoanFields; label: string; placeholder: string }[] = [
    { key: "lender", label: "Lender", placeholder: "Bandhan Bank" },
    { key: "loanAccountNumber", label: "Loan A/C No", placeholder: "0193456789" },
    { key: "principalAmount", label: "Sanctioned Amount (₹)", placeholder: "500000" },
    { key: "interestRate", label: "Interest Rate (% p.a.)", placeholder: "10.5" },
    { key: "tenureMonths", label: "Tenure (months)", placeholder: "36" },
    { key: "emiAmount", label: "EMI Amount (₹)", placeholder: "16250" },
];

const LOAN_GROUPS: readonly string[] = [
    ACCOUNT_GROUPS.LOANS_LIABILITY, ACCOUNT_GROUPS.SECURED_LOANS, ACCOUNT_GROUPS.UNSECURED_LOANS,
];
export const isLoanGroupName = (name?: string | null): boolean => !!name && LOAN_GROUPS.includes(name);
