"use client";

import { BookPage } from "@/modules/tally/components/BookPage";

export default function CashBookPage() {
    return (
        <BookPage
            title="Cash Book"
            subtitle="All transactions affecting cash ledgers — click a ledger to drill into the running register."
            groupName="Cash-in-Hand"
        />
    );
}
