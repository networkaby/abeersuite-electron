import { ScrollArea } from "@/components/ui/scroll-area";
import { GlVoucherList } from "@/modules/accountancy/components/GlVoucherList";

export default function Page() {
    return (
        <ScrollArea className="h-full" type="always">
            <div className="px-6 pt-3 pb-6">
                <GlVoucherList
                    type="RECEIPT"
                    title="Receipts"
                    subtitle="Money received — from customers, debtors, or other income sources"
                    basePath="/office/accountancy/receipts"
                    newPath="/vouchers/receipts/new"
                />
            </div>
        </ScrollArea>
    );
}
