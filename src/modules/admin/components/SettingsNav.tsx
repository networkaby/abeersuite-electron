"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/shared/lib/format/utils";
import { SETTINGS_NAV } from "@/utils/constants";

type Props = { permissions: string[] };

/**
 * Ordered groups — logical sections separated by a vertical divider.
 * Slugs reference SETTINGS_NAV entries so labels/icons/permissions stay
 * in one place (constants.ts).
 */
const GROUP_SLUGS: string[][] = [
    ["org-defaults", "year-ending"],           // org config
    ["statuses", "sub-statuses", "pipelines"], // workflow
    ["naming-convention"],                     // inventory
    ["printer-settings", "qr-display-settings"], // hardware
];

function isActive(pathname: string, href: string): boolean {
    return pathname === href || pathname.startsWith(`${href}/`);
}

export function SettingsNav({ permissions }: Props) {
    const pathname = usePathname();
    const hasBypass = permissions.includes("admin:bypass");

    const navMap = Object.fromEntries(
        SETTINGS_NAV.map(item => [item.href.split("/").pop()!, item])
    );

    const groups = GROUP_SLUGS
        .map(slugs =>
            slugs
                .map(slug => navMap[slug])
                .filter(item => item && (hasBypass || permissions.includes(item.permission)))
        )
        .filter(group => group.length > 0);

    if (groups.flat().length === 0) return null;

    return (
        <nav className="border-b border-border pb-2" aria-label="Settings sections">
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
