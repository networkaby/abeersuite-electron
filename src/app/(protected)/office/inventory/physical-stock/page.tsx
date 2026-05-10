"use client";
import { InvVoucherList } from "@/modules/inventory/components/InvVoucherForm";

export default function PhysicalStockPage() {
    return (
        <InvVoucherList
            type="PHYSICAL_STOCK"
            title="Physical Stock"
            subtitle="Physical-count adjustments — quantity entered is the new on-hand value; the delta is ledgered automatically"
            basePath="/office/inventory/physical-stock"
            newPath="/office/inventory/physical-stock/new"
        />
    );
}
