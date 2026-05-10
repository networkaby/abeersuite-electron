"use client";
import { InvVoucherForm } from "@/modules/inventory/components/InvVoucherForm";

export default function NewSalesOrderPage() {
    return <InvVoucherForm type="SALES_ORDER" redirectTo="/office/inventory/sales-orders" />;
}
