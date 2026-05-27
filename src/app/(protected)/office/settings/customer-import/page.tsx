import { ScrollArea } from "@/components/ui/scroll-area";
import { CustomerImportPanel } from "@/modules/settings/components/CustomerImportPanel";

export const metadata = { title: "Customer Import" };

export default function CustomerImportPage() {
    return (
        <ScrollArea className="h-full" type="always">
            <div className="space-y-6 px-6 pt-3 pb-6">
                <div>
                    <h1 className="text-xl font-semibold">Customer Import</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Upload a CSV of customers (Person records), map your columns, preview, then commit. Each row that
                        matches an existing customer by phone or email is either skipped or merged, based on the mode you
                        choose. New customers automatically get a ledger account under &quot;Sundry Debtors&quot;.
                    </p>
                </div>
                <CustomerImportPanel />
            </div>
        </ScrollArea>
    );
}
