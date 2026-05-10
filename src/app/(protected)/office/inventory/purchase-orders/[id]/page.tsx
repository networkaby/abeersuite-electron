"use client";
import { InvVoucherDetail } from "@/modules/inventory/components/InvVoucherDetail";

export default function PurchaseOrderDetailPage() {
    return <InvVoucherDetail basePath="/office/inventory/purchase-orders" label="Purchase Order" />;
}
