"use client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { InvVoucherList } from "@/modules/inventory/components/InvVoucherList";

export default function Page() {
    return (
        <ScrollArea className="h-full" type="always">
            <div className="px-6 pt-3 pb-6">
                <InvVoucherList
                    type="GRN"
                    title="Goods Received Notes"
                    subtitle="Received against a Purchase Order — increments stock; GL posted via the linked Purchase invoice"
                    basePath="/vouchers/grn"
                    newPath="/vouchers/grn/new"
                />
            </div>
        </ScrollArea>
    );
}
