"use client";
import { VoucherList } from "@/modules/tally/components/VoucherList";

export default function DebitNotesPage() {
    return (
        <VoucherList
            type="DEBIT_NOTE"
            title="Debit Notes"
            subtitle="Purchase returns and supplier debits"
            basePath="/office/finance/debit-notes"
            newPath="/office/finance/debit-notes/new"
        />
    );
}
