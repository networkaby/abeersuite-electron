"use client";
import { InvVoucherForm } from "@/modules/inventory/components/InvVoucherForm";

export default function NewRejectionInPage() {
    return <InvVoucherForm type="REJECTION_IN" redirectTo="/office/inventory/rejections-in" />;
}
