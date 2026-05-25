"use client";
import {
    InvVoucherList,
    type InvVoucherListRow,
} from "@/modules/inventory/components/InvVoucherList";

export default function Page() {
    return (
        <InvVoucherList
            type="SALE_RETURN"
            title="Sale Returns"
            subtitle="Customer returns — stock in, GL reversed"
            newPath="/vouchers/sale-returns/new"
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
