"use client";
import { VoucherList } from "@/modules/tally/components/VoucherList";

export default function ReceiptsPage() {
    return (
        <VoucherList
            type="RECEIPT"
            title="Receipts"
            subtitle="Money received — from customers, parties, or other sources"
            basePath="/office/finance/receipts"
            newPath="/office/finance/receipts/new"
        />
    );
}
