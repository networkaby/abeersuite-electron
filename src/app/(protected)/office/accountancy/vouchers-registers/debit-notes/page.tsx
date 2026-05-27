import { ScrollArea } from "@/components/ui/scroll-area";
import { GlVoucherList } from "@/modules/accountancy/components/GlVoucherList";

export default function Page() {
    return (
        <ScrollArea className="h-full" type="always">
            <div className="px-6 pt-3 pb-6">
                <GlVoucherList
                    type="DEBIT_NOTE"
                    title="Debit Notes"
                    subtitle="Adjustments raised against suppliers — reduces creditor balance"
                    basePath="/office/accountancy/debit-notes"
                    newPath="/vouchers/debit-notes/new"
                />
            </div>
        </ScrollArea>
    );
}
