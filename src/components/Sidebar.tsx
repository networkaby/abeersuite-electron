"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import axios from "axios";
import {
    LayoutDashboard,
    Users,
    Ticket,
    Building2,
    UserCog,
    Settings,
    ShieldCheck,
    ChevronDown,
    LogOut,
    ChevronLeft,
    ClipboardList,
    Layers,
    GitBranch,
} from "lucide-react";
import NotificationBell from "@/components/NotificationBell";

type SidebarUser = {
    name?: string | null;
    role?: string | null;
    roles?: string[] | null;
    permissions?: string[] | null;
};

type Pipeline = { id: string; label: string; color: string; isActive: boolean };

const GLOBAL_NAV = [
    { label: "My Assignments", href: "/assignments", icon: ClipboardList, permission: null },
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, permission: null },
    { label: "Customers", href: "/customers", icon: Users, permission: null },
    { label: "Service Centres", href: "/service-centers", icon: Building2, permission: "warranty:convert" },
    { label: "Users", href: "/users", icon: UserCog, permission: "users:manage" },
] as const;

const SETTINGS_NAV = [
    { label: "Statuses", href: "/settings/statuses", icon: Settings, permission: "settings:statuses" },
    { label: "Sub-Statuses", href: "/settings/sub-statuses", icon: Settings, permission: "settings:statuses" },
    { label: "Pipelines", href: "/settings/pipelines", icon: GitBranch, permission: "settings:statuses" },
    { label: "Roles", href: "/settings/roles", icon: ShieldCheck, permission: "roles:manage" },
] as const;

function colorDot(color: string) {
    return color.split(" ")[0];
}

export default function Sidebar({ user }: { user?: SidebarUser }) {
    const pathname = usePathname();
    const userRoles = user?.roles ?? (user?.role ? [user.role] : []);
    const permissions = user?.permissions ?? [];
    const primaryRole = user?.role ?? "";
    const isAdmin = permissions.includes("admin:bypass");

    const [collapsed, setCollapsed] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(pathname.startsWith("/settings"));
    const [pipelines, setPipelines] = useState<Pipeline[]>([]);
    const [pipelineOpen, setPipelineOpen] = useState<Record<string, boolean>>({});

    useEffect(() => {
        axios.get<Pipeline[]>("/api/pipelines")
            .then((r) => {
                const active = r.data.filter((p) => p.isActive);
                setPipelines(active);
                // Auto-open the section whose tickets link matches current URL
                const initial: Record<string, boolean> = {};
                for (const p of active) {
                    initial[p.id] = pathname.startsWith("/tickets");
                }
                setPipelineOpen(initial);
            })
            .catch(() => { });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const visibleGlobal = GLOBAL_NAV.filter(
        (item) => item.permission === null || isAdmin || permissions.includes(item.permission)
    );

    const visibleSettings = SETTINGS_NAV.filter(
        (item) => isAdmin || permissions.includes(item.permission)
    );

    const roleLabel = userRoles.length > 0 ? userRoles.join(" / ") : primaryRole;

    const linkClass = (href: string, exact = false) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return `flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${active ? "bg-blue-50 text-blue-600" : "text-gray-600 hover:bg-gray-100"
            } ${collapsed ? "justify-center px-2" : ""}`;
    };

    const togglePipeline = (id: string) => {
        if (collapsed) return;
        setPipelineOpen((prev) => ({ ...prev, [id]: !prev[id] }));
    };

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
            <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto overflow-x-hidden">

                {/* Global items */}
                {visibleGlobal.map(({ label, href, icon: Icon }) => (
                    <Link key={href} href={href} className={linkClass(href)} title={collapsed ? label : ""}>
                        <Icon size={18} className="shrink-0" />
                        {!collapsed && <span className="truncate">{label}</span>}
                    </Link>
                ))}

                {/* Pipeline sections */}
                {pipelines.length > 0 && (
                    <div className={`${collapsed ? "" : "pt-2"}`}>
                        {!collapsed && (
                            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-4 pb-1">
                                Modules
                            </p>
                        )}
                        {pipelines.map((p) => {
                            const dotClass = colorDot(p.color);
                            const isOpen = pipelineOpen[p.id] ?? false;
                            const ticketsHref = `/tickets?pipeline=${p.id}`;

                            return (
                                <div key={p.id}>
                                    {collapsed ? (
                                        <Link
                                            href={ticketsHref}
                                            className={linkClass("/tickets")}
                                            title={p.label}
                                        >
                                            <span className={`w-4 h-4 rounded-full shrink-0 ${dotClass}`} />
                                        </Link>
                                    ) : (
                                        <>
                                            <button
                                                onClick={() => togglePipeline(p.id)}
                                                className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 text-gray-600 hover:bg-gray-100 w-full"
                                            >
                                                <Layers size={18} className="shrink-0" />
                                                <span className="flex-1 text-left truncate">{p.label}</span>
                                                <ChevronDown
                                                    size={14}
                                                    className={`transition-transform ${isOpen ? "rotate-180" : ""}`}
                                                />
                                            </button>
                                            {isOpen && (
                                                <div className="ml-4 mt-0.5 space-y-0.5 border-l border-gray-100 pl-3">

                                                    <Link
                                                        href={ticketsHref}
                                                        className={linkClass("/tickets")}
                                                    >
                                                        <Ticket size={16} className="shrink-0" />
                                                        <span className="truncate"> New Tickets</span>
                                                    </Link>


                                                    <Link
                                                        href={ticketsHref}
                                                        className={linkClass("/tickets")}
                                                    >
                                                        <Ticket size={16} className="shrink-0" />
                                                        <span className="truncate">Tickets</span>
                                                    </Link>



                                                </div>


                                            )}
                                        </>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Settings collapsible */}
                {visibleSettings.length > 0 && (
                    <div className="pt-1">
                        <button
                            onClick={() => !collapsed && setSettingsOpen((o) => !o)}
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
                                {visibleSettings.map(({ label, href, icon: Icon }) => (
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
