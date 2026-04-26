"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useTheme } from "next-themes";
import axios from "axios";
import {
    Settings, ChevronDown, LogOut,
    ChevronLeft, ChevronRight, Sun, Moon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
    const { resolvedTheme, setTheme } = useTheme();
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

    const roleLabel = userRoles.length > 0 ? userRoles.join(" / ") : (user?.role ?? "");

    const linkClass = (href: string) => {
        const active = pathname.startsWith(href);
        return [
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
            active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
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
                "relative flex min-h-screen flex-col border-r border-border bg-sidebar transition-all duration-300",
            ].join(" ")}
        >
            {/* Collapse toggle */}
            <button
                onClick={() => setCollapsed((c) => !c)}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                className="absolute -right-3 top-8 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card shadow-sm text-muted-foreground hover:text-foreground transition-colors"
            >
                {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
            </button>

            {/* Brand */}
            <div className={`border-b border-border p-4 ${collapsed ? "px-3" : ""}`}>
                {collapsed ? (
                    <div className="flex justify-center">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
                            S
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                            <h1 className="truncate text-base font-bold text-primary">ServiceMgmt</h1>
                            <p className="mt-0.5 truncate text-xs font-medium text-foreground">{user?.name}</p>
                            <p className="truncate text-xs text-muted-foreground">{roleLabel}</p>
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
                        <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
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
                        <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
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
                                                    ? "cursor-not-allowed text-muted-foreground/30"
                                                    : "text-muted-foreground hover:bg-muted",
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
                                                        ? "cursor-not-allowed text-muted-foreground/30"
                                                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                                                ].join(" ")}
                                            >
                                                <Icon size={17} className="shrink-0" />
                                                <span className="flex-1 truncate text-left">{mod.label}</span>
                                                {mod.disabled ? (
                                                    <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
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
                                                <div className="ml-3 mt-0.5 space-y-0.5 border-l border-border pl-3">
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
                                                                                ? "cursor-not-allowed text-muted-foreground/30"
                                                                                : "text-muted-foreground hover:bg-muted hover:text-foreground",
                                                                        ].join(" ")}
                                                                    >
                                                                        <CIcon size={15} className="shrink-0" />
                                                                        <span className="truncate">{child.label}</span>
                                                                        {child.disabled && (
                                                                            <Badge variant="secondary" className="h-4 px-1 text-[10px]">
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
                                                                            ? "bg-primary text-primary-foreground"
                                                                            : "text-muted-foreground hover:bg-muted hover:text-foreground",
                                                                        child.disabled ? "pointer-events-none opacity-40" : "",
                                                                    ].join(" ")}
                                                                >
                                                                    <CIcon size={15} className="shrink-0" />
                                                                    <span className="truncate">{child.label}</span>
                                                                    {child.disabled && (
                                                                        <Badge variant="secondary" className="h-4 px-1 text-[10px]">
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
                            <div className="ml-3 mt-0.5 space-y-0.5 border-l border-border pl-3">
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

            {/* Bottom — theme toggle + sign out */}
            <div className="border-t border-border p-2 space-y-1">
                {/* Theme toggle */}
                <button
                    onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
                    title={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                    className={[
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-all duration-150 hover:bg-muted hover:text-foreground",
                        collapsed ? "justify-center px-2" : "",
                    ].join(" ")}
                >
                    {resolvedTheme === "dark"
                        ? <Sun size={17} className="shrink-0" />
                        : <Moon size={17} className="shrink-0" />
                    }
                    {!collapsed && (
                        <span className="truncate">
                            {resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
                        </span>
                    )}
                </button>

                {/* Sign out */}
                <button
                    onClick={() => signOut({ callbackUrl: "/login" })}
                    title={collapsed ? "Sign Out" : ""}
                    className={[
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-destructive transition-all duration-150 hover:bg-destructive/10",
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
