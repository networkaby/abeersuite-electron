"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/shared/lib/format/utils";
import {
    filterVouchersRegisterNav,
    VOUCHERS_REGISTER_NAV_GROUPS,
} from "@/modules/accountancy/vouchers-register-nav";

type Props = {
    permissions: string[];
};

function isActive(pathname: string, href: string): boolean {
    return pathname === href || pathname.startsWith(`${href}/`);
}

export function VouchersRegistersNav({ permissions }: Props) {
    const pathname = usePathname();
    const groups = filterVouchersRegisterNav(VOUCHERS_REGISTER_NAV_GROUPS, permissions);

    return (
        <nav className="border-b border-border pb-2" aria-label="Vouchers register sections">

            <div className="-mx-1 flex max-w-full  items-center flex-wrap gap-0.5 px-1 py-0.5 [scrollbar-width:thin]">

                {/* <div className="-mx-1 flex max-w-full flex-nowrap items-center gap-0.5 overflow-x-auto px-1 py-0.5 [scrollbar-width:thin]"> */}

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
                                    className={cn(
                                        "shrink-0 px-2 font-normal",
                                        active && "font-medium",
                                    )}
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
        </nav >
    );
}
