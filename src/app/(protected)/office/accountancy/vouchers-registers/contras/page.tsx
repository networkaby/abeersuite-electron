import { ScrollArea } from "@/components/ui/scroll-area";
import { GlVoucherList } from "@/modules/accountancy/components/GlVoucherList";

export default function Page() {
    return (
        <ScrollArea className="h-full" type="always">
            <div className="px-6 pt-3 pb-6">
                <GlVoucherList
                    type="CONTRA"
                    title="Contras"
                    subtitle="Inter-account transfers between cash and bank accounts"
                    basePath="/office/accountancy/contras"
                    newPath="/vouchers/contras/new"
                />
            </div>
        </ScrollArea>
    );
}
