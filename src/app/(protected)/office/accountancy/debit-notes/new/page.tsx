"use client";
import { VoucherForm } from "@/modules/accountancy/components/VoucherForm";

export default function NewDebitNotePage() {
    return <VoucherForm type="DEBIT_NOTE" redirectTo="/office/accountancy/debit-notes" />;
}
