"use client";
import { InvVoucherList } from "@/modules/inventory/components/InvVoucherForm";

export default function Page() {
    return (
        <InvVoucherList
            type="ADJUSTMENT"
            title="Adjustments"
            subtitle="Quantity / value corrections to stock — read-only register"
            basePath=""
        />
    );
}
