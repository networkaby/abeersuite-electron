import { auth } from "@/auth";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { CustomerToolsPanel } from "@/modules/settings/components/CustomerToolsPanel";

export const metadata = { title: "Customer Tools" };

export default async function CustomerToolsPage() {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const canHardDelete =
        permissions.includes(PERMISSIONS.ADMIN_BYPASS) ||
        permissions.includes(PERMISSIONS.CUSTOMERS_HARD_DELETE);

    return (
        <ScrollArea className="h-full" type="always">
        <div className="space-y-6 px-6 pt-3 pb-6">
            <div>
                <h1 className="text-xl font-semibold">Customer Tools</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Convert a Person to a Company (or vice versa) while keeping the same ledger account and full
                    transaction history. Future: merge duplicate customers. The Trash section lists soft-deleted
                    tombstone rows from previous conversions; an admin can hard-delete them when ready.
                </p>
            </div>
            <CustomerToolsPanel canHardDelete={canHardDelete} />
        </div>
        </ScrollArea>
    );
}
