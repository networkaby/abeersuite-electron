"use client";
import { InvVoucherList } from "@/modules/inventory/components/InvVoucherList";

export default function Page() {
    return (
        <InvVoucherList
            type="REJECTION_OUT"
            title="Rejections Out"
            subtitle="Stock returned to supplier — converts to Purchase Return on settlement"
            basePath="/vouchers/rejections-out"
            newPath="/vouchers/rejections-out/new"
        />
    );
}
