"use client";
import { VoucherForm } from "@/modules/accountancy/components/VoucherForm";

export default function NewCreditNotePage() {
    return <VoucherForm type="CREDIT_NOTE" redirectTo="/office/accountancy/credit-notes" />;
}
