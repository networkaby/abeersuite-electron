"use client";
import { InvVoucherList } from "@/modules/inventory/components/InvVoucherForm";

export default function GrnPage() {
    return (
        <InvVoucherList
            type="GRN"
            title="Goods Received Notes"
            subtitle="Received against a Purchase Order — increments stock; GL posted via the linked Purchase invoice"
            basePath="/office/inventory/grn"
            newPath="/office/inventory/grn/new"
        />
    );
}
