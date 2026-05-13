"use client";
import { InvVoucherDetail } from "@/modules/inventory/components/InvVoucherDetail";

export default function PurchaseOrderDetailPage() {
    return <InvVoucherDetail basePath="/vouchers/purchase-orders" label="Purchase Order" />;
}
