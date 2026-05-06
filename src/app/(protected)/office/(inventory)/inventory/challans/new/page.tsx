"use client";
import { InvVoucherForm } from "@/modules/inventory/components/InvVoucherForm";

export default function NewChallanPage() {
    return <InvVoucherForm type="CHALLAN" redirectTo="/office/inventory/challans" />;
}
