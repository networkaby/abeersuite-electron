"use client";

import { Banknote } from "lucide-react";
import { AccountLedgerExplorer } from "@/modules/accountancy/components/AccountLedgerExplorer";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";

const BANK_BOOK_GROUPS = [
    ACCOUNT_GROUPS.BANK_ACCOUNTS,
    ACCOUNT_GROUPS.BANK_OD,
];

export default function BankLedgersPage() {
    return (
        <AccountLedgerExplorer
            title="Bank Book"
            panelTitle="Bank & OD"
            panelIcon={<Banknote size={15} className="text-primary" />}
            groupNames={BANK_BOOK_GROUPS}
            emptyMessage="No bank accounts. Add ledgers under Bank Accounts or Bank OD A/c."
            book={{
                groupName: BANK_BOOK_GROUPS,
                subtitle: "All bank and overdraft ledgers with period totals — pick one to see its register.",
            }}
        />
    );
}
