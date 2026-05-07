"use client";

import { useState, useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useTheme } from "@/modules/shared/components/ThemeProvider";
import axios from "axios";
import {
    Settings, ChevronDown, LogOut,
    ChevronLeft, ChevronRight, Sun, Moon, ShieldCheck, Bell,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import NotificationBell from "@/modules/message/components/NotificationBell";
import UserAvatar from "@/modules/shared/components/UserAvatar";
import { useQuickTicketStore } from "@/store/quickTicketStore";
import {
    WORKSPACE_NAV,
    MODULE_SECTIONS,
    ADMIN_NAV,
    SETTINGS_NAV,
    type ModuleChild,
    type NavItem,
} from "@/utils/constants";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

type SidebarUser = {
    id?: string | null;
    name?: string | null;
    role?: string | null;
    roles?: string[] | null;
    permissions?: string[] | null;
    roleLabel?: string | null;
    roleColor?: string | null;
    avatarUrl?: string | null;
};

type Pipeline = { id: string; isDefault: boolean; isActive: boolean };

type InboxRoom = { unreadCount: number };

export default function Sidebar({ user }: { user?: SidebarUser }) {
    const pathname = usePathname();
    const { resolvedTheme, setTheme } = useTheme();
    const permissions = user?.permissions ?? [];
    const isAdmin = permissions.includes("admin:bypass");
    const { setOpen: openQuickTicket, setInitialPipelineId } = useQuickTicketStore();

    const [collapsed, setCollapsed] = useState(false);
    const [liveAvatar, setLiveAvatar] = useState<string | null | undefined>(undefined);
    const [adminOpen, setAdminOpen] = useState(
        pathname.startsWith("/office/users") || pathname.startsWith("/office/roles") || pathname.startsWith("/office/org-chart") || pathname.startsWith("/office/branches") || pathname.startsWith("/office/departments") || pathname.startsWith("/office/posts")
    );
    const [settingsOpen, setSettingsOpen] = useState(pathname.startsWith("/office/settings"));
    const [workspaceOpen, setWorkspaceOpen] = useState<Record<string, boolean>>({
        customers: pathname.startsWith("/office/customers") || pathname.startsWith("/office/customers/companies"),
    });
    const [inboxRooms, setInboxRooms] = useState<InboxRoom[]>([]);
    const [moduleOpen, setModuleOpen] = useState<Record<string, boolean>>({
        customers:
            pathname.startsWith("/office/customers") ||
            pathname.startsWith("/office/customers/companies") ||
            pathname.startsWith("/office/all"),
        repair:
            pathname.startsWith("/office/repairing/tickets") ||
            pathname.startsWith("/office/repairing/service-centers") ||
            pathname.startsWith("/office/repairing"),
        crm: pathname.startsWith("/office/crm"),
        "e-commerce": pathname.startsWith("/office/ecommerce"),
        tally: pathname.startsWith("/office/finance"),
        inventory: pathname.startsWith("/office/inventory"),
        hrm: pathname.startsWith("/office/hrm"),
        delivery: pathname.startsWith("/office/delivery"),
        "field-service": pathname.startsWith("/office/field-service"),
        helpdesk: pathname.startsWith("/office/helpdesk"),
        projects: pathname.startsWith("/office/projects"),
        intelligence: pathname.startsWith("/office/intelligence"),
        administration: pathname.startsWith("/office/administration"),
        retention: pathname.startsWith("/office/retention"),
        "pricing-strategy": pathname.startsWith("/office/pricing-strategy"),
    });
    const [nestedChildOpen, setNestedChildOpen] = useState<Record<string, boolean>>({});
    const [defaultPipeline, setDefaultPipeline] = useState<Pipeline | null>(null);

    // Fetch live avatarUrl so it reflects changes without re-login
    useEffect(() => {
        if (!user?.id) return;
        axios
            .get<{ avatarUrl: string | null }>(`/api/users/${user.id}`)
            .then(r => setLiveAvatar(r.data.avatarUrl))
            .catch(() => { /* keep session fallback */ });
    }, [user?.id]);

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
            .catch(() => { });
    }, []);

    useEffect(() => {
        axios
            .get<InboxRoom[]>("/api/inbox/rooms")
            .then((res) => setInboxRooms(res.data))
            .catch(() => { });
    }, []);

    // Re-fetch inbox rooms whenever GlobalInboxListener signals a new message
    useEffect(() => {
        const handler = () => {
            axios
                .get<InboxRoom[]>("/api/inbox/rooms")
                .then((res) => setInboxRooms(res.data))
                .catch(() => { });
        };
        window.addEventListener("inbox:unread", handler);
        return () => window.removeEventListener("inbox:unread", handler);
    }, []);

    const totalInboxUnread = inboxRooms.reduce((sum, r) => sum + r.unreadCount, 0);


    const linkClass = (href: string) => {
        const active = pathname.startsWith(href);
        return [
            "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
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

    const isModuleChildActive = (childHref: string, siblings: ModuleChild[]) => {
        if (!pathname.startsWith(childHref)) return false;
        // Prevent broad routes like "/office/customers" from also matching "/office/customers/all".
        const hasMoreSpecificSiblingMatch = siblings.some((sibling) => {
            if (!sibling.href || sibling.href === childHref) return false;
            return sibling.href.startsWith(`${childHref}/`) && pathname.startsWith(sibling.href);
        });
        return !hasMoreSpecificSiblingMatch;
    };

    const canViewChild = (child: ModuleChild) =>
        !child.permission || isAdmin || permissions.includes(child.permission);

    const hasActiveDescendant = (items: ModuleChild[]): boolean =>
        items.some((item) => {
            const href = resolveHref(item);
            const basePath = href?.split("?")[0] ?? "";
            if (basePath && pathname.startsWith(basePath)) return true;
            if (!item.children?.length) return false;
            return hasActiveDescendant(item.children.filter(canViewChild));
        });

    const renderModuleChildren = (items: ModuleChild[], depth = 0, parentKey = "root"): ReactNode =>
        items
            .filter(canViewChild)
            .map((child, index) => {
                const CIcon = child.icon;
                const href = resolveHref(child);
                const basePath = href?.split("?")[0] ?? "";
                const isActiveChild = !!basePath && isModuleChildActive(basePath, items);
                const visibleSubChildren = (child.children ?? []).filter(canViewChild);
                const hasSubChildren = visibleSubChildren.length > 0;
                const nodeKey = `${parentKey}-${depth}-${index}-${child.label}`;
                const isOpen = nestedChildOpen[nodeKey] ?? hasActiveDescendant(visibleSubChildren);

                if (child.action) {
                    return (
                        <div key={`${depth}-${child.label}-action`} className="space-y-0.5">
                            <Button
                                type="button"
                                variant="ghost"
                                disabled={child.disabled}
                                onClick={() => handleChildAction(child)}
                                className={[
                                    "h-auto w-full items-center justify-start gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
                                    child.disabled
                                        ? "cursor-not-allowed text-muted-foreground/30"
                                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                                ].join(" ")}
                            >
                                <CIcon size={15} className="shrink-0" />
                                <span className="truncate">{child.label}</span>
                                {hasSubChildren && (
                                    <ChevronDown
                                        size={13}
                                        className={`ml-auto shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                                    />
                                )}
                                {child.disabled && (
                                    <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                                        Soon
                                    </Badge>
                                )}
                            </Button>

                            {hasSubChildren && isOpen && (
                                <div className="ml-3 space-y-0.5 border-l border-border pl-3">
                                    {renderModuleChildren(visibleSubChildren, depth + 1, nodeKey)}
                                </div>
                            )}
                        </div>
                    );
                }

                return (
                    <div key={`${depth}-${child.label}-${child.href ?? "group"}`} className="space-y-0.5">
                        {href ? (
                            <div className="flex w-full items-stretch gap-0.5">
                                <Link
                                    href={href}
                                    className={[
                                        "flex flex-1 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
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
                                {hasSubChildren && (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label={isOpen ? `Collapse ${child.label}` : `Expand ${child.label}`}
                                        onClick={() =>
                                            setNestedChildOpen((prev) => ({
                                                ...prev,
                                                [nodeKey]: !(prev[nodeKey] ?? hasActiveDescendant(visibleSubChildren)),
                                            }))
                                        }
                                        className="h-auto shrink-0 rounded-lg px-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                                    >
                                        <ChevronDown
                                            size={13}
                                            className={`transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                                        />
                                    </Button>
                                )}
                            </div>
                        ) : (
                            <div className="flex w-full items-stretch gap-0.5">
                                <div
                                    className={[
                                        "flex flex-1 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium",
                                        child.disabled
                                            ? "cursor-not-allowed text-muted-foreground/30"
                                            : "text-muted-foreground",
                                    ].join(" ")}
                                >
                                    <CIcon size={15} className="shrink-0" />
                                    <span className="truncate">{child.label}</span>
                                </div>
                                {hasSubChildren && (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label={isOpen ? `Collapse ${child.label}` : `Expand ${child.label}`}
                                        onClick={() =>
                                            setNestedChildOpen((prev) => ({
                                                ...prev,
                                                [nodeKey]: !(prev[nodeKey] ?? hasActiveDescendant(visibleSubChildren)),
                                            }))
                                        }
                                        className="h-auto shrink-0 rounded-lg px-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                                    >
                                        <ChevronDown
                                            size={13}
                                            className={`transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                                        />
                                    </Button>
                                )}
                            </div>
                        )}

                        {hasSubChildren && isOpen && (
                            <div className="ml-3 space-y-0.5 border-l border-border pl-3">
                                {renderModuleChildren(visibleSubChildren, depth + 1, nodeKey)}
                            </div>
                        )}
                    </div>
                );
            });

    const visibleAdmin = ADMIN_NAV.filter(
        (item) => isAdmin || permissions.includes(item.permission)
    );

    const visibleSettings = SETTINGS_NAV.filter(
        (item) => isAdmin || permissions.includes(item.permission)
    );

    const canViewNavItem = (item: NavItem) =>
        item.permission === null || !item.permission || isAdmin || permissions.includes(item.permission);

    const isWorkspaceChildActive = (childHref: string, siblings: NavItem[]) => {
        if (!pathname.startsWith(childHref)) return false;
        // Prevent broad routes like "/office/customers" from also matching "/office/customers/all".
        const hasMoreSpecificSiblingMatch = siblings.some(
            (sibling) => sibling.href !== childHref && sibling.href.startsWith(`${childHref}/`) && pathname.startsWith(sibling.href)
        );
        return !hasMoreSpecificSiblingMatch;
    };

    return (
        <aside
            className={[
                collapsed ? "w-16" : "w-64",
                "relative flex h-screen flex-col border-r border-border bg-sidebar transition-all duration-300 shrink-0",
            ].join(" ")}
        >
            {/* Collapse toggle */}
            <Button
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={() => setCollapsed((c) => !c)}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                className="absolute -right-3 top-8 z-10 rounded-full text-muted-foreground shadow-sm hover:text-foreground"
            >
                {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
            </Button>

            {/* Brand */}
            <div className={`border-b border-border p-4 ${collapsed ? "px-3" : ""}`}>
                {collapsed ? (
                    <div className="flex flex-col items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
                            S
                        </div>
                        {user?.name && (
                            <Link href={user.id ? `/office/users/${user.id}` : "/office/users"}>
                                <UserAvatar
                                    avatarUrl={liveAvatar !== undefined ? liveAvatar : user.avatarUrl}
                                    name={user.name}
                                    role={user.role}
                                    sizePx={28}
                                />
                            </Link>
                        )}
                    </div>
                ) : (
                    <div className="space-y-2.5">
                        <h1 className="truncate text-base font-bold text-primary">ServiceMgmt</h1>
                        <Link
                            href={user?.id ? `/office/users/${user.id}` : "/office/users"}
                            className="group flex items-center gap-2.5 rounded-lg px-1 py-1 -mx-1 transition-colors hover:bg-muted"
                        >
                            <UserAvatar
                                avatarUrl={liveAvatar !== undefined ? liveAvatar : user?.avatarUrl}
                                name={user?.name ?? "?"}
                                role={user?.role}
                                sizePx={32}
                                className="shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                                <p className="truncate text-sm font-semibold text-foreground group-hover:text-primary transition-colors leading-tight">
                                    {user?.name ?? ""}
                                </p>
                                {user?.roleLabel && (
                                    <Badge className={`mt-0.5 h-4 px-1.5 text-[10px] ${user.roleColor ?? ""}`}>
                                        {user.roleLabel}
                                    </Badge>
                                )}
                            </div>
                            <NotificationBell />
                        </Link>
                    </div>
                )}
            </div>



            {/* Nav */}
            <ScrollArea className="flex-1 overflow-hidden">
                <div className="space-y-4 p-2">

                    {/* <nav className="flex-1 space-y-4 overflow-y-auto overflow-x-hidden p-2"> */}

                    {/* Inbox */}
                    <section>
                        <Link href="/office/inbox" className={linkClass("/office/inbox")} title={collapsed ? "Inbox" : ""}>
                            <Bell size={17} className="shrink-0" />
                            {!collapsed && (
                                <>
                                    <span className="flex-1 truncate">Inbox</span>
                                    {totalInboxUnread > 0 && (
                                        <span className="bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground leading-none">
                                            {totalInboxUnread}
                                        </span>
                                    )}
                                </>
                            )}
                        </Link>
                    </section>

                    {/* Workspace */}
                    <section>
                        {!collapsed && (
                            <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                                Workspace
                            </p>
                        )}
                        <div className="space-y-0.5">
                            {WORKSPACE_NAV.filter(canViewNavItem).map((item) => {
                                const Icon = item.icon;
                                const hasChildren = !!item.children?.length;
                                const visibleChildren = item.children?.filter(canViewNavItem) ?? [];
                                const isOpen = workspaceOpen[item.label.toLowerCase()] ?? false;
                                const hasActiveChild = visibleChildren.some((child) => isWorkspaceChildActive(child.href, visibleChildren));
                                const isActiveParent = pathname.startsWith(item.href) || hasActiveChild;

                                if (!hasChildren || visibleChildren.length === 0 || collapsed) {
                                    return (
                                        <Link
                                            key={item.href}
                                            href={item.href}
                                            className={linkClass(item.href)}
                                            title={collapsed ? item.label : ""}
                                        >
                                            <Icon size={17} className="shrink-0" />
                                            {!collapsed && <span className="truncate">{item.label}</span>}
                                        </Link>
                                    );
                                }

                                return (
                                    <div key={item.href}>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            onClick={() =>
                                                setWorkspaceOpen((prev) => ({
                                                    ...prev,
                                                    [item.label.toLowerCase()]: !prev[item.label.toLowerCase()],
                                                }))
                                            }
                                            className={[
                                                "h-auto w-full items-center justify-start gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
                                                isActiveParent
                                                    ? "bg-primary text-primary-foreground"
                                                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                                            ].join(" ")}
                                        >
                                            <Icon size={17} className="shrink-0" />
                                            <span className="flex-1 truncate text-left">{item.label}</span>
                                            <ChevronDown
                                                size={13}
                                                className={`shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                                            />
                                        </Button>

                                        {isOpen && (
                                            <div className="ml-3 mt-0.5 space-y-0.5 border-l border-border pl-3">
                                                {visibleChildren.map((child) => {
                                                    return (
                                                        <Link
                                                            key={`${item.href}-${child.href}`}
                                                            href={child.href}
                                                            className={[
                                                                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
                                                                isWorkspaceChildActive(child.href, visibleChildren)
                                                                    ? "bg-primary text-primary-foreground"
                                                                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                                                            ].join(" ")}
                                                        >
                                                            <child.icon size={15} className="shrink-0" />
                                                            <span className="truncate">{child.label}</span>
                                                        </Link>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
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
                            {MODULE_SECTIONS.filter((mod) => !mod.permission || isAdmin || permissions.includes(mod.permission)).map((mod) => {
                                const Icon = mod.icon;
                                const isOpen = moduleOpen[mod.key] ?? false;

                                return (
                                    <div key={mod.key}>
                                        {collapsed ? (
                                            mod.disabled || !mod.dashboardHref ? (
                                                <div
                                                    title={mod.label}
                                                    className={[
                                                        "flex h-auto w-full items-center justify-center rounded-lg px-2 py-2 transition-colors",
                                                        mod.disabled
                                                            ? "cursor-not-allowed text-muted-foreground/30"
                                                            : "text-muted-foreground",
                                                    ].join(" ")}
                                                >
                                                    <Icon size={17} />
                                                </div>
                                            ) : (
                                                <Link
                                                    href={mod.dashboardHref}
                                                    title={mod.label}
                                                    className={[
                                                        "flex h-auto w-full items-center justify-center rounded-lg px-2 py-2 transition-colors",
                                                        pathname.startsWith(mod.dashboardHref)
                                                            ? "bg-primary text-primary-foreground"
                                                            : "text-muted-foreground hover:bg-muted",
                                                    ].join(" ")}
                                                >
                                                    <Icon size={17} />
                                                </Link>
                                            )
                                        ) : (
                                            <>
                                                {mod.disabled || !mod.dashboardHref ? (
                                                    <div
                                                        className={[
                                                            "flex h-auto w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium",
                                                            mod.disabled
                                                                ? "cursor-not-allowed text-muted-foreground/30"
                                                                : "text-muted-foreground",
                                                        ].join(" ")}
                                                    >
                                                        <Icon size={17} className="shrink-0" />
                                                        <span className="flex-1 truncate text-left">{mod.label}</span>
                                                        {mod.disabled && (
                                                            <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                                                                Soon
                                                            </Badge>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <div className="flex w-full items-stretch gap-0.5">
                                                        <Link
                                                            href={mod.dashboardHref}
                                                            onClick={() =>
                                                                setModuleOpen((prev) => ({
                                                                    ...prev,
                                                                    [mod.key]: true,
                                                                }))
                                                            }
                                                            className={[
                                                                "flex h-auto flex-1 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
                                                                pathname.startsWith(mod.dashboardHref)
                                                                    ? "bg-primary text-primary-foreground"
                                                                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                                                            ].join(" ")}
                                                        >
                                                            <Icon size={17} className="shrink-0" />
                                                            <span className="flex-1 truncate text-left">{mod.label}</span>
                                                        </Link>
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon-sm"
                                                            aria-label={isOpen ? `Collapse ${mod.label}` : `Expand ${mod.label}`}
                                                            onClick={() =>
                                                                setModuleOpen((prev) => ({
                                                                    ...prev,
                                                                    [mod.key]: !prev[mod.key],
                                                                }))
                                                            }
                                                            className="h-auto shrink-0 rounded-lg px-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                                                        >
                                                            <ChevronDown
                                                                size={13}
                                                                className={`transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                                                            />
                                                        </Button>
                                                    </div>
                                                )}

                                                {isOpen && (
                                                    <div className="ml-3 mt-0.5 space-y-0.5 border-l border-border pl-3">
                                                        {renderModuleChildren(mod.children)}
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                    <section>
                        <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                            Admin Only
                        </p>
                        <div className="space-y-0.5">
                            {/* Admin */}
                            {visibleAdmin.length > 0 && (
                                <section>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        onClick={() => !collapsed && setAdminOpen((o) => !o)}
                                        className={linkClass("/office/users")}
                                        title={collapsed ? "Admin" : ""}
                                    >
                                        <ShieldCheck size={17} className="shrink-0" />
                                        {!collapsed && (
                                            <>
                                                <span className="flex-1 truncate text-left">Admin</span>
                                                <ChevronDown
                                                    size={13}
                                                    className={`shrink-0 transition-transform duration-200 ${adminOpen ? "rotate-180" : ""}`}
                                                />
                                            </>
                                        )}
                                    </Button>

                                    {adminOpen && !collapsed && (
                                        <div className="ml-3 mt-0.5 space-y-0.5 border-l border-border pl-3">
                                            {visibleAdmin.map(({ label, href, icon: Icon }) => (
                                                <Link key={href} href={href} className={linkClass(href)}>
                                                    <Icon size={15} className="shrink-0" />
                                                    <span className="truncate">{label}</span>
                                                </Link>
                                            ))}
                                        </div>
                                    )}
                                </section>
                            )}

                            {/* Settings */}
                            {visibleSettings.length > 0 && (
                                <section>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        onClick={() => !collapsed && setSettingsOpen((o) => !o)}
                                        className={linkClass("/office/settings")}
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
                                    </Button>

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
                        </div>
                    </section>
                    {/* </nav> */}

                </div>
                <ScrollBar orientation="vertical" />
            </ScrollArea>




            {/* Bottom — theme toggle + sign out */}
            <div className="border-t border-border p-2 space-y-1">
                {/* Theme toggle */}
                <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
                    title={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                    className={[
                        "h-auto w-full items-center justify-start gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-all duration-150 hover:bg-muted hover:text-foreground",
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
                </Button>

                {/* Sign out */}
                <Button
                    type="button"
                    variant="ghost"
                    onClick={() => signOut({ callbackUrl: "/staff/login" })}
                    title={collapsed ? "Sign Out" : ""}
                    className={[
                        "h-auto w-full items-center justify-start gap-3 rounded-lg px-3 py-2 text-sm font-medium text-destructive transition-all duration-150 hover:bg-destructive/10",
                        collapsed ? "justify-center px-2" : "",
                    ].join(" ")}
                >
                    <LogOut size={17} className="shrink-0" />
                    {!collapsed && <span className="truncate">Sign Out</span>}
                </Button>
            </div>

        </aside>
    );
}
