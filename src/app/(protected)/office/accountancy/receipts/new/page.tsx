"use client";
import { VoucherForm } from "@/modules/accountancy/components/VoucherForm";

export default function NewReceiptPage() {
    return <VoucherForm type="RECEIPT" redirectTo="/office/accountancy/receipts" />;
}
