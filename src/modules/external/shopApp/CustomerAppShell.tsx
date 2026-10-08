"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { SessionProvider } from "next-auth/react";
import { House, LayoutGrid, ShoppingBag, ShoppingCart, UserRound } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { useShopCartStore } from "@/store/external/shopCartStore";
import { noSubscribe } from "@/modules/mobile/components/installPlace";
import { APP } from "@/modules/external/shopApp/appPaths";

/** The customer app's five tabs. `owns` lists the screens under each tab, so the
 *  right tab stays lit on a screen opened from it. */
const TABS = [
    { href: APP, label: "Home", icon: House, owns: [] as string[] },
    { href: `${APP}/categories`, label: "Categories", icon: LayoutGrid, owns: [`${APP}/products`, `${APP}/search`] },
    { href: `${APP}/cart`, label: "Cart", icon: ShoppingCart, owns: [] as string[] },
    { href: `${APP}/orders`, label: "Orders", icon: ShoppingBag, owns: [] as string[] },
    { href: `${APP}/account`, label: "Account", icon: UserRound, owns: [] as string[] },
] as const;

function isActive(pathname: string, tab: (typeof TABS)[number]): boolean {
    if (pathname === tab.href) return true;
    const under = (base: string) => pathname === base || pathname.startsWith(`${base}/`);
    return (tab.href !== APP && under(tab.href)) || tab.owns.some(under);
}

/**
 * Screens pushed on top of a tab — full screen with their own Back and their
 * own bottom bar (Add to cart, Place order), so no tabs, as in Flipkart and
 * Amazon.
 */
const PUSHED = [`${APP}/product/`, `${APP}/checkout`, `${APP}/order/`, `${APP}/login`, `${APP}/search`, `${APP}/bill/`, `${APP}/receipt/`];

export function isPushedScreen(pathname: string): boolean {
    return PUSHED.some((p) => pathname === p || pathname.startsWith(p));
}

/**
 * Everything around a customer-app screen: the bottom tab bar and the toasts.
 * `data-phone-app` switches on the app-not-a-web-page rules in globals.css (no
 * pull-to-refresh bounce, no tap flash, no text selection on a long press).
 */
export default function CustomerAppShell({ children }: { children: React.ReactNode }) {
    const pushed = isPushedScreen(usePathname());
    return (
        <SessionProvider>
            <div data-phone-app className="min-h-dvh bg-background">
                {/* Bottom padding = the tab bar (h-16) plus the phone's gesture area;
                    a pushed screen pads for its own bottom bar instead. */}
                <div
                    className={`mx-auto flex min-h-dvh w-full max-w-xl flex-col ${
                        pushed ? "" : "pb-[calc(4rem+env(safe-area-inset-bottom))]"
                    }`}
                >
                    {children}
                </div>
                {!pushed && <TabBar />}
            </div>
            <Toaster position="top-center" richColors />
        </SessionProvider>
    );
}

function TabBar() {
    const pathname = usePathname();
    return (
        <nav
            aria-label="App tabs"
            className="fixed inset-x-0 bottom-0 z-30 border-t border-border/70 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
        >
            <div className="mx-auto grid max-w-xl grid-cols-5">
                {TABS.map((tab) => {
                    const { href, label, icon: Icon } = tab;
                    const active = isActive(pathname, tab);
                    return (
                        <Link
                            key={href}
                            href={href}
                            aria-current={active ? "page" : undefined}
                            className={`relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium active:bg-muted ${
                                active ? "text-primary" : "text-muted-foreground"
                            }`}
                        >
                            <Icon className="size-5" strokeWidth={active ? 2.4 : 2} />
                            {label}
                            {href === `${APP}/cart` && <CartCount />}
                        </Link>
                    );
                })}
            </div>
        </nav>
    );
}

/** Items in the cart. The cart lives in the phone's storage, so nothing shows
 *  until the page is running in the phone — never a wrong number from the server. */
export function useCartCount(): number {
    const count = useShopCartStore((s) => s.lines.reduce((n, l) => n + l.quantity, 0));
    const ready = useSyncExternalStore(noSubscribe, () => true, () => false);
    return ready ? count : 0;
}

function CartCount() {
    const count = useCartCount();
    if (count === 0) return null;
    return (
        <span className="absolute left-1/2 top-2 ml-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
            {count > 99 ? "99+" : count}
        </span>
    );
}
