"use client";
import { InvVoucherList } from "@/modules/inventory/components/InvVoucherForm";

export default function Page() {
    return (
        <InvVoucherList
            type="REJECTION_IN"
            title="Rejections In"
            subtitle="Customer-returned goods awaiting inspection — converts to Sale Return on acceptance"
            basePath="/vouchers/rejections-in"
            newPath="/vouchers/rejections-in/new"
        />
    );
}
