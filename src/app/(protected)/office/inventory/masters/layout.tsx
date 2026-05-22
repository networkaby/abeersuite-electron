import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { InventoryMastersNav } from "@/modules/inventory/components/InventoryMastersNav";
import { PathBreadcrumb } from "@/shared/components/PathBreadcrumb";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

export default async function InventoryMastersLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];

    if (
        !permissions.includes(PERMISSIONS.ADMIN_BYPASS) &&
        !permissions.includes(PERMISSIONS.INVENTORY_MANAGE)
    ) {
        redirect("/office/core/assignments");
    }

    return (
        <div className="container max-w-7xl space-y-0 py-0">
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
            <InventoryMastersNav permissions={permissions} />
            {children}
        </div>
    );
}
