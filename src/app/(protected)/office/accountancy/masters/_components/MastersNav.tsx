"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/shared/lib/format/utils";
import { filterMastersNav, MASTERS_NAV_LINKS } from "./masters-nav";

type Props = {
    permissions: string[];
};

function isActive(pathname: string, href: string): boolean {
    return pathname === href || pathname.startsWith(`${href}/`);
}

export function MastersNav({ permissions }: Props) {
    const pathname = usePathname();
    const links = filterMastersNav(MASTERS_NAV_LINKS, permissions);

    if (links.length === 0) return null;

    return (
        <nav className="border-b border-border pb-2" aria-label="Accountancy masters sections">
            <div className="-mx-1 flex max-w-full flex-wrap items-center gap-0.5 px-1 py-0.5 [scrollbar-width:thin]">
                {links.map(({ href, label, icon: Icon }) => {
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
        </nav>
    );
}
