"use client";
import { VoucherForm } from "@/modules/tally/components/VoucherForm";

export default function NewReceiptPage() {
    return <VoucherForm type="RECEIPT" redirectTo="/office/tally/receipts" />;
}
