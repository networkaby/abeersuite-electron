"use client";

import { Banknote } from "lucide-react";
import { AccountLedgerExplorer } from "@/modules/accountancy/components/AccountLedgerExplorer";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";

// Credit Card and BNPL A/c are seeded as children of Loans (Liability), so the
// book lists each as its own table — BookPage prunes a group from its parent's
// section when that group has a section of its own.
const BOOK_GROUPS = [
    ACCOUNT_GROUPS.LOANS_LIABILITY,
    ACCOUNT_GROUPS.CREDIT_CARD,
    ACCOUNT_GROUPS.BNPL,
];

export default function LoanLedgersPage() {
    return (
        <AccountLedgerExplorer
            title="Loans Book"
            panelTitle="Loan Accounts"
            panelIcon={<Banknote size={15} className="text-primary" />}
            // Panel list walks descendants of these dynamically (AccountLedgerExplorer
            // fetches the live group tree) — a new sub-group under any of these
            // shows up automatically, no need to list Secured/Unsecured/Bank OD here.
            groupNames={BOOK_GROUPS}
            emptyMessage="No loan accounts. Add ledgers under Loans (Liability) / Secured Loans / Unsecured Loans / Bank OD A/c / Credit Card / BNPL A/c."
            chargeInterest
            book={{
                groupName: BOOK_GROUPS,
                subtitle: "All loan, credit-card and BNPL ledgers with period totals — pick one to see its register.",
            }}
        />
    );
}
