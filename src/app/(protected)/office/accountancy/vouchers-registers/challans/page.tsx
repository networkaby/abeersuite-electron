"use client";
import { InvVoucherList } from "@/modules/inventory/components/InvVoucherForm";

export default function Page() {
    return (
        <InvVoucherList
            type="CHALLAN"
            title="Challans"
            subtitle="Delivery challans — outgoing stock with optional price visibility on the printed copy"
            basePath="/vouchers/challans"
            newPath="/vouchers/challans/new"
        />
    );
}
