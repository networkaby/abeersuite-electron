"use client";
import { InvVoucherList } from "@/modules/inventory/components/InvVoucherForm";

export default function ChallansPage() {
    return (
        <InvVoucherList
            type="CHALLAN"
            title="Challans"
            subtitle="Delivery challans — outgoing stock with optional price visibility on the printed copy"
            basePath="/office/inventory/challans"
            newPath="/office/inventory/challans/new"
        />
    );
}
