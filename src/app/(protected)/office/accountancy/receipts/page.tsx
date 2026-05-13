"use client";
import { VoucherList } from "@/modules/accountancy/components/VoucherList";

export default function ReceiptsPage() {
    return (
        <VoucherList
            type="RECEIPT"
            title="Receipts"
            subtitle="Money received — from customers, parties, or other sources"
            basePath="/office/accountancy/receipts"
            newPath="/vouchers/receipts/new"
        />
    );
}
