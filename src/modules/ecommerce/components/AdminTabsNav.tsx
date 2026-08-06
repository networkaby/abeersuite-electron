"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/shared/lib/format/utils";
import { hasSidebarLinkAccess } from "@/shared/lib/auth/permissionScope";
import { sidebarChildPermissionId } from "@/shared/lib/auth/sidebarModules";

// Dashboard has no `sidebarKey` — it's the module index (dashboardHref in
// MODULE_SECTIONS), not a child link, so it carries no ui:sidebar:* id of its
// own and shows to anyone who can open the module at all. Orders/Products/
// Masters mirror the real MODULE_SECTIONS children in utils/constants.ts —
// same slugs, so their permission ids line up with the ones the left sidebar
// already checks.
const tabs = [
    { href: "/office/ecommerce", label: "Dashboard", sidebarKey: null },
    { href: "/office/ecommerce/orders", label: "Orders", sidebarKey: "orders" },
    { href: "/office/ecommerce/products", label: "Products", sidebarKey: "products" },
    { href: "/office/ecommerce/masters", label: "Masters", sidebarKey: "masters" },
] as const;

export default function AdminTabsNav({ permissions }: { permissions: string[] }) {
    const pathname = usePathname();
    const visibleTabs = tabs.filter(
        (t) => t.sidebarKey === null || hasSidebarLinkAccess(permissions, sidebarChildPermissionId("e-commerce", t.sidebarKey))
    );

    return (
        <nav className="flex flex-wrap gap-1 border-b border-border pb-3" aria-label="E-commerce admin">
            {visibleTabs.map((t) => {
                const active =
                    t.href === "/office/ecommerce"
                        ? pathname === "/office/ecommerce"
                        : pathname === t.href || pathname.startsWith(`${t.href}/`);
                return (
                    <Link
                        key={t.href}
                        href={t.href}
                        className={cn(
                            "rounded-md px-3 py-2 text-sm font-medium transition-colors touch-manipulation",
                            active
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        )}
                    >
                        {t.label}
                    </Link>
                );
            })}
        </nav>
    );
}
