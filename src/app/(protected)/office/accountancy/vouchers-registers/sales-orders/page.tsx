"use client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { InvVoucherList } from "@/modules/inventory/components/InvVoucherList";

export default function Page() {
    return (
        <ScrollArea className="h-full" type="always">
            <div className="px-6 pt-3 pb-6">
                <InvVoucherList
                    type="SALES_ORDER"
                    title="Sales Orders"
                    subtitle="Customer commitments — no stock or GL impact until converted to a Sale invoice"
                    basePath="/vouchers/sales-orders"
                    newPath="/vouchers/sales-orders/new"
                />
            </div>
        </ScrollArea>
    );
}
