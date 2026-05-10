"use client";
import { InvVoucherForm } from "@/modules/inventory/components/InvVoucherForm";

export default function NewPhysicalStockPage() {
    return <InvVoucherForm type="PHYSICAL_STOCK" redirectTo="/office/inventory/physical-stock" />;
}
