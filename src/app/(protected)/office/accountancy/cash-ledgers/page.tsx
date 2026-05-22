"use client";

import { Wallet } from "lucide-react";
import { AccountLedgerExplorer } from "@/modules/accountancy/components/AccountLedgerExplorer";

export default function CashLedgersPage() {
    return (
        <AccountLedgerExplorer
            title="Cash Book"
            panelTitle="Cash Accounts"
            panelIcon={<Wallet size={15} className="text-primary" />}
            groupNames={["Cash-in-Hand"]}
            emptyMessage="No cash accounts. Bootstrap seeds 'Cash' + 'Petty Cash' under Cash-in-Hand."
        />
    );
}
