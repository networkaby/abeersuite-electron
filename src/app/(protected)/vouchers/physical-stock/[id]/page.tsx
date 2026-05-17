"use client";
import { InvVoucherDetail } from "@/modules/inventory/components/InvVoucherDetail";

export default function PhysicalStockDetailPage() {
    return (
        <InvVoucherDetail
            basePath="/office/accountancy/vouchers-registers/physical-stock"
            formPath="/vouchers/physical-stock/new"
            label="Physical Stock"
        />
    );
}
