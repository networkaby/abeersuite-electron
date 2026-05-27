"use client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { InvVoucherList } from "@/modules/inventory/components/InvVoucherList";

export default function Page() {
    return (
        <ScrollArea className="h-full" type="always">
            <div className="px-6 pt-3 pb-6">
                <InvVoucherList
                    type="REJECTION_IN"
                    title="Rejections In"
                    subtitle="Customer-returned goods awaiting inspection — converts to Sale Return on acceptance"
                    basePath="/vouchers/rejections-in"
                    newPath="/vouchers/rejections-in/new"
                />
            </div>
        </ScrollArea>
    );
}
