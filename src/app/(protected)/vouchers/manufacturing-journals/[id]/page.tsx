"use client";
import { InvVoucherDetail } from "@/modules/inventory/components/InvVoucherDetail";

export default function ManufacturingJournalDetailPage() {
    return (
        <InvVoucherDetail
            basePath="/office/accountancy/vouchers-registers/manufacturing-journals"
            formPath="/vouchers/manufacturing-journals/new"
            label="Manufacturing Journal"
        />
    );
}
