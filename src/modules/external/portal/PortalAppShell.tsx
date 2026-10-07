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
    Menu,
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
    const { data: session } = useSession();
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
                        <PortalShopButton compact />
                        {isCustomer ? (
                            <>
                                <PortalProfileSwitch />
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="sm" className="gap-2 pl-1.5" aria-label="Account menu">
                                            <UserAvatar avatarUrl={profile?.avatarUrl} name={displayName || "Customer"} role={null} sizePx={26} />
                                            <span className="hidden max-w-[8rem] truncate sm:inline">{displayName || "My Account"}</span>
                                            <ChevronDown className="size-3.5 shrink-0 opacity-60" />
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
                        ) : (
                            <Button variant="outline" size="sm" asChild>
                                <Link href="/login">Sign in</Link>
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

