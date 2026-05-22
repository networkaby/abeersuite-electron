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
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

export type InventoryMastersNavLink = {
    label: string;
    href: string;
    icon: LucideIcon;
    permission?: string;
};

export type InventoryMastersNavGroup = {
    label: string;
    links: InventoryMastersNavLink[];
};

const BASE = "/office/inventory/masters";
const MANAGE = PERMISSIONS.INVENTORY_MANAGE;

export const INVENTORY_MASTERS_NAV_GROUPS: InventoryMastersNavGroup[] = [
    {
        label: "Masters",
        links: [
            { label: "Units", href: `${BASE}/units`, icon: Ruler, permission: MANAGE },
            { label: "Categories", href: `${BASE}/categories`, icon: Layers, permission: MANAGE },
            { label: "Groups", href: `${BASE}/product-groups`, icon: LayoutGrid, permission: MANAGE },
            { label: "Brands", href: `${BASE}/brands`, icon: Tag, permission: MANAGE },
            { label: "Warranty terms", href: `${BASE}/warranty-terms`, icon: ShieldCheck, permission: MANAGE },
            { label: "Products", href: "/office/inventory/products", icon: Box, permission: MANAGE },
            { label: "Attribute masters", href: `${BASE}/attribute-masters`, icon: ListChecks, permission: MANAGE },
            { label: "GST Rates", href: `${BASE}/gst-rates`, icon: Percent, permission: MANAGE },
            { label: "BOMs", href: `${BASE}/boms`, icon: Workflow, permission: MANAGE },
        ],
    },
];

export function filterInventoryMastersNav(
    groups: InventoryMastersNavGroup[],
    permissions: string[],
): InventoryMastersNavGroup[] {
    const isAdmin = permissions.includes(PERMISSIONS.ADMIN_BYPASS);
    return groups
        .map((group) => ({
            ...group,
            links: group.links.filter(
                (link) => isAdmin || !link.permission || permissions.includes(link.permission),
            ),
        }))
        .filter((group) => group.links.length > 0);
}
