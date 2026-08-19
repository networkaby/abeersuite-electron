import { InventoryMastersNav } from "@/modules/inventory/components/InventoryMastersNav";
import { PathBreadcrumb } from "@/shared/components/PathBreadcrumb";

// Viewing masters is a read — default-open for signed-in staff. The
// masters:create/edit/delete keys gate the write APIs, not the pages.
export default function InventoryMastersLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex h-full flex-col">
            <PathBreadcrumb
                root={{ href: "/office/inventory", label: "Inventory" }}
                escapeBack
                labels={{
                    "masters": "Masters",
                    "gst-rates": "GST Rates",
                    "warranty-terms": "Warranty Terms",
                    "product-groups": "Groups",
                    "attribute-masters": "Attribute Masters",
                    "boms": "BOMs",
                    "brands": "Brands",
                    "units": "Units",
                    "categories": "Categories",
                }}
            />
            <div className="flex-none px-6">
                <InventoryMastersNav />
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
        </div>
    );
}
