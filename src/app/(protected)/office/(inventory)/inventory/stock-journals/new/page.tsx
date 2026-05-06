"use client";
import { InvVoucherForm } from "@/modules/inventory/components/InvVoucherForm";

export default function NewStockJournalPage() {
    return <InvVoucherForm type="STOCK_JOURNAL" redirectTo="/office/inventory/stock-journals" />;
}
