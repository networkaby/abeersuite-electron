"use client";
import { InvVoucherList } from "@/modules/inventory/components/InvVoucherForm";

export default function Page() {
    return (
        <InvVoucherList
            type="STOCK_JOURNAL"
            title="Stock Journals"
            subtitle="Inter-godown transfers and production output — read-only register"
            basePath=""
        />
    );
}
