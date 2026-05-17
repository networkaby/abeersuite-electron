"use client";
import { InvVoucherList } from "@/modules/inventory/components/InvVoucherForm";

export default function ManufacturingJournalsPage() {
    return (
        <InvVoucherList
            type="MANUFACTURING_JOURNAL"
            title="Manufacturing Journals"
            subtitle="Consume raw materials to produce finished goods. Optional BOM-driven; optional Charges (labour, electricity) post to GL."
            basePath="/vouchers/manufacturing-journals"
            newPath="/vouchers/manufacturing-journals/new"
        />
    );
}
