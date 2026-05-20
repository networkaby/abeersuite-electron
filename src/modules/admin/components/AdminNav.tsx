"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/shared/lib/format/utils";
import { ADMIN_NAV } from "@/utils/constants";

type Props = { permissions: string[] };

/**
 * Ordered groups — each inner array is a logical section separated by a
 * vertical divider.  We reference items by their URL trailing slug so the
 * canonical label / icon / permission stays in the ADMIN_NAV constant.
 */
const GROUP_SLUGS: string[][] = [
    ["users", "org-chart"],                    // people
    ["branches", "departments", "positions"],  // org structure
    ["role"],                                  // access control
    ["counters"],                              // POS system
];

function isActive(pathname: string, href: string): boolean {
    return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNav({ permissions }: Props) {
    const pathname = usePathname();
    const hasBypass = permissions.includes("admin:bypass");

    // Build a slug → nav-item lookup from the single source of truth
    const navMap = Object.fromEntries(
        ADMIN_NAV.map(item => [item.href.split("/").pop()!, item])
    );

    // Resolve groups, filtering out items the user has no permission for
    const groups = GROUP_SLUGS
        .map(slugs =>
            slugs
                .map(slug => navMap[slug])
                .filter(item => item && (hasBypass || permissions.includes(item.permission)))
        )
        .filter(group => group.length > 0);

    if (groups.flat().length === 0) return null;

    return (
        <nav className="border-b border-border pb-2" aria-label="Admin sections">
            <div className="-mx-1 flex max-w-full items-center flex-wrap gap-0.5 px-1 py-0.5 [scrollbar-width:thin]">
                {groups.map((group, gi) => (
                    <div key={gi} className="contents">
                        {gi > 0 && (
                            <div
                                role="separator"
                                className="mx-0.5 h-3.5 w-px shrink-0 self-center bg-border"
                                aria-hidden
                            />
                        )}
                        {group.map(item => {
                            const Icon = item.icon;
                            const active = isActive(pathname, item.href);
                            return (
                                <Button
                                    key={item.href}
                                    asChild
                                    variant={active ? "secondary" : "ghost"}
                                    size="xs"
                                    className={cn(
                                        "shrink-0 px-2 font-normal",
                                        active && "font-medium",
                                    )}
                                >
                                    <Link href={item.href}>
                                        <Icon className="size-3" aria-hidden />
                                        {item.label}
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
