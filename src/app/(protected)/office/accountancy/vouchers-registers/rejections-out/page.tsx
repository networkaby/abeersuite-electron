"use client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { InvVoucherList } from "@/modules/inventory/components/InvVoucherList";

export default function Page() {
    return (
        <ScrollArea className="h-full" type="always">
            <div className="px-6 pt-3 pb-6">
                <InvVoucherList
                    type="REJECTION_OUT"
                    title="Rejections Out"
                    subtitle="Stock returned to supplier — converts to Purchase Return on settlement"
                    basePath="/vouchers/rejections-out"
                    newPath="/vouchers/rejections-out/new"
                />
            </div>
        </ScrollArea>
    );
}
