"use client";
import { InvVoucherList } from "@/modules/inventory/components/InvVoucherList";

export default function Page() {
    return (
        <InvVoucherList
            type="MANUFACTURING_JOURNAL"
            title="Manufacturing Journals"
            subtitle="Consume raw materials to produce finished goods. Optional BOM-driven; optional Charges post to GL."
            basePath="/office/accountancy/vouchers-registers/manufacturing-journals"
            newPath="/vouchers/manufacturing-journals/new"
        />
    );
}
