"use client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { InvVoucherList } from "@/modules/inventory/components/InvVoucherList";

export default function Page() {
    return (
        <ScrollArea className="h-full" type="always">
            <div className="px-6 pt-3 pb-6">
                <InvVoucherList
                    type="PURCHASE_ORDER"
                    title="Purchase Orders"
                    subtitle="Supplier commitments — no stock or GL impact until GRN / Purchase posted"
                    basePath="/vouchers/purchase-orders"
                    newPath="/vouchers/purchase-orders/new"
                />
            </div>
        </ScrollArea>
    );
}
