"use client";
import { InvVoucherList } from "@/modules/inventory/components/InvVoucherForm";

export default function Page() {
    return (
        <InvVoucherList
            type="PHYSICAL_STOCK"
            title="Physical Stock"
            subtitle="Stock-take counts overriding system on-hand quantities — read-only register"
            basePath=""
        />
    );
}
