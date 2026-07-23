import { ScrollArea } from "@/components/ui/scroll-area";
import { CustomerGroupsManager } from "@/modules/settings/components/CustomerGroupsManager";

export const metadata = { title: "Customer Groups" };

export default function CustomerGroupsPage() {
    return (
        <ScrollArea className="h-full" type="always">
        <div className="space-y-6 px-6 pt-3 pb-6">
            <div>
                <h1 className="text-xl font-semibold">Customer Groups</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Marketing segments — Corporate, School, Lawyer and so on. Tag each customer with a group
                    on their Profile tab, then target the right products to the right segment. Customers never see these.
                </p>
            </div>
            <CustomerGroupsManager />
        </div>
        </ScrollArea>
    );
}
