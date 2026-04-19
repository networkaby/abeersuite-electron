"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
    LayoutDashboard,
    Users,
    Ticket,
    Building2,
    UserCog,
    Settings,
    ShieldCheck,
    LogOut,
} from "lucide-react";
import NotificationBell from "@/components/NotificationBell";

// roles: null = all authenticated users
const NAV_ITEMS = [
    { label: "Dashboard",       href: "/dashboard",             icon: LayoutDashboard, roles: null },
    { label: "Customers",       href: "/customers",             icon: Users,           roles: null },
    { label: "Tickets",         href: "/tickets",               icon: Ticket,          roles: null },
    { label: "Service Centers", href: "/service-centers",       icon: Building2,       roles: ["R1", "R2"] },
    { label: "Users",           href: "/users",                 icon: UserCog,         roles: ["R1"] },
    { label: "Statuses",        href: "/settings/statuses",     icon: Settings,        roles: ["R1"] },
    { label: "Sub-Statuses",    href: "/settings/sub-statuses", icon: Settings,        roles: ["R1"] },
    { label: "Roles",           href: "/settings/roles",        icon: ShieldCheck,     roles: ["R1"] },
] as const;

type SidebarUser = {
    name?: string | null;
    role?: string | null;
    roles?: string[] | null;
};

export default function Sidebar({ user }: { user?: SidebarUser }) {
    const pathname = usePathname();
    const userRoles = user?.roles ?? (user?.role ? [user.role] : []);
    const primaryRole = user?.role ?? "";

    const visibleItems = NAV_ITEMS.filter(
        (item) => item.roles === null || item.roles.some((r) => userRoles.includes(r))
    );

    // Build role label: "Front Desk / Despatch" for multi-role users
    const roleLabel = userRoles.length > 0
        ? userRoles.join(" / ")
        : primaryRole;

    return (
        <aside className="w-64 bg-white shadow-md flex flex-col min-h-screen">
            {/* Logo */}
            <div className="p-6 border-b">
                <div className="flex items-center justify-between">
                    <h1 className="text-xl font-bold text-blue-600">ServiceMgmt</h1>
                    <NotificationBell />
                </div>
                <p className="text-xs text-gray-600 font-medium mt-1">{user?.name}</p>
                <p className="text-xs text-gray-400 truncate">{roleLabel}</p>
            </div>

            {/* Nav */}
            <nav className="flex-1 p-4 space-y-1">
                {visibleItems.map(({ label, href, icon: Icon }) => {
                    const isActive = pathname.startsWith(href);
                    return (
                        <Link
                            key={href}
                            href={href}
                            className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                                isActive
                                    ? "bg-blue-50 text-blue-600"
                                    : "text-gray-600 hover:bg-gray-100"
                            }`}
                        >
                            <Icon size={18} />
                            {label}
                        </Link>
                    );
                })}
            </nav>

            {/* Logout */}
            <div className="p-4 border-t">
                <button
                    onClick={() => signOut({ callbackUrl: "/login" })}
                    className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium text-red-500 hover:bg-red-50 w-full transition-colors"
                >
                    <LogOut size={18} />
                    Sign Out
                </button>
            </div>
        </aside>
    );
}
