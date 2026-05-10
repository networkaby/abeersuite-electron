"use client";
import { InvVoucherList } from "@/modules/inventory/components/InvVoucherForm";

export default function SalesOrdersPage() {
    return (
        <InvVoucherList
            type="SALES_ORDER"
            title="Sales Orders"
            subtitle="Customer commitments — no stock or GL impact until converted to a Sale invoice"
            basePath="/office/inventory/sales-orders"
            newPath="/office/inventory/sales-orders/new"
        />
    );
}
