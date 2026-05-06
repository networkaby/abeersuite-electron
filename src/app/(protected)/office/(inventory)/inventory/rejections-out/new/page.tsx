"use client";
import { InvVoucherForm } from "@/modules/inventory/components/InvVoucherForm";

export default function NewRejectionOutPage() {
    return <InvVoucherForm type="REJECTION_OUT" redirectTo="/office/inventory/rejections-out" />;
}
