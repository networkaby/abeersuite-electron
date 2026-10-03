"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home } from "lucide-react";
import { MAX_SCREEN_TABS, isOnScreen, screensFor } from "../lib/mobileScreens";
import { PHONE_APP_HOME } from "@/shared/lib/device/phone";

/**
 * The phone app's bottom tab bar: Home plus the first screens this person holds
 * (MAX_SCREEN_TABS); every screen is also in the side menu. A tab stays lit on its
 * own detail pages. Padded by the phone's gesture area so it never sits under it.
 */
export default function MobileNav({ permissions }: { permissions: string[] }) {
    const pathname = usePathname();
    const tabs = [
        { href: PHONE_APP_HOME, tab: "Home", icon: Home, active: pathname === PHONE_APP_HOME },
        ...screensFor(permissions).slice(0, MAX_SCREEN_TABS).map((s) => ({
            href: s.href,
            tab: s.tab,
            icon: s.icon,
            active: isOnScreen(pathname, s.href),
        })),
    ];

    return (
        <nav className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
            <ul className="mx-auto flex max-w-xl">
                {tabs.map(({ href, tab, icon: Icon, active }) => (
                    <li key={href} className="flex-1">
                        <Link
                            href={href}
                            aria-current={active ? "page" : undefined}
                            className={`flex h-16 flex-col items-center justify-center gap-1 text-xs active:bg-muted ${
                                active ? "font-semibold text-primary" : "text-muted-foreground"
                            }`}
                        >
                            <Icon className="size-6" />
                            {tab}
                        </Link>
                    </li>
                ))}
            </ul>
        </nav>
    );
}
