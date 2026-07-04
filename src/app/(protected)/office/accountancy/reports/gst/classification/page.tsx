import { auth } from "@/auth";
import { ScrollArea } from "@/components/ui/scroll-area";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { TaxClassificationClient } from "./TaxClassificationClient";

export const metadata = { title: "Tax Classification" };

// SSR shell — accountancy layout already gates `accountancy:view:org`, so we
// only resolve the user once to find out whether the edit affordances should
// be rendered. Gated by the dedicated `compliance:tax:edit` (or the broader
// `inventory:manage`, which already covers every inventory-master field
// including tax — kept as a fallback so existing inventory-manager roles
// don't lose access).
export default async function TaxClassificationPage() {
    const session = await auth();
    const perms =
        (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const canEdit =
        hasPermissionWithScope(perms, PERMISSIONS.COMPLIANCE_TAX_EDIT) ||
        hasPermissionWithScope(perms, PERMISSIONS.INVENTORY_MANAGE) ||
        hasPermissionWithScope(perms, PERMISSIONS.ADMIN_BYPASS);

    return (
        <ScrollArea className="h-full" type="always">
        <div className="mx-auto max-w-7xl space-y-5 p-1">
            <div>
                <h1 className="text-2xl font-bold text-foreground">Tax Classification</h1>
                <p className="mt-0.5 text-sm text-muted-foreground">
                    How the catalog is configured for GST &mdash; rate-wise, HSN-wise, group hierarchy,
                    and per-item with the resolved cascade source. Click any cell or the pencil to edit.
                </p>
            </div>
            <TaxClassificationClient canEdit={canEdit} />
        </div>
        </ScrollArea>
    );
}
