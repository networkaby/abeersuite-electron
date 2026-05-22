"use client";

import { Banknote } from "lucide-react";
import { AccountLedgerExplorer } from "@/modules/accountancy/components/AccountLedgerExplorer";

export default function LoanLedgersPage() {
    return (
        <AccountLedgerExplorer
            title="Loans Book"
            panelTitle="Loan Accounts"
            panelIcon={<Banknote size={15} className="text-primary" />}
            // Three groups under Loans (Liability): the parent itself plus secured / unsecured.
            groupNames={["Loans (Liability)", "Secured Loans", "Unsecured Loans"]}
            emptyMessage="No loan accounts. Add ledgers under Loans (Liability) / Secured Loans / Unsecured Loans."
            // BookPage flattens descendants — passing the parent surfaces
            // Secured + Unsecured loans in the same summary table.
            book={{ groupName: "Loans (Liability)", subtitle: "All loan ledgers with period totals — pick one to see its register." }}
        />
    );
}
