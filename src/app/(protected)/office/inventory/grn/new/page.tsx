"use client";
import { InvVoucherForm } from "@/modules/inventory/components/InvVoucherForm";

export default function NewGrnPage() {
    return <InvVoucherForm type="GRN" redirectTo="/office/inventory/grn" />;
}
