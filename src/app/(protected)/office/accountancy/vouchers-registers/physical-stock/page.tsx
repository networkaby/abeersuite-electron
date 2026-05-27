"use client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { InvVoucherList } from "@/modules/inventory/components/InvVoucherList";

export default function Page() {
    return (
        <ScrollArea className="h-full" type="always">
            <div className="px-6 pt-3 pb-6">
                <InvVoucherList
                    type="PHYSICAL_STOCK"
                    title="Physical Stock"
                    subtitle="Counted opening qty per date — multiple vouchers on the same date combine (sum). No GL post."
                    basePath="/office/accountancy/vouchers-registers/physical-stock"
                    newPath="/vouchers/physical-stock/new"
                />
            </div>
        </ScrollArea>
    );
}
