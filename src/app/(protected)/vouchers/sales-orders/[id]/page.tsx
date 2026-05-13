"use client";
import { InvVoucherDetail } from "@/modules/inventory/components/InvVoucherDetail";

export default function SalesOrderDetailPage() {
    return <InvVoucherDetail basePath="/vouchers/sales-orders" label="Sales Order" />;
}
