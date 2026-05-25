"use client";

// Breadcrumb shown above the MastersNav tabs on every page under
// /office/accountancy/masters/*. Reads the active tab label from
// MASTERS_NAV_LINKS so renames stay in one place.
//
// Drill-in routes (/groups/[id], /ledgers/[id]) show the tab label as the
// final leaf — fetching the entity name here would block render; the drill-in
// page can render its own deeper breadcrumb if/when desired.

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList,
    BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { BreadcrumbBar } from "@/shared/components/BreadcrumbBar";
import { MASTERS_NAV_LINKS } from "./masters-nav";

const MASTERS_BASE = "/office/accountancy/masters";

// Plan A: no layout-level Esc binding here. masters/groups/[id] and
// masters/ledgers/[id] already have their own useEscapeBack; adding one
// here would stack handlers and double-back. Tab pages without their own
// handler simply don't respond to Esc — use the breadcrumb to navigate up.

export function MastersBreadcrumb() {
    const pathname = usePathname();

    // Longest-prefix match so /ledgers/[id] resolves to the Ledgers tab,
    // not to nothing.
    const active = [...MASTERS_NAV_LINKS]
        .sort((a, b) => b.href.length - a.href.length)
        .find((link) => pathname === link.href || pathname.startsWith(`${link.href}/`));

    return (
        <BreadcrumbBar>
            <Breadcrumb>
            <BreadcrumbList>
                <BreadcrumbItem>
                    <BreadcrumbLink asChild>
                        <Link href="/office/accountancy">Accountancy</Link>
                    </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                    {active ? (
                        <BreadcrumbLink asChild>
                            <Link href={MASTERS_BASE}>Masters</Link>
                        </BreadcrumbLink>
                    ) : (
                        <BreadcrumbPage>Masters</BreadcrumbPage>
                    )}
                </BreadcrumbItem>
                {active && (
                    <>
                        <BreadcrumbSeparator />
                        <BreadcrumbItem>
                            <BreadcrumbPage>{active.label}</BreadcrumbPage>
                        </BreadcrumbItem>
                    </>
                )}
            </BreadcrumbList>
            </Breadcrumb>
        </BreadcrumbBar>
    );
}
