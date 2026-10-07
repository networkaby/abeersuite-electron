"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { SessionProvider } from "next-auth/react";
import { House, LayoutGrid, ShoppingBag, ShoppingCart, UserRound } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { useShopCartStore } from "@/store/external/shopCartStore";
import { noSubscribe } from "@/modules/mobile/components/installPlace";
import { SHOP_NATIVE_HOME } from "@/shared/lib/device/shopApp";

/**
 * The customer app's five tabs. Cart and Orders open the website's own screens
 * for now; they move into the app in the next phases.
 */
const TABS = [
    { href: SHOP_NATIVE_HOME, label: "Home", icon: House },
    { href: `${SHOP_NATIVE_HOME}/categories`, label: "Categories", icon: LayoutGrid },
    { href: "/shop/cart", label: "Cart", icon: ShoppingCart },
    { href: "/portal/orders", label: "Orders", icon: ShoppingBag },
    { href: `${SHOP_NATIVE_HOME}/account`, label: "Account", icon: UserRound },
] as const;

function isActive(pathname: string, href: string): boolean {
    return pathname === href || (href !== SHOP_NATIVE_HOME && pathname.startsWith(`${href}/`));
}

/**
 * Everything around a customer-app screen: the bottom tab bar and the toasts.
 * `data-phone-app` switches on the app-not-a-web-page rules in globals.css (no
 * pull-to-refresh bounce, no tap flash, no text selection on a long press).
 */
export default function CustomerAppShell({ children }: { children: React.ReactNode }) {
    return (
        <SessionProvider>
            <div data-phone-app className="min-h-dvh bg-background">
                {/* Bottom padding = the tab bar (h-16) plus the phone's gesture area. */}
                <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col pb-[calc(4rem+env(safe-area-inset-bottom))]">
                    {children}
                </div>
                <TabBar />
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
                {TABS.map(({ href, label, icon: Icon }) => {
                    const active = isActive(pathname, href);
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
                            {href === "/shop/cart" && <CartCount />}
                        </Link>
                    );
                })}
            </div>
        </nav>
    );
}

/** Items in the cart. The cart lives in the phone's storage, so nothing shows
 *  until the page is running in the phone — never a wrong number from the server. */
function CartCount() {
    const count = useShopCartStore((s) => s.lines.reduce((n, l) => n + l.quantity, 0));
    const ready = useSyncExternalStore(noSubscribe, () => true, () => false);
    if (!ready || count === 0) return null;
    return (
        <span className="absolute left-1/2 top-2 ml-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
            {count > 99 ? "99+" : count}
        </span>
    );
}
