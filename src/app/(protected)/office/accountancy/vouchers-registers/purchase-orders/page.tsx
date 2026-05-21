"use client";
import { InvVoucherList } from "@/modules/inventory/components/InvVoucherList";

export default function Page() {
    return (
        <InvVoucherList
            type="PURCHASE_ORDER"
            title="Purchase Orders"
            subtitle="Supplier commitments — no stock or GL impact until GRN / Purchase posted"
            basePath="/vouchers/purchase-orders"
            newPath="/vouchers/purchase-orders/new"
        />
    );
}
