"use client";
import { InvVoucherList } from "@/modules/inventory/components/InvVoucherForm";

export default function Page() {
    return (
        <InvVoucherList
            type="SALES_ORDER"
            title="Sales Orders"
            subtitle="Customer commitments — no stock or GL impact until converted to a Sale invoice"
            basePath="/vouchers/sales-orders"
            newPath="/vouchers/sales-orders/new"
        />
    );
}
