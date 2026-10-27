import { ScrollArea } from "@/components/ui/scroll-area";
import { TrackingCodesForm } from "@/modules/settings/components/TrackingCodesForm";

export const metadata = { title: "Tracking Codes" };

export default function TrackingCodesPage() {
    return (
        <ScrollArea className="h-full" type="always">
            <div className="space-y-6 px-6 pt-3 pb-8">
                <div>
                    <h1 className="text-xl font-semibold">Tracking Codes</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Analytics and ad pixels for the online shop. They load only on the shop pages — never in office or on a counter.
                    </p>
                </div>
                <TrackingCodesForm />
            </div>
        </ScrollArea>
    );
}
