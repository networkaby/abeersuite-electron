"use client";
import { VoucherList } from "@/modules/accountancy/components/VoucherList";

export default function DebitNotesPage() {
    return (
        <VoucherList
            type="DEBIT_NOTE"
            title="Debit Notes"
            subtitle="Purchase returns and supplier debits"
            basePath="/office/accountancy/debit-notes"
            newPath="/vouchers/debit-notes/new"
        />
    );
}
