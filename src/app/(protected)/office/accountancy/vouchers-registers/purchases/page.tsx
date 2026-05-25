"use client";
import {
    InvVoucherList,
    type InvVoucherListRow,
} from "@/modules/inventory/components/InvVoucherList";

export default function Page() {
    return (
        <InvVoucherList
            type="PURCHASE"
            title="Purchases"
            subtitle="Purchase vouchers — stock & GL ledger"
            newPath="/vouchers/purchases/new"
            emptyLabel="purchase vouchers"
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
