"use client";

import { useState, useEffect, type CSSProperties, type ReactNode } from "react";
import { useResizable } from "@/shared/hooks/useResizable";
import { usePanelStore } from "@/store/panelStore";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutTo } from "@/shared/lib/auth/signOutTo";
import { captureMyDay } from "@/shared/lib/hr/myDay";
import { useTheme } from "@/shared/components/ThemeProvider";
import axios from "axios";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import {
    Settings, ChevronDown, LogOut,
    PanelLeftClose, PanelLeftOpen, Sun, Moon, ShieldCheck, RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import NotificationBell from "@/modules/message/components/NotificationBell";
import { useInboxUnread, useNavCounts, refreshNavCounts } from "@/shared/hooks/useNavCounts";
import { NAV_SURFACE, WORK_INBOX_SURFACE } from "@/shared/lib/nav/navSurfaces";
import { moduleActiveStyle, moduleColor, moduleIconStyle } from "@/shared/lib/format/moduleTheme";

/// The guide line down an expanded group's children.
///
/// It carries the module hue so an open group reads as one block rather than as
/// a run of indented rows — but held well back, because a twenty-child module
/// like Accountancy must look grouped, not like twenty coloured rows. The rail
/// is a `chrome-surface`, so the hue token resolved here is already the light
/// rail-tuned variant, not the page one.
const groupGuideStyle = (key?: string | null): CSSProperties => ({
    borderColor: `color-mix(in oklab, ${moduleColor(key)} 55%, transparent)`,
});

/// Top-level surfaces that own a module hue. Anything not listed falls back to
/// the theme primary — Inbox and Work Flow span every module, so no single
/// module colour would be honest for them.
const surfaceModule = (href: string): string | undefined =>
    href.startsWith("/vouchers/pos") ? "pos" : undefined;
import UserAvatar from "@/shared/components/UserAvatar";
import { LinkContextMenu, useLinkContextMenu } from "@/shared/components/LinkContextMenu";
import { useQuickTicketStore } from "@/store/quickTicketStore";
import {
    WORKSPACE_NAV,
    MODULE_SECTIONS,
    ADMIN_NAV,
    SETTINGS_NAV,
    type ModuleChild,
    type NavItem,
} from "@/utils/constants";
import { canViewModuleChild } from "@/utils/module-access";
import { sidebarLinkPermissionIdForLabel } from "@/shared/lib/auth/sidebarModules";
import { useIsDesktopApp } from "@/shared/lib/bridge";
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

// ── Count badges ──────────────────────────────────────────────────────────────
// `fresh` = new arrivals / unread (loud, primary). `total` = everything open there
// (quiet). Used by Workspace links and module sections alike.

function CountBadges({ fresh, total }: { fresh: number; total: number }) {
    return (
        <span className="flex shrink-0 items-center gap-1">
            {fresh > 0 && (
                <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold leading-none text-primary-foreground">
                    {fresh > 99 ? "99+" : fresh}
                </span>
            )}
            {total > 0 && (
                <span className="rounded bg-muted px-1.5 py-px text-[10px] font-medium leading-none text-muted-foreground/80">
                    {total > 99 ? "99+" : total}
                </span>
            )}
        </span>
    );
}

/** The collapsed rail has no room for numbers, so a dot just says "something new". */
function CountDot({ show }: { show: boolean }) {
    if (!show) return null;
    return <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-primary" aria-hidden />;
}

/** "3 new · 12 total" — the collapsed rail's tooltip, where the numbers can't show. */
function countTitle(fresh: number, total: number, noun: string) {
    return [fresh > 0 ? `${fresh} ${noun}` : null, total > 0 ? `${total} total` : null]
        .filter(Boolean)
        .join(" · ");
}

export default function Sidebar({ user }: { user?: SidebarUser }) {
    const pathname = usePathname();
    const { resolvedTheme, setTheme } = useTheme();
    const { menu: navMenu, close: closeNavMenu, onContainerContextMenu: onNavContextMenu } = useLinkContextMenu();
    const permissions = user?.permissions ?? [];
    const isAdmin = permissions.includes(PERMISSIONS.ADMIN_BYPASS);
    const { setOpen: openQuickTicket, setInitialPipelineId } = useQuickTicketStore();

    // Live counts, so someone working in another module sees new arrivals without
    // refreshing. ONE poll feeds every badge here and in NotificationBell; chat
    // unread still jumps instantly because the Supabase broadcast fires
    // "inbox:unread", which refreshes that same shared store.
    const inDesktopApp = useIsDesktopApp();

    const inboxUnread = useInboxUnread();
    const surfaceCount = useNavCounts();

    // Module section → which surface's count it shows. CRM's number is its Deals
    // board; the other three each own one board. Modules absent here get no badge.
    const MODULE_SURFACE: Record<string, string> = {
        repair: NAV_SURFACE.repair,
        crm: NAV_SURFACE.deals,
        help: NAV_SURFACE.help,
        administration: NAV_SURFACE.administration,
    };

    // `fresh` renders as a loud badge, `total` as a quiet number beside it; a link with
    // neither gets no badge. `noun` is only for the collapsed-mode tooltip.
    type Counts = { fresh: number; total: number; noun: string };
    const NO_COUNT: Counts = { fresh: 0, total: 0, noun: "" };

    const fromSurface = (surface: string, noun = "new"): Counts => {
        const c = surfaceCount(surface);
        return { fresh: c.new, total: c.all, noun };
    };

    const workspaceCounts = (href: string): Counts =>
        href === "/office/message/inbox" ? { fresh: inboxUnread, total: 0, noun: "unread" }
            : href === "/office/work-flow-inbox" ? fromSurface(WORK_INBOX_SURFACE)
                : NO_COUNT;

    const moduleCounts = (moduleKey: string): Counts => {
        const surface = MODULE_SURFACE[moduleKey];
        return surface ? fromSurface(surface) : NO_COUNT;
    };

    // usePanelStore's own `persist` middleware is the single source of truth for
    // sidebar mode (localStorage key "panel-store") — no separate bridge needed.
    const { sidebarMode, setSidebarMode } = usePanelStore();
    const collapsed = sidebarMode === "collapsed";
    const isHidden = sidebarMode === "hidden";

    const {
        width: sidebarWidth, isDragging: sidebarDragging,
        dragReady: sidebarDragReady,
        onMouseDown: onSidebarDragStart,
        onHandleMouseEnter: onSidebarHandleEnter,
        onHandleMouseLeave: onSidebarHandleLeave,
    } = useResizable({
        storageKey: "app:sidebar-width",
        defaultWidth: 256,
        minWidth: 180,
        maxWidth: 420,
        direction: "right",
    });
    const [liveAvatar, setLiveAvatar] = useState<string | null | undefined>(undefined);
    const [adminOpen, setAdminOpen] = useState(
        pathname.startsWith("/office/admin/users") || pathname.startsWith("/office/roles") || pathname.startsWith("/office/admin/org-chart") || pathname.startsWith("/office/admin/branches") || pathname.startsWith("/office/admin/departments") || pathname.startsWith("/office/admin/positions") || pathname.startsWith("/office/admin/counters")
    );
    const [settingsOpen, setSettingsOpen] = useState(pathname.startsWith("/office/settings"));
    const [workspaceOpen, setWorkspaceOpen] = useState<Record<string, boolean>>({
        customers: pathname.startsWith("/office/customers") || pathname.startsWith("/office/customers/companies"),
    });
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
        hr: pathname.startsWith("/office/hr"),
        delivery: pathname.startsWith("/office/roadmap/delivery"),
        "field-service": pathname.startsWith("/office/roadmap/field-service"),
        helpdesk: pathname.startsWith("/office/roadmap/helpdesk"),
        projects: pathname.startsWith("/office/roadmap/projects"),
        intelligence: pathname.startsWith("/office/roadmap/intelligence"),
        administration: pathname.startsWith("/office/roadmap/administration"),
        retention: pathname.startsWith("/office/customer-retention") || pathname.startsWith("/office/roadmap/retention"),
        "pricing-strategy": pathname.startsWith("/office/pricing-strategy"),
    });
    const [nestedChildOpen, setNestedChildOpen] = useState<Record<string, boolean>>({});
    const [defaultPipeline, setDefaultPipeline] = useState<Pipeline | null>(null);
    const [mounted, setMounted] = useState(false);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { setMounted(true); }, []);

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




    const linkClass = (href: string) => {
        const active = pathname.startsWith(href);
        return [
            "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
            active ? "" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            collapsed ? "justify-center px-2" : "",
        ].join(" ");
    };

    /// Top-level surfaces are not modules, so they take the theme primary
    /// (moduleColor falls back to it for an unknown key) except POS, Admin and
    /// Settings, which DO own a hue. Active → tinted pill + bar; resting → the
    /// glyph alone carries the colour.
    const navStyle = (href: string, modKey?: string) =>
        pathname.startsWith(href) ? moduleActiveStyle(modKey) : undefined;
    const navIconStyle = (href: string, modKey?: string) =>
        pathname.startsWith(href) ? undefined : moduleIconStyle(modKey);

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

    const canViewChild = (child: ModuleChild) => canViewModuleChild(child, permissions, isAdmin);

    const hasActiveDescendant = (items: ModuleChild[]): boolean =>
        items.some((item) => {
            const href = resolveHref(item);
            const basePath = href?.split("?")[0] ?? "";
            if (basePath && pathname.startsWith(basePath)) return true;
            if (!item.children?.length) return false;
            return hasActiveDescendant(item.children.filter(canViewChild));
        });

    const renderModuleChildren = (items: ModuleChild[], depth = 0, parentKey = "root", modKey = ""): ReactNode =>
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
                                        ? "cursor-not-allowed text-muted-foreground/65"
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
                                <div className="ml-3 space-y-0.5 border-l border-border pl-3" style={groupGuideStyle(modKey)}>
                                    {renderModuleChildren(visibleSubChildren, depth + 1, nodeKey, modKey)}
                                </div>
                            )}
                        </div>
                    );
                }

                return (
                    <div key={`${depth}-${child.label}-${child.href ?? "group"}`} className="space-y-0.5">
                        {href ? (
                            <div className="flex w-full items-stretch gap-0.5">
                                {child.newTab ? (
                                    <a
                                        href={href}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className={[
                                            "flex flex-1 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
                                            "text-muted-foreground hover:bg-muted hover:text-foreground",
                                            child.disabled ? "pointer-events-none opacity-40" : "",
                                        ].join(" ")}
                                    >
                                        <CIcon size={15} className="shrink-0" />
                                        <span className="truncate">{child.label}</span>
                                    </a>
                                ) : (
                                    <Link
                                        href={href}
                                        className={[
                                            "flex flex-1 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
                                            isActiveChild ? "" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                                            child.disabled ? "pointer-events-none opacity-40" : "",
                                        ].join(" ")}
                                        style={isActiveChild ? moduleActiveStyle(modKey) : undefined}
                                    >
                                        <CIcon size={15} className="shrink-0" style={isActiveChild ? undefined : moduleIconStyle(modKey)} />
                                        <span className="truncate">{child.label}</span>
                                        {child.disabled && (
                                            <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                                                Soon
                                            </Badge>
                                        )}
                                    </Link>
                                )}
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
                                            ? "cursor-not-allowed text-muted-foreground/65"
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
                            <div className="ml-3 space-y-0.5 border-l border-border pl-3" style={groupGuideStyle(modKey)}>
                                {renderModuleChildren(visibleSubChildren, depth + 1, nodeKey, modKey)}
                            </div>
                        )}
                    </div>
                );
            });

    // Authoritative sidebar visibility: the Role page's "Sidebar links" checkboxes
    // are the SINGLE source of truth for the nav. A link shows only if it is granted
    // (`ui:sidebar:*`) — and, by recursion, only under a granted parent. Capability
    // permissions gate the pages, not the nav. Admin (bypass) sees everything.
    const hasSidebarLink = (moduleKey: string, label: string) => {
        const linkId = sidebarLinkPermissionIdForLabel(moduleKey, label);
        return !!linkId && (isAdmin || permissions.includes(linkId));
    };
    // Keep only granted nodes at each depth; a child is reached only if its parent
    // survived, so a sub-link shows only when its parent is also checked.
    const applySidebarGrants = (moduleKey: string, items: ModuleChild[]): ModuleChild[] =>
        items
            .filter((child) => hasSidebarLink(moduleKey, child.label))
            .map((child) => ({
                ...child,
                permission: undefined,
                children: child.children ? applySidebarGrants(moduleKey, child.children) : child.children,
            }));
    const visibleModules = MODULE_SECTIONS
        .map((mod) => ({ ...mod, children: applySidebarGrants(mod.key, mod.children) }))
        .filter((mod) => mod.children.length > 0);

    const visibleAdmin = ADMIN_NAV.filter(
        (item) => isAdmin || hasSidebarLink("admin", item.label)
    );

    const visibleSettings = SETTINGS_NAV.filter(
        (item) => (!item.desktopOnly || inDesktopApp) && (isAdmin || hasSidebarLink("settings", item.label))
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
            className="dark chrome-surface relative flex h-full flex-col border-r border-border-strong bg-surface-rail shrink-0 overflow-hidden text-foreground"
            style={{
                width: isHidden ? 0 : collapsed ? 64 : sidebarWidth,
                transition: sidebarDragging ? "none" : "width 0.3s ease",
            }}
            // One handler for every sidebar link — same right-click menu the
            // Quick Actions bar shows.
            onContextMenu={onNavContextMenu}
        >

            {/* Drag-to-resize handle — right edge, expanded only; stays outside the slide wrapper */}
            {!collapsed && !isHidden && (
                <div
                    onMouseEnter={onSidebarHandleEnter}
                    onMouseLeave={onSidebarHandleLeave}
                    onMouseDown={onSidebarDragStart}
                    className={[
                        "absolute right-0 top-0 h-full w-1.5 z-20 transition-colors",
                        sidebarDragReady
                            ? "cursor-col-resize bg-primary/30"
                            : "cursor-default bg-transparent hover:bg-primary/10",
                    ].join(" ")}
                    title="Drag to resize"
                />
            )}

            {/* Slide wrapper — content animates up to hide, down to show */}
            <div
                className="flex flex-col flex-1 min-h-0"
                style={{
                    transform: isHidden ? "translateY(-100%)" : "translateY(0)",
                    transition: sidebarDragging ? "none" : "transform 0.3s ease",
                }}
            >

                {/* Brand */}
                <div className={`border-b border-border p-4 ${collapsed ? "px-3" : ""}`}>
                    {collapsed ? (
                        <div className="flex flex-col items-center gap-2">
                            <button
                                type="button"
                                title="Expand sidebar"
                                onClick={() => setSidebarMode("expanded")}
                                className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                            >
                                <PanelLeftOpen size={15} />
                            </button>
                            <button
                                type="button"
                                title="Refresh counts"
                                onClick={refreshNavCounts}
                                className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                            >
                                <RefreshCw size={14} />
                            </button>
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
                                S
                            </div>
                            {user?.name && (
                                <Link href={user.id ? `/office/social/users/${user.id}` : "/office/admin/users"}>
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
                            <div className="flex items-center justify-between">
                                <h1 className="truncate text-base font-bold text-primary">AbeerSuite</h1>
                                <div className="flex items-center gap-0.5 shrink-0">
                                    <button
                                        type="button"
                                        title="Refresh counts"
                                        onClick={refreshNavCounts}
                                        className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                                    >
                                        <RefreshCw size={13} />
                                    </button>
                                    <button
                                        type="button"
                                        title="Collapse sidebar"
                                        onClick={() => setSidebarMode("collapsed")}
                                        className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                                    >
                                        <PanelLeftClose size={14} />
                                    </button>
                                </div>
                            </div>
                            <Link
                                href={user?.id ? `/office/social/users/${user.id}` : "/office/admin/users"}
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

                        {/* Workspace */}
                        <section>
                            {!collapsed && (
                                <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                                    Workspace
                                </p>
                            )}
                            <div className="space-y-0.5">
                                {/* Workspace visibility is authoritative — the role picks each link
                                    yes/no (ui:sidebar:workspace:*); untick hides it. Admin always sees all. */}
                                {WORKSPACE_NAV.filter((item) => isAdmin || hasSidebarLink("workspace", item.label)).map((item) => {
                                    const Icon = item.icon;
                                    const hasChildren = !!item.children?.length;
                                    const visibleChildren = item.children?.filter(canViewNavItem) ?? [];
                                    const isOpen = workspaceOpen[item.label.toLowerCase()] ?? false;
                                    const hasActiveChild = visibleChildren.some((child) => isWorkspaceChildActive(child.href, visibleChildren));
                                    const isActiveParent = pathname.startsWith(item.href) || hasActiveChild;

                                    const { fresh, total, noun } = workspaceCounts(item.href);
                                    const badgeTitle = countTitle(fresh, total, noun);

                                    if (!hasChildren || visibleChildren.length === 0 || collapsed) {
                                        return (
                                            <Link
                                                key={item.href}
                                                href={item.href}
                                                className={linkClass(item.href)}
                                                style={navStyle(item.href, surfaceModule(item.href))}
                                                title={collapsed ? `${item.label}${badgeTitle ? ` (${badgeTitle})` : ""}` : ""}
                                            >
                                                <span className="relative shrink-0">
                                                    <Icon
                                                        size={17}
                                                        className="shrink-0"
                                                        style={navIconStyle(item.href, surfaceModule(item.href))}
                                                    />
                                                    <CountDot show={collapsed && fresh > 0} />
                                                </span>
                                                {!collapsed && (
                                                    <span className="flex flex-1 min-w-0 items-center gap-1.5">
                                                        <span className="min-w-0 truncate">{item.label}</span>
                                                        <CountBadges fresh={fresh} total={total} />
                                                    </span>
                                                )}
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
                                                    isActiveParent ? "" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                                                ].join(" ")}
                                                style={isActiveParent ? moduleActiveStyle(surfaceModule(item.href)) : undefined}
                                            >
                                                <Icon
                                                    size={17}
                                                    className="shrink-0"
                                                    style={isActiveParent ? undefined : moduleIconStyle(surfaceModule(item.href))}
                                                />
                                                <span className="flex-1 truncate text-left">{item.label}</span>
                                                <ChevronDown
                                                    size={13}
                                                    className={`shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                                                />
                                            </Button>

                                            {isOpen && (
                                                <div className="ml-3 mt-0.5 space-y-0.5 border-l border-border pl-3" style={groupGuideStyle(surfaceModule(item.href))}>
                                                    {visibleChildren.map((child) => {
                                                        return (
                                                            <Link
                                                                key={`${item.href}-${child.href}`}
                                                                href={child.href}
                                                                className={[
                                                                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
                                                                    isWorkspaceChildActive(child.href, visibleChildren)
                                                                        ? ""
                                                                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                                                                ].join(" ")}
                                                                style={
                                                                    isWorkspaceChildActive(child.href, visibleChildren)
                                                                        ? moduleActiveStyle(surfaceModule(item.href))
                                                                        : undefined
                                                                }
                                                            >
                                                                <child.icon
                                                                    size={15}
                                                                    className="shrink-0"
                                                                    style={
                                                                        isWorkspaceChildActive(child.href, visibleChildren)
                                                                            ? undefined
                                                                            : moduleIconStyle(surfaceModule(item.href))
                                                                    }
                                                                />
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
                                {visibleModules.map((mod) => {
                                    const Icon = mod.icon;
                                    const isOpen = moduleOpen[mod.key] ?? false;
                                    // Ticket-based modules carry their own count. An open ticket shows
                                    // here while it sits in a plain status, and moves to the Work Flow
                                    // badge once a work-bearing sub-status takes it — never both.
                                    const { fresh, total, noun } = moduleCounts(mod.key);
                                    const badgeTitle = countTitle(fresh, total, noun);

                                    return (
                                        <div key={mod.key}>
                                            {collapsed ? (
                                                mod.disabled || !mod.dashboardHref ? (
                                                    <div
                                                        title={mod.label}
                                                        className={[
                                                            "flex h-auto w-full items-center justify-center rounded-lg px-2 py-2 transition-colors",
                                                            mod.disabled
                                                                ? "cursor-not-allowed text-muted-foreground/65"
                                                                : "text-muted-foreground",
                                                        ].join(" ")}
                                                    >
                                                        <Icon size={17} />
                                                    </div>
                                                ) : (
                                                    <Link
                                                        href={mod.dashboardHref}
                                                        title={`${mod.label}${badgeTitle ? ` (${badgeTitle})` : ""}`}
                                                        className="flex h-auto w-full items-center justify-center rounded-lg px-2 py-2 transition-colors hover:bg-muted"
                                                        style={
                                                            pathname.startsWith(mod.dashboardHref)
                                                                ? moduleActiveStyle(mod.key)
                                                                : moduleIconStyle(mod.key)
                                                        }
                                                    >
                                                        <span className="relative">
                                                            <Icon size={17} />
                                                            <CountDot show={fresh > 0} />
                                                        </span>
                                                    </Link>
                                                )
                                            ) : (
                                                <>
                                                    {mod.disabled || !mod.dashboardHref ? (
                                                        <div
                                                            className={[
                                                                "flex h-auto w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium",
                                                                mod.disabled
                                                                    ? "cursor-not-allowed text-muted-foreground/65"
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
                                                                className="flex h-auto flex-1 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150 hover:bg-muted"
                                                                style={
                                                                    pathname.startsWith(mod.dashboardHref)
                                                                        ? moduleActiveStyle(mod.key)
                                                                        : undefined
                                                                }
                                                            >
                                                                {/* The glyph always carries the module hue; the label stays
                                                                    neutral until the module is active, so 12 coloured rows
                                                                    never shout at once. */}
                                                                <Icon size={17} className="shrink-0" style={moduleIconStyle(mod.key)} />
                                                                <span className="flex flex-1 min-w-0 items-center gap-1.5 text-left">
                                                                    <span className={`min-w-0 truncate ${pathname.startsWith(mod.dashboardHref) ? "" : "text-muted-foreground"}`}>{mod.label}</span>
                                                                    <CountBadges fresh={fresh} total={total} />
                                                                </span>
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
                                                        <div className="ml-3 mt-0.5 space-y-0.5 border-l border-border pl-3" style={groupGuideStyle(mod.key)}>
                                                            {renderModuleChildren(mod.children, 0, "root", mod.key)}
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
                                            className={linkClass("/office/admin/users")}
                                            style={navStyle("/office/admin", "administration")}
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
                                            <div className="ml-3 mt-0.5 space-y-0.5 border-l border-border pl-3" style={groupGuideStyle("administration")}>
                                                {visibleAdmin.map(({ label, href, icon: Icon }) => (
                                                    <Link key={href} href={href} className={linkClass(href)} style={navStyle(href, "administration")}>
                                                        <Icon size={15} className="shrink-0" style={navIconStyle(href, "administration")} />
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
                                            style={navStyle("/office/settings", "settings")}
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
                                            <div className="ml-3 mt-0.5 space-y-0.5 border-l border-border pl-3" style={groupGuideStyle("settings")}>
                                                {visibleSettings.map(({ label, href, icon: Icon }) => (
                                                    <Link key={href} href={href} className={linkClass(href)} style={navStyle(href, "settings")}>
                                                        <Icon size={15} className="shrink-0" style={navIconStyle(href, "settings")} />
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
                        title={mounted && resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                        className={[
                            "h-auto w-full items-center justify-start gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-all duration-150 hover:bg-muted hover:text-foreground",
                            collapsed ? "justify-center px-2" : "",
                        ].join(" ")}
                    >
                        {mounted && resolvedTheme === "dark"
                            ? <Sun size={17} className="shrink-0" />
                            : <Moon size={17} className="shrink-0" />
                        }
                        {!collapsed && (
                            <span className="truncate">
                                {mounted && resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
                            </span>
                        )}
                    </Button>

                    {/* Sign out */}
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={() => void captureMyDay().then(() => signOutTo("/staff/login"))}
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

            </div>{/* end slide wrapper */}
            <LinkContextMenu menu={navMenu} onClose={closeNavMenu} />
        </aside>
    );
}
