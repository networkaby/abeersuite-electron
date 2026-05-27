import { ScrollArea } from "@/components/ui/scroll-area";
import { GlVoucherList } from "@/modules/accountancy/components/GlVoucherList";

export default function Page() {
    return (
        <ScrollArea className="h-full" type="always">
            <div className="px-6 pt-3 pb-6">
                <GlVoucherList
                    type="CREDIT_NOTE"
                    title="Credit Notes"
                    subtitle="Allowances granted to customers — reduces debtor balance"
                    basePath="/office/accountancy/credit-notes"
                    newPath="/vouchers/credit-notes/new"
                />
            </div>
        </ScrollArea>
    );
}
