"use client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { InvVoucherList } from "@/modules/inventory/components/InvVoucherList";

export default function Page() {
    return (
        <ScrollArea className="h-full" type="always">
            <div className="px-6 pt-3 pb-6">
                <InvVoucherList
                    type="CHALLAN"
                    title="Challans"
                    subtitle="Delivery challans — outgoing stock with optional price visibility on the printed copy"
                    basePath="/vouchers/challans"
                    newPath="/vouchers/challans/new"
                />
            </div>
        </ScrollArea>
    );
}
