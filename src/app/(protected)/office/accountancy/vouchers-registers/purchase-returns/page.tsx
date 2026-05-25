"use client";
import {
    InvVoucherList,
    type InvVoucherListRow,
} from "@/modules/inventory/components/InvVoucherList";

export default function Page() {
    return (
        <InvVoucherList
            type="PURCHASE_RETURN"
            title="Purchase Returns"
            subtitle="Returns to supplier — stock out, GL reversed"
            newPath="/vouchers/purchase-returns/new"
            extraColumns={[
                {
                    header:    "Items",
                    className: "px-4 py-3 text-center text-xs font-medium",
                    cell:      (r) => <span className="text-muted-foreground">{(r as InvVoucherListRow).lineCount}</span>,
                },
            ]}
        />
    );
}
