"use client";
import { VoucherForm } from "@/modules/tally/components/VoucherForm";

export default function NewCreditNotePage() {
    return <VoucherForm type="CREDIT_NOTE" redirectTo="/office/finance/credit-notes" />;
}
