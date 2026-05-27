import { ScrollArea } from "@/components/ui/scroll-area";
import { GlVoucherList } from "@/modules/accountancy/components/GlVoucherList";

export default function Page() {
    return (
        <ScrollArea className="h-full" type="always">
            <div className="px-6 pt-3 pb-6">
                <GlVoucherList
                    type="PAYMENT"
                    title="Payments"
                    subtitle="Money paid out — to suppliers, expenses, or party accounts"
                    basePath="/office/accountancy/payments"
                    newPath="/vouchers/payments/new"
                />
            </div>
        </ScrollArea>
    );
}
