import type { LucideIcon } from "lucide-react";
import {
    Box,
    Layers,
    LayoutGrid,
    ListChecks,
    Percent,
    Ruler,
    ShieldCheck,
    Tag,
    Workflow,
} from "lucide-react";

export type InventoryMastersNavLink = {
    label: string;
    href: string;
    icon: LucideIcon;
};

export type InventoryMastersNavGroup = {
    label: string;
    links: InventoryMastersNavLink[];
};

const BASE = "/office/inventory/masters";

// Viewing masters is a read — default-open, so every staff member sees every
// tab. The masters:create/edit/delete keys gate the write APIs, not the nav.
export const INVENTORY_MASTERS_NAV_GROUPS: InventoryMastersNavGroup[] = [
    {
        label: "Masters",
        links: [
            { label: "Units", href: `${BASE}/units`, icon: Ruler },
            { label: "Categories", href: `${BASE}/categories`, icon: Layers },
            { label: "Groups", href: `${BASE}/product-groups`, icon: LayoutGrid },
            { label: "Brands", href: `${BASE}/brands`, icon: Tag },
            { label: "Warranty terms", href: `${BASE}/warranty-terms`, icon: ShieldCheck },
            { label: "Products", href: "/office/inventory/products", icon: Box },
            { label: "Attribute masters", href: `${BASE}/attribute-masters`, icon: ListChecks },
            { label: "GST Rates", href: `${BASE}/gst-rates`, icon: Percent },
            { label: "BOMs", href: `${BASE}/boms`, icon: Workflow },
        ],
    },
];
