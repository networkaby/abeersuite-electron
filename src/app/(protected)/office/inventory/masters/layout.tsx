import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { InventoryMastersNav } from "@/modules/inventory/components/InventoryMastersNav";
import { PathBreadcrumb } from "@/shared/components/PathBreadcrumb";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

export default async function InventoryMastersLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];

    // View rides any inventory-masters capability or the inventory:manage umbrella.
    const canOpenMasters =
        permissions.includes(PERMISSIONS.ADMIN_BYPASS) ||
        permissions.includes(PERMISSIONS.INVENTORY_MASTERS_CREATE) ||
        permissions.includes(PERMISSIONS.INVENTORY_MASTERS_EDIT) ||
        permissions.includes(PERMISSIONS.INVENTORY_MASTERS_DELETE);
    if (!canOpenMasters) {
        redirect("/office/work-flow-inbox");
    }

    return (
        <div className="flex h-full flex-col">
            <PathBreadcrumb
                root={{ href: "/office/inventory", label: "Inventory" }}
                labels={{
                    "masters": "Masters",
                    "gst-rates": "GST Rates",
                    "warranty-terms": "Warranty Terms",
                    "product-groups": "Product Groups",
                    "attribute-masters": "Attribute Masters",
                    "boms": "BOMs",
                }}
            />
            <div className="flex-none px-6">
                <InventoryMastersNav permissions={permissions} />
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
        </div>
    );
}
