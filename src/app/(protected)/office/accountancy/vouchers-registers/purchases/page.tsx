"use client";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    InvVoucherList,
    type InvVoucherListRow,
} from "@/modules/inventory/components/InvVoucherList";

export default function Page() {
    return (
        <ScrollArea className="h-full" type="always">
            <div className="px-6 pt-3 pb-6">
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
            </div>
        </ScrollArea>
    );
}
