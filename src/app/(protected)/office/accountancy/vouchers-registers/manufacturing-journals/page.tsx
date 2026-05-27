"use client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { InvVoucherList } from "@/modules/inventory/components/InvVoucherList";

export default function Page() {
    return (
        <ScrollArea className="h-full" type="always">
            <div className="px-6 pt-3 pb-6">
                <InvVoucherList
                    type="MANUFACTURING_JOURNAL"
                    title="Manufacturing Journals"
                    subtitle="Consume raw materials to produce finished goods. Optional BOM-driven; optional Charges post to GL."
                    basePath="/office/accountancy/vouchers-registers/manufacturing-journals"
                    newPath="/vouchers/manufacturing-journals/new"
                />
            </div>
        </ScrollArea>
    );
}
