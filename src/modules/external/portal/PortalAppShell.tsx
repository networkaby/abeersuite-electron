"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { signOut, useSession } from "next-auth/react";
import {
    CreditCard,
    Heart,
    LayoutDashboard,
    Menu,
    Percent,
    Settings,
    ShoppingBag,
    Ticket,
    Users,
    Wallet,
    X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type PortalAppShellProps = {
    children: React.ReactNode;
};

const NAV_ITEMS = [
    { href: "/portal", label: "Dashboard", icon: LayoutDashboard },
    { href: "/portal/orders", label: "My Orders", icon: ShoppingBag },
    { href: "/portal/repairs", label: "My Repairs", icon: Ticket },
    { href: "/portal/social", label: "Social", icon: Users },
    { href: "/portal/coupons", label: "My Coupons", icon: Percent },
    { href: "/portal/wallet", label: "My Wallet", icon: Wallet },
    { href: "/portal/wishlist", label: "Wishlist", icon: Heart },
    { href: "/portal/settings", label: "Profile Settings", icon: Settings },
] as const;

function isPortalAuthPage(pathname: string) {
    return pathname === "/portal/login" || pathname === "/portal/register";
}

function Sidebar({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
    return (
        <div className="flex h-full flex-col">
            <div className="border-b border-border/70 px-4 py-4">
                <p className="text-sm font-semibold tracking-tight">Customer Hub</p>
                <p className="text-xs text-muted-foreground">Everything in one place</p>
            </div>
            <nav className="flex-1 space-y-1 p-3">
                {NAV_ITEMS.map((item) => {
                    const active = pathname === item.href || (item.href !== "/portal" && pathname.startsWith(item.href));
                    const Icon = item.icon;
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            onClick={onNavigate}
                            className={[
                                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
                                active
                                    ? "bg-primary/12 text-primary"
                                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                            ].join(" ")}
                        >
                            <Icon className="size-4" />
                            <span>{item.label}</span>
                        </Link>
                    );
                })}
            </nav>
            <div className="border-t border-border/70 p-3 text-xs text-muted-foreground">
                <Link href="/shop" className="inline-flex items-center gap-1 hover:text-foreground">
                    <CreditCard className="size-3.5" />
                    Continue shopping
                </Link>
            </div>
        </div>
    );
}

export default function PortalAppShell({ children }: PortalAppShellProps) {
    const pathname = usePathname();
    const { data: session } = useSession();
    const [open, setOpen] = useState(false);
    const user = session?.user as { kind?: string; name?: string } | undefined;
    const isCustomer = user?.kind === "customer";

    if (isPortalAuthPage(pathname)) {
        return <div className="min-h-screen bg-background">{children}</div>;
    }

    return (
        <div className="min-h-screen bg-background">
            <header className="sticky top-0 z-30 border-b border-border/70 bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80">
                <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4">
                    <div className="flex items-center gap-2">
                        {isCustomer ? (
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="md:hidden"
                                onClick={() => setOpen(true)}
                                aria-label="Open menu"
                            >
                                <Menu className="size-5" />
                            </Button>
                        ) : null}
                        <Link href="/portal" className="text-sm font-semibold tracking-tight">
                            Network Service Portal
                        </Link>
                    </div>
                    <div className="flex items-center gap-2">
                        {isCustomer ? <Badge variant="secondary" className="hidden sm:inline-flex">Signed in</Badge> : null}
                        {isCustomer ? (
                            <Button variant="outline" size="sm" onClick={() => signOut({ callbackUrl: "/portal" })}>
                                Sign out
                            </Button>
                        ) : (
                            <Button variant="outline" size="sm" asChild>
                                <Link href="/portal/login">Sign in</Link>
                            </Button>
                        )}
                    </div>
                </div>
            </header>

            <div className="mx-auto flex max-w-7xl">
                {isCustomer ? (
                    <aside className="hidden h-[calc(100vh-56px)] w-64 shrink-0 border-r border-border/70 md:block md:sticky md:top-14">
                        <Sidebar pathname={pathname} />
                    </aside>
                ) : null}
                <main className="min-w-0 flex-1">{children}</main>
            </div>

            {isCustomer && open ? (
                <div className="fixed inset-0 z-50 md:hidden">
                    <button
                        type="button"
                        className="absolute inset-0 bg-black/40"
                        aria-label="Close menu backdrop"
                        onClick={() => setOpen(false)}
                    />
                    <aside className="absolute left-0 top-0 h-full w-72 border-r border-border bg-background shadow-xl">
                        <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
                            <p className="text-sm font-semibold">Menu</p>
                            <Button type="button" variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close menu">
                                <X className="size-4" />
                            </Button>
                        </div>
                        <Sidebar pathname={pathname} onNavigate={() => setOpen(false)} />
                    </aside>
                </div>
            ) : null}
        </div>
    );
}

