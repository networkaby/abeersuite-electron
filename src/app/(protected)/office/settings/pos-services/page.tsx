import { ScrollArea } from "@/components/ui/scroll-area";
import { PosServicesManager } from "@/modules/settings/components/PosServicesManager";

export const metadata = { title: "Services" };

export default function PosServicesPage() {
    return (
        <ScrollArea className="h-full" type="always">
        <div className="space-y-6 px-6 pt-3 pb-6">
            <div>
                <h1 className="text-xl font-semibold">Services</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Work you sell or buy like a product — installation, repair charge, delivery. Add a
                    service to any bill at the counter or in the office, with GST at the rate you set
                    (18% by default). One ledger does both sides: selling the service credits it,
                    buying it debits the same ledger, so the account shows what the work earned you net.
                </p>
            </div>
            <PosServicesManager />
        </div>
        </ScrollArea>
    );
}
