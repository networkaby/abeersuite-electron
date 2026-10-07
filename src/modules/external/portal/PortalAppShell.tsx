"use client";

import Link from "next/link";
import { CUSTOMER_SIGN_OUT_PATH } from "@/shared/lib/constants/session";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { signOutTo } from "@/shared/lib/auth/signOutTo";
import {
    ChevronDown,
    CreditCard,
    Heart,
    LayoutDashboard,
    LogOut,
    MoreHorizontal,
    Percent,
    ShoppingBag,
    Ticket,
    UserRound,
    Receipt,
    Users,
    Wallet,
    X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LEGAL_LINKS } from "@/shared/lib/legal/legalContent";
import UserAvatar from "@/shared/components/UserAvatar";
import PortalShopButton from "@/modules/external/portal/PortalShopButton";
import PortalProfileSwitch from "@/modules/external/portal/PortalProfileSwitch";
import { usePortalAccountStore } from "@/store/external/portalAccountStore";

type PortalAppShellProps = {
    children: React.ReactNode;
};

const NAV_ITEMS = [
    { href: "/portal", label: "Dashboard", icon: LayoutDashboard },
    { href: "/portal/orders", label: "My Orders", icon: ShoppingBag },
    { href: "/portal/bills", label: "My Bills", icon: Receipt },
    { href: "/portal/repairs", label: "My Repairs", icon: Ticket },
    { href: "/portal/social", label: "Social", icon: Users },
    { href: "/portal/coupons", label: "My Coupons", icon: Percent },
    { href: "/portal/wallet", label: "My Wallet", icon: Wallet },
    { href: "/portal/wishlist", label: "Wishlist", icon: Heart },
    { href: "/portal/profile", label: "My Profile", icon: UserRound },
] as const;

/** Phone bottom bar: four everyday tabs; "More" opens the full menu. */
const TAB_ITEMS = [
    { href: "/portal", label: "Home", icon: LayoutDashboard },
    { href: "/portal/orders", label: "Orders", icon: ShoppingBag },
    { href: "/portal/bills", label: "Bills", icon: Receipt },
    { href: "/portal/repairs", label: "Repairs", icon: Ticket },
] as const;

function isActive(pathname: string, href: string) {
    return pathname === href || (href !== "/portal" && pathname.startsWith(href));
}

/** Sign-up / password pages render bare — no sidebar for someone not signed in. */
const PORTAL_AUTH_PAGES = ["/portal/register", "/portal/forgot-password"];

function isPortalAuthPage(pathname: string) {
    return PORTAL_AUTH_PAGES.includes(pathname);
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
                    const active = isActive(pathname, item.href);
                    const Icon = item.icon;
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            onClick={onNavigate}
                            className={[
                                "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition md:py-2",
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
            <div className="space-y-2 border-t border-border/70 p-3 text-xs text-muted-foreground">
                <Link href="/shop" className="inline-flex items-center gap-1 hover:text-foreground">
                    <CreditCard className="size-3.5" />
                    Continue shopping
                </Link>
                <nav aria-label="Legal" className="flex flex-wrap gap-x-3 gap-y-1">
                    {LEGAL_LINKS.map((link) => (
                        <Link
                            key={link.href}
                            href={link.href}
                            onClick={onNavigate}
                            className="hover:text-foreground hover:underline"
                        >
                            {link.label}
                        </Link>
                    ))}
                </nav>
            </div>
        </div>
    );
}

export default function PortalAppShell({ children }: PortalAppShellProps) {
    const pathname = usePathname();
    const { data: session, status } = useSession();
    const [open, setOpen] = useState(false);
    const user = session?.user as { kind?: string; name?: string } | undefined;
    const isCustomer = user?.kind === "customer";
    // The store copy wins once loaded: it follows a rename or a new photo
    // straight away, while the session name only refreshes on next sign-in.
    const profile = usePortalAccountStore((s) => s.profile);
    const displayName = profile?.name ?? user?.name ?? "";

    if (isPortalAuthPage(pathname)) {
        return <div className="min-h-screen bg-background">{children}</div>;
    }

    return (
        <div className="min-h-screen bg-background">
            <header className="sticky top-0 z-30 border-b border-border/70 bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80">
                <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-2 px-3 sm:gap-3 sm:px-4">
                    <div className="flex min-w-0 items-center gap-2">
                        {/* Phones drop the title: the Home tab already leads here. */}
                        <Link href="/portal" className="hidden truncate text-sm font-semibold tracking-tight sm:inline">
                            Network Service Portal
                        </Link>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                        <PortalShopButton compact />
                        {isCustomer ? (
                            <>
                                <PortalProfileSwitch />
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="sm" className="gap-1 px-1 sm:gap-2 sm:pl-1.5" aria-label="Account menu">
                                            <UserAvatar avatarUrl={profile?.avatarUrl} name={displayName || "Customer"} role={null} sizePx={26} />
                                            <span className="hidden max-w-[8rem] truncate sm:inline">{displayName || "My Account"}</span>
                                            <ChevronDown className="hidden size-3.5 shrink-0 opacity-60 sm:block" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem asChild>
                                        <Link href="/portal/profile">
                                            <UserRound className="size-4" />
                                            My Profile
                                        </Link>
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        variant="destructive"
                                        onClick={() => void signOutTo(CUSTOMER_SIGN_OUT_PATH)}
                                    >
                                        <LogOut className="size-4" />
                                        Sign out
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                                </DropdownMenu>
                            </>
                        ) : status === "unauthenticated" ? (
                            // Not while the session is still loading: a signed-in
                            // customer would see "Sign in" flash on every page.
                            <Button variant="outline" size="sm" asChild>
                                <Link href="/login">Sign in</Link>
                            </Button>
                        ) : null}
                    </div>
                </div>
            </header>

            <div className="mx-auto flex max-w-7xl">
                {isCustomer ? (
                    <aside className="hidden h-[calc(100vh-56px)] w-64 shrink-0 border-r border-border/70 md:block md:sticky md:top-14">
                        <Sidebar pathname={pathname} />
                    </aside>
                ) : null}
                <main className={`min-w-0 flex-1 ${isCustomer ? "pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0" : ""}`}>{children}</main>
            </div>

            {isCustomer ? (
                <nav
                    aria-label="Portal tabs"
                    className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border/70 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
                >
                    {TAB_ITEMS.map((item) => {
                        const Icon = item.icon;
                        const active = isActive(pathname, item.href);
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                aria-current={active ? "page" : undefined}
                                className={`flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium ${active ? "text-primary" : "text-muted-foreground"}`}
                            >
                                <Icon className="size-5" />
                                {item.label}
                            </Link>
                        );
                    })}
                    <button
                        type="button"
                        onClick={() => setOpen(true)}
                        className={`flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium ${open || !TAB_ITEMS.some((t) => isActive(pathname, t.href)) ? "text-primary" : "text-muted-foreground"}`}
                    >
                        <MoreHorizontal className="size-5" />
                        More
                    </button>
                </nav>
            ) : null}

            {isCustomer && open ? (
                <div className="fixed inset-0 z-50 md:hidden">
                    <button
                        type="button"
                        className="absolute inset-0 bg-black/40"
                        aria-label="Close menu backdrop"
                        onClick={() => setOpen(false)}
                    />
                    <aside className="absolute left-0 top-0 h-full w-72 max-w-[85vw] overflow-y-auto border-r border-border bg-background shadow-xl">
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

