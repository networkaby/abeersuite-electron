import { ScrollArea } from "@/components/ui/scroll-area";
import { CustomerToolsPanel } from "@/modules/settings/components/CustomerToolsPanel";

export const metadata = { title: "Customer Tools" };

export default function CustomerToolsPage() {
    return (
        <ScrollArea className="h-full" type="always">
        <div className="space-y-6 px-6 pt-3 pb-6">
            <div>
                <h1 className="text-xl font-semibold">Customer Tools</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Convert a Person to a Company (or vice versa) while keeping the same ledger account and full
                    transaction history, or merge duplicate customers into one. Either way the old record is
                    removed in the same step — its history lives on the account, so nothing is left to clean up.
                </p>
            </div>
            <CustomerToolsPanel />
        </div>
        </ScrollArea>
    );
}
