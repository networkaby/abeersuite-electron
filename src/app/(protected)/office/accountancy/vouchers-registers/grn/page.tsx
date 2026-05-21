"use client";
import { InvVoucherList } from "@/modules/inventory/components/InvVoucherList";

export default function Page() {
    return (
        <InvVoucherList
            type="GRN"
            title="Goods Received Notes"
            subtitle="Received against a Purchase Order — increments stock; GL posted via the linked Purchase invoice"
            basePath="/vouchers/grn"
            newPath="/vouchers/grn/new"
        />
    );
}
