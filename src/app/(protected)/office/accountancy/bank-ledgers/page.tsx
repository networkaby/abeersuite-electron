"use client";

import { Banknote } from "lucide-react";
import { AccountLedgerExplorer } from "@/modules/accountancy/components/AccountLedgerExplorer";

export default function BankLedgersPage() {
    return (
        <AccountLedgerExplorer
            title="Bank Book"
            panelTitle="Bank Accounts"
            panelIcon={<Banknote size={15} className="text-primary" />}
            groupNames={["Bank Accounts"]}
            emptyMessage="No bank accounts. Add ledgers under the Bank Accounts group."
        />
    );
}
