"use client";
import { VoucherForm } from "@/modules/accountancy/components/VoucherForm";

export default function NewPaymentPage() {
    return <VoucherForm type="PAYMENT" redirectTo="/office/accountancy/payments" />;
}
