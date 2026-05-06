"use client";
import { VoucherForm } from "@/modules/tally/components/VoucherForm";

export default function NewPaymentPage() {
    return <VoucherForm type="PAYMENT" redirectTo="/office/tally/payments" />;
}
