"use client";

import { BookPage } from "@/modules/accountancy/components/BookPage";

export default function BankBookPage() {
    // Don't auto-redirect even if there's only one bank ledger — bank books
    // typically grow over time so the list view is the more useful default.
    return (
        <BookPage
            title="Bank Book"
            subtitle="All bank ledgers with period totals — click any ledger to see its register."
            groupName="Bank Accounts"
            autoSingle={false}
        />
    );
}
