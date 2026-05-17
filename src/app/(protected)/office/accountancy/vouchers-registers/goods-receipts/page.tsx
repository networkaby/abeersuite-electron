"use client";
import { InvVoucherList } from "@/modules/inventory/components/InvVoucherForm";

// Inventory RECEIPT (goods received without a Purchase). Named "goods-receipts"
// to avoid colliding with the GL Receipt voucher register at /receipts.
export default function Page() {
    return (
        <InvVoucherList
            type="RECEIPT"
            title="Goods Receipts"
            subtitle="Stock received outside a Purchase flow — read-only register"
            basePath=""
        />
    );
}
