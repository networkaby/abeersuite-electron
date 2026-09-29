"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/shared/lib/format/utils";
import { INVENTORY_MASTERS_NAV_GROUPS } from "@/modules/inventory/masters-nav";
import { useCanOpenPage } from "@/shared/hooks/useCanOpenPage";

function isActive(pathname: string, href: string): boolean {
    return pathname === href || pathname.startsWith(`${href}/`);
}

// A tab shows only when this person may open its page — each master is its own
// sidebar tick (the page lock, pageAccess.ts). A group left empty is dropped.
export function InventoryMastersNav() {
    const pathname = usePathname();
    const canOpen = useCanOpenPage();
    const groups = INVENTORY_MASTERS_NAV_GROUPS
        .map((group) => ({ ...group, links: group.links.filter((link) => canOpen(link.href)) }))
        .filter((group) => group.links.length > 0);

    return (
        <nav className="border-b border-border pb-2" aria-label="Inventory masters sections">
            <div className="-mx-1 flex max-w-full flex-wrap items-center gap-0.5 px-1 py-0.5 [scrollbar-width:thin]">
                {groups.map((group, gi) => (
                    <div key={group.label} className="contents">
                        {gi > 0 ? (
                            <div
                                role="separator"
                                className="mx-0.5 h-3.5 w-px shrink-0 self-center bg-border"
                                aria-hidden
                            />
                        ) : null}
                        {group.links.map(({ href, label, icon: Icon }) => {
                            const active = isActive(pathname, href);
                            return (
                                <Button
                                    key={href}
                                    asChild
                                    variant={active ? "secondary" : "ghost"}
                                    size="xs"
                                    className={cn("shrink-0 px-2 font-normal", active && "font-medium")}
                                >
                                    <Link href={href}>
                                        <Icon className="size-3" aria-hidden />
                                        {label}
                                    </Link>
                                </Button>
                            );
                        })}
                    </div>
                ))}
            </div>
        </nav>
    );
}
