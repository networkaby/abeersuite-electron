"use client";
import { VoucherForm } from "@/modules/tally/components/VoucherForm";

export default function NewDebitNotePage() {
    return <VoucherForm type="DEBIT_NOTE" redirectTo="/office/finance/debit-notes" />;
}
