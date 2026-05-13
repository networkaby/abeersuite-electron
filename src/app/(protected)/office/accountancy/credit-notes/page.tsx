"use client";
import { VoucherList } from "@/modules/accountancy/components/VoucherList";

export default function CreditNotesPage() {
    return (
        <VoucherList
            type="CREDIT_NOTE"
            title="Credit Notes"
            subtitle="Sales returns and customer credits"
            basePath="/office/accountancy/credit-notes"
            newPath="/vouchers/credit-notes/new"
        />
    );
}
