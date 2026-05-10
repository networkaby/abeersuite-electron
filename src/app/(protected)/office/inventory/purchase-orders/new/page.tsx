"use client";
import { InvVoucherForm } from "@/modules/inventory/components/InvVoucherForm";

export default function NewPurchaseOrderPage() {
    return <InvVoucherForm type="PURCHASE_ORDER" redirectTo="/office/inventory/purchase-orders" />;
}
