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

// Each master is its own sidebar link, so its page opens on that tick (the page
// lock, pageAccess.ts) and the tab strip / hub show only those. The
// masters:create/edit/delete keys gate the write APIs.
export const INVENTORY_MASTERS_NAV_GROUPS: InventoryMastersNavGroup[] = [
    {
        label: "Masters",
        links: [
            { label: "Units", href: `${BASE}/units`, icon: Ruler },
            { label: "Collections", href: `${BASE}/categories`, icon: Layers },
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
