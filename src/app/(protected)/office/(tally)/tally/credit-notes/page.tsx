"use client";
import { VoucherList } from "@/modules/tally/components/VoucherList";

export default function CreditNotesPage() {
    return (
        <VoucherList
            type="CREDIT_NOTE"
            title="Credit Notes"
            subtitle="Sales returns and customer credits"
            basePath="/office/finance/credit-notes"
            newPath="/office/finance/credit-notes/new"
        />
    );
}
