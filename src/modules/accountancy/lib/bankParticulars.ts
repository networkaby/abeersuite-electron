// Bank-ledger particulars (ledgers under a Bank group) — printed on the
// Contra deposit slip. Shared between the Masters → Ledgers inline editor
// and the Edit-ledger dialog opened from the Bank/Cash/Loans Book explorer.

import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";

export type BankFields = {
    bankName: string;
    branch: string;
    accountNumber: string;
    ifsc: string;
    beneficiary: string;
    // Sanctioned overdraft ceiling — Bank OD A/c ledgers only (see isOdGroupName).
    // Optional and purely informational; drives the "Available" hint in
    // facilityLimit.ts. Left "" when the facility limit isn't tracked (e.g. the
    // account is only ever funded from our own deposits, never drawn against).
    limit: string;
};

export const EMPTY_BANK: BankFields = {
    bankName: "", branch: "", accountNumber: "", ifsc: "", beneficiary: "", limit: "",
};

export const hasBankData = (b: BankFields): boolean =>
    !!(b.bankName || b.branch || b.accountNumber || b.ifsc || b.beneficiary || b.limit);

export function parseBank(v: unknown): BankFields {
    if (v == null || typeof v !== "object" || Array.isArray(v)) return { ...EMPTY_BANK };
    const o = v as Record<string, unknown>;
    const s = (x: unknown): string => (typeof x === "string" ? x : "");
    return {
        bankName: s(o.bankName),
        branch: s(o.branch),
        accountNumber: s(o.accountNumber),
        ifsc: s(o.ifsc),
        beneficiary: s(o.beneficiary),
        limit: s(o.limit),
    };
}

export const BANK_FIELD_LABELS: { key: keyof Omit<BankFields, "limit">; label: string; placeholder: string }[] = [
    { key: "bankName", label: "Bank Name", placeholder: "State Bank of India" },
    { key: "branch", label: "Branch", placeholder: "Fancy Bazar Branch" },
    { key: "accountNumber", label: "A/C No", placeholder: "38124567890" },
    { key: "ifsc", label: "IFSC", placeholder: "SBIN0000123" },
    { key: "beneficiary", label: "A/C Holder’s Name", placeholder: "Firm name as per bank" },
];

// Bank particulars are shown only for ledgers under a Bank group (seeded
// "Bank Accounts" / "Bank OD A/c").
export const isBankGroupName = (name?: string | null): boolean =>
    (name ?? "").toLowerCase().includes("bank");

// The OD limit field is narrower than the bank-particulars block above — only
// "Bank OD A/c" ledgers get it, not plain "Bank Accounts".
export const isOdGroupName = (name?: string | null): boolean => name === ACCOUNT_GROUPS.BANK_OD;
