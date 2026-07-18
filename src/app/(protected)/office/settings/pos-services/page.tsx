import { ScrollArea } from "@/components/ui/scroll-area";
import { PosServicesManager } from "@/modules/settings/components/PosServicesManager";

export const metadata = { title: "POS Services" };

export default function PosServicesPage() {
    return (
        <ScrollArea className="h-full" type="always">
        <div className="space-y-6 px-6 pt-3 pb-6">
            <div>
                <h1 className="text-xl font-semibold">POS Services</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Services the counter can sell like products — installation, repair charge, delivery.
                    Each service posts its income to the ledger you pick here, with GST at the rate you set (18% by default).
                </p>
            </div>
            <PosServicesManager />
        </div>
        </ScrollArea>
    );
}
