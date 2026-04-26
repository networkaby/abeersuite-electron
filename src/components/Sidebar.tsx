"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import axios from "axios";
import { Settings, ChevronDown, LogOut, ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import NotificationBell from "@/components/NotificationBell";
import { useQuickTicketStore } from "@/store/quickTicketStore";
import {
    WORKSPACE_NAV,
    MODULE_SECTIONS,
    SETTINGS_NAV,
    type ModuleChild,
} from "@/utils/constants";

type SidebarUser = {
    name?: string | null;
    role?: string | null;
    roles?: string[] | null;
    permissions?: string[] | null;
};

type Pipeline = { id: string; isDefault: boolean; isActive: boolean };

export default function Sidebar({ user }: { user?: SidebarUser }) {
    const pathname = usePathname();
    const permissions = user?.permissions ?? [];
    const userRoles = user?.roles ?? (user?.role ? [user.role] : []);
    const isAdmin = permissions.includes("admin:bypass");
    const { setOpen: openQuickTicket, setInitialPipelineId } = useQuickTicketStore();

    const [collapsed, setCollapsed] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(pathname.startsWith("/settings"));
    const [moduleOpen, setModuleOpen] = useState<Record<string, boolean>>({
        repair: pathname.startsWith("/tickets") || pathname.startsWith("/service-centers") || pathname.startsWith("/dashboard"),
        tally: false,
    });
    const [defaultPipeline, setDefaultPipeline] = useState<Pipeline | null>(null);

    useEffect(() => {
        axios
            .get<Pipeline[]>("/api/pipelines")
            .then((res) => {
                const def =
                    res.data.find((p) => p.isDefault && p.isActive) ??
                    res.data.find((p) => p.isActive) ??
                    null;
                setDefaultPipeline(def);
            })
            .catch(() => {});
    }, []);

    const roleLabel =
        userRoles.length > 0 ? userRoles.join(" / ") : (user?.role ?? "");

    const linkClass = (href: string) => {
        const active = pathname.startsWith(href);
        return [
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
            active ? "bg-blue-50 text-blue-600" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
            collapsed ? "justify-center px-2" : "",
        ].join(" ");
    };

    const resolveHref = (child: ModuleChild): string | undefined => {
        if (!child.href) return undefined;
        if (child.pipelineRef === "default" && defaultPipeline) {
            return `${child.href}?pipeline=${defaultPipeline.id}`;
        }
        return child.href;
    };

    const handleChildAction = (child: ModuleChild) => {
        if (child.disabled || !defaultPipeline) return;
        if (child.action === "new-ticket" && child.pipelineRef === "default") {
            setInitialPipelineId(defaultPipeline.id);
            openQuickTicket(true);
        }
    };

    const canViewChild = (child: ModuleChild) =>
        !child.permission || isAdmin || permissions.includes(child.permission);

    const visibleSettings = SETTINGS_NAV.filter(
        (item) => isAdmin || permissions.includes(item.permission)
    );

    return (
        <aside
            className={[
                collapsed ? "w-16" : "w-64",
                "relative flex min-h-screen flex-col border-r bg-white shadow-sm transition-all duration-300",
            ].join(" ")}
        >
            {/* Collapse toggle */}
            <button
                onClick={() => setCollapsed((c) => !c)}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                className="absolute -right-3 top-8 z-10 flex h-6 w-6 items-center justify-center rounded-full border bg-white shadow-sm text-gray-400 hover:text-blue-600 transition-colors"
            >
                {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
            </button>

            {/* Brand */}
            <div className={`border-b p-4 ${collapsed ? "px-3" : ""}`}>
                {collapsed ? (
                    <div className="flex justify-center">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white">
                            S
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                            <h1 className="truncate text-base font-bold text-blue-600">ServiceMgmt</h1>
                            <p className="mt-0.5 truncate text-xs font-medium text-gray-700">{user?.name}</p>
                            <p className="truncate text-xs text-gray-400">{roleLabel}</p>
                        </div>
                        <NotificationBell />
                    </div>
                )}
            </div>

            {/* Nav */}
            <nav className="flex-1 space-y-4 overflow-y-auto overflow-x-hidden p-2">

                {/* Workspace */}
                <section>
                    {!collapsed && (
                        <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                            Workspace
                        </p>
                    )}
                    <div className="space-y-0.5">
                        {WORKSPACE_NAV.filter(
                            (item) =>
                                item.permission === null ||
                                isAdmin ||
                                permissions.includes(item.permission ?? "")
                        ).map(({ label, href, icon: Icon }) => (
                            <Link
                                key={href}
                                href={href}
                                className={linkClass(href)}
                                title={collapsed ? label : ""}
                            >
                                <Icon size={17} className="shrink-0" />
                                {!collapsed && <span className="truncate">{label}</span>}
                            </Link>
                        ))}
                    </div>
                </section>

                {/* Modules */}
                <section>
                    {!collapsed && (
                        <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                            Modules
                        </p>
                    )}
                    <div className="space-y-0.5">
                        {MODULE_SECTIONS.map((mod) => {
                            const Icon = mod.icon;
                            const isOpen = moduleOpen[mod.key] ?? false;

                            return (
                                <div key={mod.key}>
                                    {collapsed ? (
                                        <button
                                            type="button"
                                            title={mod.label}
                                            className={[
                                                "flex w-full items-center justify-center rounded-lg px-2 py-2 transition-colors",
                                                mod.disabled
                                                    ? "cursor-not-allowed text-gray-300"
                                                    : "text-gray-500 hover:bg-gray-100",
                                            ].join(" ")}
                                        >
                                            <Icon size={17} />
                                        </button>
                                    ) : (
                                        <>
                                            <button
                                                type="button"
                                                disabled={mod.disabled}
                                                onClick={() =>
                                                    !mod.disabled &&
                                                    setModuleOpen((prev) => ({
                                                        ...prev,
                                                        [mod.key]: !prev[mod.key],
                                                    }))
                                                }
                                                className={[
                                                    "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
                                                    mod.disabled
                                                        ? "cursor-not-allowed text-gray-300"
                                                        : "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
                                                ].join(" ")}
                                            >
                                                <Icon size={17} className="shrink-0" />
                                                <span className="flex-1 truncate text-left">{mod.label}</span>
                                                {mod.disabled ? (
                                                    <Badge
                                                        variant="secondary"
                                                        className="h-4 px-1.5 text-[10px]"
                                                    >
                                                        Soon
                                                    </Badge>
                                                ) : (
                                                    <ChevronDown
                                                        size={13}
                                                        className={`shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                                                    />
                                                )}
                                            </button>

                                            {isOpen && (
                                                <div className="ml-3 mt-0.5 space-y-0.5 border-l border-gray-100 pl-3">
                                                    {mod.children
                                                        .filter(canViewChild)
                                                        .map((child) => {
                                                            const CIcon = child.icon;
                                                            const href = resolveHref(child);
                                                            const basePath = href?.split("?")[0] ?? "";
                                                            const isActiveChild =
                                                                !!basePath && pathname.startsWith(basePath);

                                                            if (child.action) {
                                                                return (
                                                                    <button
                                                                        key={child.label}
                                                                        type="button"
                                                                        disabled={child.disabled}
                                                                        onClick={() => handleChildAction(child)}
                                                                        className={[
                                                                            "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
                                                                            child.disabled
                                                                                ? "cursor-not-allowed text-gray-300"
                                                                                : "text-gray-600 hover:bg-gray-100",
                                                                        ].join(" ")}
                                                                    >
                                                                        <CIcon size={15} className="shrink-0" />
                                                                        <span className="truncate">{child.label}</span>
                                                                        {child.disabled && (
                                                                            <Badge
                                                                                variant="secondary"
                                                                                className="h-4 px-1 text-[10px]"
                                                                            >
                                                                                Soon
                                                                            </Badge>
                                                                        )}
                                                                    </button>
                                                                );
                                                            }

                                                            return href ? (
                                                                <Link
                                                                    key={child.label}
                                                                    href={href}
                                                                    className={[
                                                                        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
                                                                        isActiveChild
                                                                            ? "bg-blue-50 text-blue-600"
                                                                            : "text-gray-600 hover:bg-gray-100",
                                                                        child.disabled
                                                                            ? "pointer-events-none opacity-40"
                                                                            : "",
                                                                    ].join(" ")}
                                                                >
                                                                    <CIcon size={15} className="shrink-0" />
                                                                    <span className="truncate">{child.label}</span>
                                                                    {child.disabled && (
                                                                        <Badge
                                                                            variant="secondary"
                                                                            className="h-4 px-1 text-[10px]"
                                                                        >
                                                                            Soon
                                                                        </Badge>
                                                                    )}
                                                                </Link>
                                                            ) : null;
                                                        })}
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </section>

                {/* Settings */}
                {visibleSettings.length > 0 && (
                    <section>
                        <button
                            onClick={() => !collapsed && setSettingsOpen((o) => !o)}
                            className={linkClass("/settings")}
                            title={collapsed ? "Settings" : ""}
                        >
                            <Settings size={17} className="shrink-0" />
                            {!collapsed && (
                                <>
                                    <span className="flex-1 truncate text-left">Settings</span>
                                    <ChevronDown
                                        size={13}
                                        className={`shrink-0 transition-transform duration-200 ${settingsOpen ? "rotate-180" : ""}`}
                                    />
                                </>
                            )}
                        </button>

                        {settingsOpen && !collapsed && (
                            <div className="ml-3 mt-0.5 space-y-0.5 border-l border-gray-100 pl-3">
                                {visibleSettings.map(({ label, href, icon: Icon }) => (
                                    <Link key={href} href={href} className={linkClass(href)}>
                                        <Icon size={15} className="shrink-0" />
                                        <span className="truncate">{label}</span>
                                    </Link>
                                ))}
                            </div>
                        )}
                    </section>
                )}
            </nav>

            {/* Sign out */}
            <div className="border-t p-2">
                <button
                    onClick={() => signOut({ callbackUrl: "/login" })}
                    title={collapsed ? "Sign Out" : ""}
                    className={[
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-red-500 transition-all duration-150 hover:bg-red-50",
                        collapsed ? "justify-center px-2" : "",
                    ].join(" ")}
                >
                    <LogOut size={17} className="shrink-0" />
                    {!collapsed && <span className="truncate">Sign Out</span>}
                </button>
            </div>
        </aside>
    );
}
