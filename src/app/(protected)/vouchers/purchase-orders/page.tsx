"use client";
import { InvVoucherList } from "@/modules/inventory/components/InvVoucherForm";

export default function PurchaseOrdersPage() {
    return (
        <InvVoucherList
            type="PURCHASE_ORDER"
            title="Purchase Orders"
            subtitle="Supplier commitments — no stock or GL impact until goods are received"
            basePath="/vouchers/purchase-orders"
            newPath="/vouchers/purchase-orders/new"
        />
    );
}
