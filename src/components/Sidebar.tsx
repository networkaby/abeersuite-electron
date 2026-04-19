"use client";

import { useState } from "react";
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
    ListTodo,
    ChevronDown,
    LogOut,
    ChevronLeft,
    ClipboardList,
} from "lucide-react";
import NotificationBell from "@/components/NotificationBell";

type SidebarUser = {
    name?: string | null;
    role?: string | null;
    roles?: string[] | null;
};

const MAIN_NAV = [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: null },
    { label: "Customers", href: "/customers", icon: Users, roles: null },
    { label: "Tickets", href: "/tickets", icon: Ticket, roles: null },
    { label: "Tasks", href: "/tasks", icon: ListTodo, roles: null },
    { label: "Assignments", href: "/assignments", icon: ClipboardList, roles: null },
    { label: "Service Centres", href: "/service-centers", icon: Building2, roles: ["R1", "R2"] },
    { label: "Users", href: "/users", icon: UserCog, roles: ["R1"] },
] as const;

const SETTINGS_NAV = [
    { label: "Statuses", href: "/settings/statuses", icon: Settings },
    { label: "Sub-Statuses", href: "/settings/sub-statuses", icon: Settings },
    { label: "Roles", href: "/settings/roles", icon: ShieldCheck },
] as const;

export default function Sidebar({ user }: { user?: SidebarUser }) {
    const pathname = usePathname();
    const userRoles = user?.roles ?? (user?.role ? [user.role] : []);
    const primaryRole = user?.role ?? "";
    const isAdmin = userRoles.includes("R1");

    const [collapsed, setCollapsed] = useState(false);
    // Auto-open settings section if currently on a settings page
    const [settingsOpen, setSettingsOpen] = useState(pathname.startsWith("/settings"));

    const visibleMain = MAIN_NAV.filter(
        (item) => item.roles === null || item.roles.some((r) => userRoles.includes(r))
    );

    const roleLabel = userRoles.length > 0 ? userRoles.join(" / ") : primaryRole;

    const linkClass = (href: string) =>
        `flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${pathname.startsWith(href)
            ? "bg-blue-50 text-blue-600"
            : "text-gray-600 hover:bg-gray-100"
        } ${collapsed ? "justify-center px-2" : ""}`;

    return (
        <aside className={`${collapsed ? "w-20" : "w-64"} bg-white shadow-md flex flex-col min-h-screen transition-all duration-300 relative`}>
            {/* Collapse Toggle */}
            <button
                onClick={() => setCollapsed(!collapsed)}
                className="absolute -right-3 top-10 bg-white border shadow-sm rounded-full p-1 text-gray-400 hover:text-blue-600 z-10"
            >
                <ChevronLeft size={16} className={`transition-transform duration-300 ${collapsed ? "rotate-180" : ""}`} />
            </button>

            {/* Logo */}
            <div className={`p-5 border-b overflow-hidden ${collapsed ? "px-2" : ""}`}>
                <div className="flex items-center justify-between">
                    {!collapsed && <h1 className="text-lg font-bold text-blue-600 truncate">ServiceMgmt</h1>}
                    {collapsed && <div className="w-full flex justify-center"><div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold">S</div></div>}
                    {!collapsed && <NotificationBell />}
                </div>
                {!collapsed && (
                    <>
                        <p className="text-xs text-gray-600 font-medium mt-1 truncate">{user?.name}</p>
                        <p className="text-xs text-gray-400 truncate">{roleLabel}</p>
                    </>
                )}
            </div>

            {/* Nav */}
            <nav className="flex-1 p-3 space-y-0.5 overflow-hidden">
                {visibleMain.map(({ label, href, icon: Icon }) => (
                    <Link key={href} href={href} className={linkClass(href)} title={collapsed ? label : ""}>
                        <Icon size={18} className="shrink-0" />
                        {!collapsed && <span className="truncate">{label}</span>}
                    </Link>
                ))}

                {/* Settings collapsible — admin only */}
                {isAdmin && (
                    <div className="pt-1">
                        <button
                            onClick={() => !collapsed && setSettingsOpen(o => !o)}
                            className={linkClass("/settings")}
                            title={collapsed ? "Settings" : ""}
                        >
                            <Settings size={18} className="shrink-0" />
                            {!collapsed && (
                                <>
                                    <span className="flex-1 text-left truncate">Settings</span>
                                    <ChevronDown
                                        size={14}
                                        className={`transition-transform ${settingsOpen ? "rotate-180" : ""}`}
                                    />
                                </>
                            )}
                        </button>

                        {settingsOpen && !collapsed && (
                            <div className="ml-4 mt-0.5 space-y-0.5 border-l border-gray-100 pl-3">
                                {SETTINGS_NAV.map(({ label, href, icon: Icon }) => (
                                    <Link key={href} href={href} className={linkClass(href)}>
                                        <Icon size={16} className="shrink-0" />
                                        <span className="truncate">{label}</span>
                                    </Link>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </nav>

            {/* Logout */}
            <div className={`p-3 border-t overflow-hidden ${collapsed ? "px-2" : ""}`}>
                <button
                    onClick={() => signOut({ callbackUrl: "/login" })}
                    className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium text-red-500 hover:bg-red-50 w-full transition-all duration-200 ${collapsed ? "justify-center px-2" : ""}`}
                    title={collapsed ? "Sign Out" : ""}
                >
                    <LogOut size={18} className="shrink-0" />
                    {!collapsed && <span className="truncate">Sign Out</span>}
                </button>
            </div>
        </aside>
    );
}
