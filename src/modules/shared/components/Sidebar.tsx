"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useTheme } from "next-themes";
import axios from "axios";
import { toast } from "sonner";
import {
    Settings, ChevronDown, LogOut,
    ChevronLeft, ChevronRight, Sun, Moon, ShieldCheck, Bell,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

function initials(name: string) {
    return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

const AVATAR_COLOR: Record<string, string> = {
    R1: "bg-purple-100 text-purple-700",
    R2: "bg-blue-100 text-blue-700",
    R3: "bg-green-100 text-green-700",
    R4: "bg-orange-100 text-orange-700",
    R5: "bg-pink-100 text-pink-700",
};

type Pipeline = { id: string; isDefault: boolean; isActive: boolean };

type InboxRoom = { unreadCount: number };

export default function Sidebar({ user }: { user?: SidebarUser }) {
    const pathname = usePathname();
    const { resolvedTheme, setTheme } = useTheme();
    const permissions = user?.permissions ?? [];
    const userRoles = user?.roles ?? (user?.role ? [user.role] : []);
    const isAdmin = permissions.includes("admin:bypass");
    const { setOpen: openQuickTicket, setInitialPipelineId } = useQuickTicketStore();

    const [collapsed, setCollapsed] = useState(false);
    const [liveAvatar, setLiveAvatar] = useState<string | null | undefined>(undefined);
    const [adminOpen, setAdminOpen] = useState(
        pathname.startsWith("/users") || pathname.startsWith("/roles") || pathname.startsWith("/org-chart") || pathname.startsWith("/branches") || pathname.startsWith("/departments") || pathname.startsWith("/posts")
    );
    const [settingsOpen, setSettingsOpen] = useState(pathname.startsWith("/settings"));
    const [workspaceOpen, setWorkspaceOpen] = useState<Record<string, boolean>>({
        customers: pathname.startsWith("/customers") || pathname.startsWith("/companies"),
    });
    const [inboxRooms, setInboxRooms] = useState<InboxRoom[]>([]);
    const [moduleOpen, setModuleOpen] = useState<Record<string, boolean>>({
        repair: pathname.startsWith("/tickets") || pathname.startsWith("/service-centers") || pathname.startsWith("/dashboard"),
        tally: false,
    });
    const [defaultPipeline, setDefaultPipeline] = useState<Pipeline | null>(null);
    const [showCreatePerson, setShowCreatePerson] = useState(false);
    const [showCreateCompany, setShowCreateCompany] = useState(false);
    const [savingPerson, setSavingPerson] = useState(false);
    const [savingCompany, setSavingCompany] = useState(false);
    const [personForm, setPersonForm] = useState({ name: "", phone: "", email: "", address: "" });
    const [companyForm, setCompanyForm] = useState({
        name: "",
        phone: "",
        email: "",
        address: "",
        companyReg: "",
        taxId: "",
    });

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
        // Prevent broad routes like "/customers" from also matching "/customers/all".
        const hasMoreSpecificSiblingMatch = siblings.some((sibling) => {
            if (!sibling.href || sibling.href === childHref) return false;
            return sibling.href.startsWith(`${childHref}/`) && pathname.startsWith(sibling.href);
        });
        return !hasMoreSpecificSiblingMatch;
    };

    const canViewChild = (child: ModuleChild) =>
        !child.permission || isAdmin || permissions.includes(child.permission);

    const visibleAdmin = ADMIN_NAV.filter(
        (item) => isAdmin || permissions.includes(item.permission)
    );

    const visibleSettings = SETTINGS_NAV.filter(
        (item) => isAdmin || permissions.includes(item.permission)
    );

    const canViewNavItem = (item: NavItem) =>
        item.permission === null || !item.permission || isAdmin || permissions.includes(item.permission);

    const isCreatePersonItem = (href: string) => href === "/customers/new";
    const isCreateCompanyItem = (href: string) => href === "/companies/new";
    const isDialogNavItem = (href: string) => isCreatePersonItem(href) || isCreateCompanyItem(href);

    const isWorkspaceChildActive = (childHref: string, siblings: NavItem[]) => {
        if (isDialogNavItem(childHref)) return false;
        if (!pathname.startsWith(childHref)) return false;
        // Prevent broad routes like "/customers" from also matching "/customers/all".
        const hasMoreSpecificSiblingMatch = siblings.some(
            (sibling) => sibling.href !== childHref && sibling.href.startsWith(`${childHref}/`) && pathname.startsWith(sibling.href)
        );
        return !hasMoreSpecificSiblingMatch;
    };

    const openWorkspaceDialog = (href: string) => {
        if (isCreatePersonItem(href)) {
            setShowCreatePerson(true);
            return;
        }
        if (isCreateCompanyItem(href)) {
            setShowCreateCompany(true);
        }
    };

    const handleCreatePerson = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!personForm.name.trim()) {
            toast.error("Name is required");
            return;
        }
        setSavingPerson(true);
        try {
            await axios.post("/api/customers", personForm);
            toast.success("Person created");
            setShowCreatePerson(false);
            setPersonForm({ name: "", phone: "", email: "", address: "" });
        } catch {
            toast.error("Failed to create person");
        } finally {
            setSavingPerson(false);
        }
    };

    const handleCreateCompany = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!companyForm.name.trim()) {
            toast.error("Company name is required");
            return;
        }
        setSavingCompany(true);
        try {
            await axios.post("/api/companies", companyForm);
            toast.success("Company created");
            setShowCreateCompany(false);
            setCompanyForm({
                name: "",
                phone: "",
                email: "",
                address: "",
                companyReg: "",
                taxId: "",
            });
        } catch {
            toast.error("Failed to create company");
        } finally {
            setSavingCompany(false);
        }
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
                            <Link href={user.id ? `/users/${user.id}` : "/users"}>
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
                            href={user?.id ? `/users/${user.id}` : "/users"}
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
            <nav className="flex-1 space-y-4 overflow-y-auto overflow-x-hidden p-2">

                {/* Inbox */}
                <section>
                    <Link href="/inbox" className={linkClass("/inbox")} title={collapsed ? "Inbox" : ""}>
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
                                                if (isDialogNavItem(child.href)) {
                                                    return (
                                                        <Button
                                                            key={`${item.href}-${child.href}`}
                                                            type="button"
                                                            variant="ghost"
                                                            onClick={() => openWorkspaceDialog(child.href)}
                                                            className="h-auto w-full justify-start gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-all duration-150 hover:bg-muted hover:text-foreground"
                                                        >
                                                            <child.icon size={15} className="shrink-0" />
                                                            <span className="truncate">{child.label}</span>
                                                        </Button>
                                                    );
                                                }

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
                        {MODULE_SECTIONS.map((mod) => {
                            const Icon = mod.icon;
                            const isOpen = moduleOpen[mod.key] ?? false;

                            return (
                                <div key={mod.key}>
                                    {collapsed ? (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            title={mod.label}
                                            className={[
                                                "h-auto w-full items-center justify-center rounded-lg px-2 py-2 transition-colors",
                                                mod.disabled
                                                    ? "cursor-not-allowed text-muted-foreground/30"
                                                    : "text-muted-foreground hover:bg-muted",
                                            ].join(" ")}
                                        >
                                            <Icon size={17} />
                                        </Button>
                                    ) : (
                                        <>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                disabled={mod.disabled}
                                                onClick={() =>
                                                    !mod.disabled &&
                                                    setModuleOpen((prev) => ({
                                                        ...prev,
                                                        [mod.key]: !prev[mod.key],
                                                    }))
                                                }
                                                className={[
                                                    "h-auto w-full items-center justify-start gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
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
                                            </Button>

                                            {isOpen && (
                                                <div className="ml-3 mt-0.5 space-y-0.5 border-l border-border pl-3">
                                                    {mod.children
                                                        .filter(canViewChild)
                                                        .map((child) => {
                                                            const CIcon = child.icon;
                                                            const href = resolveHref(child);
                                                            const basePath = href?.split("?")[0] ?? "";
                                                            const isActiveChild =
                                                                !!basePath && isModuleChildActive(basePath, mod.children);

                                                            if (child.action) {
                                                                return (
                                                                    <Button
                                                                        key={child.label}
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
                                                                        {child.disabled && (
                                                                            <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                                                                                Soon
                                                                            </Badge>
                                                                        )}
                                                                    </Button>
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
                <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                    Admin Only
                </p>
                {/* Admin */}
                {visibleAdmin.length > 0 && (
                    <section>
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => !collapsed && setAdminOpen((o) => !o)}
                            className={linkClass("/users")}
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
            </nav>

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
                    onClick={() => signOut({ callbackUrl: "/login" })}
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

            <Dialog open={showCreatePerson} onOpenChange={setShowCreatePerson}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Create Person</DialogTitle>
                        <DialogDescription>Add a new customer person record.</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleCreatePerson} className="space-y-3">
                        <div className="space-y-2">
                            <Label>Name</Label>
                            <Input
                                value={personForm.name}
                                onChange={(e) => setPersonForm((prev) => ({ ...prev, name: e.target.value }))}
                                autoFocus
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Phone</Label>
                            <Input
                                value={personForm.phone}
                                onChange={(e) => setPersonForm((prev) => ({ ...prev, phone: e.target.value }))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Email</Label>
                            <Input
                                type="email"
                                value={personForm.email}
                                onChange={(e) => setPersonForm((prev) => ({ ...prev, email: e.target.value }))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Address</Label>
                            <Input
                                value={personForm.address}
                                onChange={(e) => setPersonForm((prev) => ({ ...prev, address: e.target.value }))}
                            />
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setShowCreatePerson(false)}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={savingPerson}>
                                {savingPerson ? "Creating..." : "Create"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog open={showCreateCompany} onOpenChange={setShowCreateCompany}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Create Company</DialogTitle>
                        <DialogDescription>Add a new company customer record.</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleCreateCompany} className="space-y-3">
                        <div className="space-y-2">
                            <Label>Company Name</Label>
                            <Input
                                value={companyForm.name}
                                onChange={(e) => setCompanyForm((prev) => ({ ...prev, name: e.target.value }))}
                                autoFocus
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <Label>Phone</Label>
                                <Input
                                    value={companyForm.phone}
                                    onChange={(e) => setCompanyForm((prev) => ({ ...prev, phone: e.target.value }))}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Email</Label>
                                <Input
                                    type="email"
                                    value={companyForm.email}
                                    onChange={(e) => setCompanyForm((prev) => ({ ...prev, email: e.target.value }))}
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <Label>Company Reg</Label>
                                <Input
                                    value={companyForm.companyReg}
                                    onChange={(e) => setCompanyForm((prev) => ({ ...prev, companyReg: e.target.value }))}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Tax ID / VAT</Label>
                                <Input
                                    value={companyForm.taxId}
                                    onChange={(e) => setCompanyForm((prev) => ({ ...prev, taxId: e.target.value }))}
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>Address</Label>
                            <Input
                                value={companyForm.address}
                                onChange={(e) => setCompanyForm((prev) => ({ ...prev, address: e.target.value }))}
                            />
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setShowCreateCompany(false)}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={savingCompany}>
                                {savingCompany ? "Creating..." : "Create"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </aside>
    );
}
