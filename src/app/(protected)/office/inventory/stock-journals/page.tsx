"use client";
import { InvVoucherList } from "@/modules/inventory/components/InvVoucherForm";

export default function StockJournalsPage() {
    return (
        <InvVoucherList
            type="STOCK_JOURNAL"
            title="Stock Journals"
            subtitle="Inter-godown transfers and manufacturing — stock movement only, no GL"
            basePath="/office/inventory/stock-journals"
            newPath="/office/inventory/stock-journals/new"
        />
    );
}
