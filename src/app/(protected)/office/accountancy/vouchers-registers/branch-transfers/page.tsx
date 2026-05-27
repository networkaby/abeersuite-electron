"use client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { InvVoucherList } from "@/modules/inventory/components/InvVoucherList";

export default function Page() {
    return (
        <ScrollArea className="h-full" type="always">
            <div className="px-6 pt-3 pb-6">
                <InvVoucherList
                    type="BRANCH_TRANSFER"
                    title="Branch Transfers"
                    subtitle="Stock movement between locations — out at source, in at destination. No GL impact."
                    basePath="/office/accountancy/vouchers-registers/branch-transfers"
                    newPath="/vouchers/branch-transfers/new"
                />
            </div>
        </ScrollArea>
    );
}
