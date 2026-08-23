import { ScrollArea } from "@/components/ui/scroll-area";
import { OfflinePoliciesForm } from "@/modules/settings/components/OfflinePoliciesForm";

export const metadata = { title: "Offline Policies" };

export default function OfflinePoliciesPage() {
    return (
        <ScrollArea className="h-full" type="always">
            <div className="space-y-6 px-6 pt-3 pb-8">
                <div>
                    <h1 className="text-xl font-semibold">Offline Policies & Safety Controls</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Configure which transactions and documents are permitted when this counter PC is operating without an internet connection.
                    </p>
                </div>
                <OfflinePoliciesForm />
            </div>
        </ScrollArea>
    );
}
