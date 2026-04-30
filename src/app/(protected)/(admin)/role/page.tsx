"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
    AlertTriangle,
    Check,
    ChevronDown,
    ChevronRight,
    ClipboardList,
    Lock,
    Plus,
    RotateCcw,
    Save,
    Search,
    Settings,
    Shield,
    ShieldCheck,
    Ticket,
    Trash2,
    Users,
    Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface Permission {
    id: string;
    label: string;
    module: string;
    description?: string | null;
}

interface Role {
    id: string;
    label: string;
    color: string;
    rank: number;
    isSystem: boolean;
    _count: { users: number };
    permissions: { permissionId: string; permission: Permission }[];
}

type RoleForm = {
    label: string;
    color: string;
    rank: number;
};

const EMPTY_ROLE: RoleForm = {
    label: "",
    color: "bg-blue-100 text-blue-600",
    rank: 20,
};

const COLOR_OPTIONS = [
    { label: "Gray", value: "bg-gray-100 text-gray-600", dot: "bg-gray-400" },
    { label: "Blue", value: "bg-blue-100 text-blue-600", dot: "bg-blue-500" },
    { label: "Green", value: "bg-green-100 text-green-600", dot: "bg-green-500" },
    { label: "Red", value: "bg-red-100 text-red-600", dot: "bg-red-500" },
    { label: "Purple", value: "bg-purple-100 text-purple-600", dot: "bg-purple-500" },
    { label: "Orange", value: "bg-orange-100 text-orange-600", dot: "bg-orange-500" },
    { label: "Yellow", value: "bg-yellow-100 text-yellow-600", dot: "bg-yellow-400" },
    { label: "Teal", value: "bg-teal-100 text-teal-600", dot: "bg-teal-500" },
];

const ROLE_ACCENT: Record<string, string> = {
    "bg-gray-100 text-gray-600": "border-l-gray-300",
    "bg-blue-100 text-blue-600": "border-l-blue-400",
    "bg-green-100 text-green-600": "border-l-green-400",
    "bg-red-100 text-red-600": "border-l-red-400",
    "bg-purple-100 text-purple-600": "border-l-purple-400",
    "bg-orange-100 text-orange-600": "border-l-orange-400",
    "bg-yellow-100 text-yellow-600": "border-l-yellow-300",
    "bg-teal-100 text-teal-600": "border-l-teal-400",
};

const MODULE_META: Record<string, { label: string; description: string; icon: React.ReactNode; chip: string }> = {
    core: {
        label: "Core",
        description: "System-level access controls",
        icon: <ShieldCheck size={13} />,
        chip: "bg-red-50 border-red-200 text-red-700",
    },
    customers: {
        label: "Customers",
        description: "Customer and company record access",
        icon: <Users size={13} />,
        chip: "bg-blue-50 border-blue-200 text-blue-700",
    },
    tickets: {
        label: "Tickets",
        description: "Ticket workflow and ownership",
        icon: <Ticket size={13} />,
        chip: "bg-indigo-50 border-indigo-200 text-indigo-700",
    },
    assignments: {
        label: "Assignments",
        description: "Work Inbox visibility scopes",
        icon: <ClipboardList size={13} />,
        chip: "bg-emerald-50 border-emerald-200 text-emerald-700",
    },
    service: {
        label: "Service",
        description: "Service centers and warranty fields",
        icon: <Wrench size={13} />,
        chip: "bg-orange-50 border-orange-200 text-orange-700",
    },
    admin: {
        label: "Administration",
        description: "System settings and user management",
        icon: <Settings size={13} />,
        chip: "bg-purple-50 border-purple-200 text-purple-700",
    },
};

const MODULE_ORDER = ["core", "customers", "tickets", "assignments", "service", "admin"];

function roleToForm(role: Role): RoleForm {
    return {
        label: role.label,
        color: role.color,
        rank: role.rank,
    };
}

function getErrorMessage(error: unknown, fallback: string) {
    return axios.isAxiosError(error) ? error.response?.data?.error ?? fallback : fallback;
}

export default function RolePage() {
    const [roles, setRoles] = useState<Role[]>([]);
    const [allPerms, setAllPerms] = useState<Permission[]>([]);
    const [activeRoleId, setActiveRoleId] = useState("");
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [original, setOriginal] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);
    const [savingRole, setSavingRole] = useState(false);
    const [savingPerms, setSavingPerms] = useState(false);
    const [addingNew, setAddingNew] = useState(false);
    const [newRole, setNewRole] = useState<RoleForm>(EMPTY_ROLE);
    const [roleForm, setRoleForm] = useState<RoleForm>(EMPTY_ROLE);
    const [search, setSearch] = useState("");
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

    const activeRole = roles.find((role) => role.id === activeRoleId) ?? null;

    const loadData = useCallback(async (preferredRoleId?: string) => {
        try {
            const [rolesRes, permsRes] = await Promise.all([
                axios.get<Role[]>("/api/roles"),
                axios.get<Permission[]>("/api/permissions"),
            ]);
            const fetchedRoles = rolesRes.data;
            const nextActive =
                preferredRoleId && fetchedRoles.some((role) => role.id === preferredRoleId)
                    ? preferredRoleId
                    : fetchedRoles[0]?.id ?? "";

            setRoles(fetchedRoles);
            setAllPerms(permsRes.data);
            setActiveRoleId(nextActive);
        } catch {
            toast.error("Failed to load roles");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    useEffect(() => {
        if (!activeRole) return;
        const granted = new Set(activeRole.permissions.map((permission) => permission.permissionId));
        setSelected(granted);
        setOriginal(new Set(granted));
        setRoleForm(roleToForm(activeRole));
        setSearch("");
    }, [activeRole]);

    const hasPermissionChanges = useMemo(() => {
        if (selected.size !== original.size) return true;
        for (const permissionId of selected) {
            if (!original.has(permissionId)) return true;
        }
        return false;
    }, [selected, original]);

    const hasRoleChanges = activeRole
        ? roleForm.label.trim() !== activeRole.label ||
            roleForm.color !== activeRole.color ||
            roleForm.rank !== activeRole.rank
        : false;

    const filtered = search.trim()
        ? allPerms.filter((permission) =>
            [permission.label, permission.id, permission.module, permission.description ?? ""]
                .some((value) => value.toLowerCase().includes(search.toLowerCase()))
        )
        : allPerms;

    const byModule = filtered.reduce<Record<string, Permission[]>>((acc, permission) => {
        (acc[permission.module] ??= []).push(permission);
        return acc;
    }, {});

    const orderedModules = [
        ...MODULE_ORDER.filter((module) => byModule[module]),
        ...Object.keys(byModule).filter((module) => !MODULE_ORDER.includes(module)),
    ];

    const selectedCount = selected.size;
    const totalCount = allPerms.length;
    const hasBypass = selected.has("admin:bypass");

    const handleTabChange = (roleId: string) => {
        if (hasPermissionChanges && !confirm("Discard unsaved permission changes?")) return;
        setActiveRoleId(roleId);
    };

    const handleCreate = async () => {
        if (!newRole.label.trim()) {
            toast.error("Role name is required");
            return;
        }

        setSavingRole(true);
        try {
            const res = await axios.post<Role>("/api/roles", newRole);
            toast.success("Role created");
            setAddingNew(false);
            setNewRole(EMPTY_ROLE);
            await loadData(res.data.id);
        } catch (error) {
            toast.error(getErrorMessage(error, "Failed to create role"));
        } finally {
            setSavingRole(false);
        }
    };

    const handleUpdateRole = async () => {
        if (!activeRole) return;
        if (!roleForm.label.trim()) {
            toast.error("Role name is required");
            return;
        }

        setSavingRole(true);
        try {
            await axios.patch(`/api/roles/${activeRole.id}`, {
                label: roleForm.label,
                color: roleForm.color,
                rank: roleForm.rank,
            });
            toast.success("Role updated");
            await loadData(activeRole.id);
        } catch (error) {
            toast.error(getErrorMessage(error, "Failed to update role"));
        } finally {
            setSavingRole(false);
        }
    };

    const handleDelete = async (role: Role) => {
        if (!confirm(`Delete ${role.label}? Users assigned this role will lose it.`)) return;

        try {
            await axios.delete(`/api/roles/${role.id}`);
            toast.success("Role deleted");
            const nextRole = roles.find((item) => item.id !== role.id)?.id;
            await loadData(nextRole);
        } catch (error) {
            toast.error(getErrorMessage(error, "Failed to delete role"));
        }
    };

    const handleSavePermissions = async () => {
        if (!activeRole) return;

        setSavingPerms(true);
        try {
            await axios.put(`/api/roles/${activeRole.id}/permissions`, {
                permissionIds: [...selected],
            });
            setOriginal(new Set(selected));
            toast.success("Permissions saved");
            await loadData(activeRole.id);
        } catch {
            toast.error("Failed to save permissions");
        } finally {
            setSavingPerms(false);
        }
    };

    const handleDiscardPermissions = () => setSelected(new Set(original));

    const togglePerm = (id: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const toggleModule = (module: string) => {
        setCollapsed((prev) => {
            const next = new Set(prev);
            if (next.has(module)) {
                next.delete(module);
            } else {
                next.add(module);
            }
            return next;
        });
    };

    const selectAll = (permissions: Permission[]) => {
        setSelected((prev) => {
            const next = new Set(prev);
            permissions.forEach((permission) => next.add(permission.id));
            return next;
        });
    };

    const deselectAll = (permissions: Permission[]) => {
        setSelected((prev) => {
            const next = new Set(prev);
            permissions.forEach((permission) => next.delete(permission.id));
            return next;
        });
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
                Loading roles...
            </div>
        );
    }

    return (
        <div className="space-y-6 pb-12">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-foreground">
                        Role Management
                    </h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Create roles, edit role details, and manage permissions from one page.
                    </p>
                </div>
                <Button onClick={() => setAddingNew(true)}>
                    <Plus /> New Role
                </Button>
            </div>

            {addingNew && (
                <Card className="border-2 border-primary/30 bg-primary/5">
                    <CardContent className="space-y-4 pt-5">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                                New Role
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                                The role ID is generated automatically by the existing API.
                            </p>
                        </div>
                        <RoleFields
                            form={newRole}
                            onChange={setNewRole}
                        />
                        <div className="flex justify-end gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setAddingNew(false)}
                            >
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                disabled={savingRole || !newRole.label.trim()}
                                onClick={handleCreate}
                            >
                                {savingRole ? "Creating..." : "Create Role"}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {roles.length === 0 ? (
                <Card>
                    <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
                        <Shield size={36} className="opacity-20" />
                        <p className="text-sm">No roles found. Create one to get started.</p>
                    </CardContent>
                </Card>
            ) : activeRole && (
                <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
                    <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
                        <RoleList
                            roles={roles}
                            activeRoleId={activeRoleId}
                            totalCount={totalCount}
                            onSelect={handleTabChange}
                            onDelete={handleDelete}
                        />

                        <Card className={`border-l-4 ${ROLE_ACCENT[roleForm.color] ?? "border-l-gray-300"}`}>
                            <CardContent className="space-y-4 pt-5">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                            Role Details
                                        </p>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            Edit the selected role.
                                        </p>
                                    </div>
                                    <Badge className={`${activeRole.color} font-mono text-xs`}>
                                        {activeRole.id}
                                    </Badge>
                                </div>
                                <RoleFields
                                    form={roleForm}
                                    onChange={setRoleForm}
                                />
                                <div className="flex gap-2">
                                    <Button
                                        className="flex-1"
                                        onClick={handleUpdateRole}
                                        disabled={savingRole || !hasRoleChanges || !roleForm.label.trim()}
                                    >
                                        <Save size={14} />
                                        {savingRole ? "Saving..." : "Save role"}
                                    </Button>
                                    <Button
                                        variant="outline"
                                        onClick={() => setRoleForm(roleToForm(activeRole))}
                                        disabled={!hasRoleChanges}
                                    >
                                        <RotateCcw size={14} />
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>

                        {hasBypass && (
                            <div className="flex items-start gap-2 border-2 border-destructive/30 bg-destructive/10 px-3 py-2.5">
                                <AlertTriangle size={13} className="mt-0.5 shrink-0 text-destructive" />
                                <p className="text-[11px] leading-relaxed text-destructive">
                                    <span className="font-semibold">admin:bypass active.</span>{" "}
                                    This role skips every permission check in the system.
                                </p>
                            </div>
                        )}
                    </aside>

                    <section className="min-w-0 space-y-4">
                        <Card>
                            <CardContent className="space-y-4 pt-5">
                                <div className="flex flex-wrap items-start justify-between gap-4">
                                    <div>
                                        <h2 className="text-xl font-bold tracking-tight">
                                            Permissions <Badge className={`${activeRole.color} ml-2`}>{activeRole.label}</Badge>
                                        </h2>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            {selectedCount}/{totalCount} permissions selected. Changes apply on next login.
                                        </p>
                                    </div>
                                    <div className="flex gap-2">
                                        <Button
                                            onClick={handleSavePermissions}
                                            disabled={savingPerms || !hasPermissionChanges}
                                        >
                                            <Save size={14} />
                                            {savingPerms ? "Saving..." : "Save permissions"}
                                        </Button>
                                        <Button
                                            variant="outline"
                                            onClick={handleDiscardPermissions}
                                            disabled={!hasPermissionChanges}
                                        >
                                            <RotateCcw size={14} />
                                            Discard
                                        </Button>
                                    </div>
                                </div>

                                <div className="flex flex-wrap gap-2 border-2 border-border bg-muted/30 px-4 py-3">
                                    <div className="relative min-w-64 flex-1">
                                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                        <Input
                                            value={search}
                                            onChange={(event) => setSearch(event.target.value)}
                                            placeholder="Search permissions by name, module, or ID..."
                                            className="h-8 pl-8 text-sm"
                                        />
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setSelected(new Set(allPerms.map((permission) => permission.id)))}
                                    >
                                        Select all
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setSelected(new Set())}
                                    >
                                        Clear all
                                    </Button>
                                </div>

                                {orderedModules.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                                        <Search size={32} className="mb-3 opacity-20" />
                                        <p className="text-sm">No permissions match your search.</p>
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {orderedModules.map((module) => (
                                            <PermissionModule
                                                key={module}
                                                module={module}
                                                permissions={byModule[module]}
                                                selected={selected}
                                                original={original}
                                                collapsed={collapsed.has(module)}
                                                search={search}
                                                onToggleModule={() => toggleModule(module)}
                                                onTogglePerm={togglePerm}
                                                onSelectAll={selectAll}
                                                onDeselectAll={deselectAll}
                                            />
                                        ))}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </section>
                </div>
            )}
        </div>
    );
}

function RoleFields({
    form,
    onChange,
}: {
    form: RoleForm;
    onChange: React.Dispatch<React.SetStateAction<RoleForm>>;
}) {
    return (
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_110px]">
            <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Role name
                </label>
                <Input
                    value={form.label}
                    onChange={(event) => onChange((prev) => ({ ...prev, label: event.target.value }))}
                    placeholder="e.g. Senior Technician"
                />
            </div>
            <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Rank
                </label>
                <Input
                    type="number"
                    min={0}
                    max={100}
                    value={form.rank}
                    onChange={(event) => onChange((prev) => ({ ...prev, rank: Number(event.target.value) }))}
                />
            </div>
            <div className="sm:col-span-2">
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Colour
                </label>
                <div className="flex flex-wrap gap-1.5">
                    {COLOR_OPTIONS.map((color) => (
                        <button
                            key={color.value}
                            type="button"
                            title={color.label}
                            onClick={() => onChange((prev) => ({ ...prev, color: color.value }))}
                            className={[
                                "h-7 w-7 border-2 transition-all duration-150",
                                color.dot,
                                form.color === color.value
                                    ? "scale-110 border-foreground ring-2 ring-border ring-offset-1"
                                    : "border-transparent hover:scale-105 hover:border-border",
                            ].join(" ")}
                        />
                    ))}
                    {form.label && <Badge className={`${form.color} ml-2`}>{form.label}</Badge>}
                </div>
            </div>
        </div>
    );
}

function RoleList({
    roles,
    activeRoleId,
    totalCount,
    onSelect,
    onDelete,
}: {
    roles: Role[];
    activeRoleId: string;
    totalCount: number;
    onSelect: (roleId: string) => void;
    onDelete: (role: Role) => void;
}) {
    return (
        <Card>
            <CardContent className="space-y-3 pt-4">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Roles
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                        Select a role to edit its details and permissions.
                    </p>
                </div>

                <div className="space-y-1.5">
                    {roles.map((role) => {
                        const isActive = role.id === activeRoleId;
                        const permissionCount = role.permissions.length;
                        const accent = ROLE_ACCENT[role.color] ?? "border-l-gray-300";

                        return (
                            <button
                                key={role.id}
                                type="button"
                                onClick={() => onSelect(role.id)}
                                className={[
                                    "group w-full border-2 border-l-4 bg-background px-2.5 py-2 text-left transition-all",
                                    accent,
                                    isActive
                                        ? "border-primary shadow-sm"
                                        : "border-border hover:border-primary/50 hover:bg-muted/40",
                                ].join(" ")}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 space-y-1.5">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Badge className={`${role.color} font-mono text-[10px]`}>
                                                {role.id}
                                            </Badge>
                                            {role.isSystem && (
                                                <span className="inline-flex items-center gap-1 border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                                    <Lock size={9} /> System
                                                </span>
                                            )}
                                        </div>
                                        <p className="truncate text-xs font-semibold text-foreground">
                                            {role.label}
                                        </p>
                                    </div>
                                    {!role.isSystem && (
                                        <Button
                                            variant="ghost"
                                            size="icon-sm"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                onDelete(role);
                                            }}
                                            className="shrink-0 text-muted-foreground opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                                            title="Delete role"
                                        >
                                            <Trash2 size={14} />
                                        </Button>
                                    )}
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                                    <span className="inline-flex items-center gap-1 border border-border bg-muted px-2 py-0.5">
                                        <Users size={10} />
                                        {role._count.users}
                                    </span>
                                    <span className="inline-flex items-center gap-1 border border-border bg-muted px-2 py-0.5">
                                        <Shield size={10} />
                                        {permissionCount}/{totalCount}
                                    </span>
                                    <span className="inline-flex items-center border border-border bg-muted px-2 py-0.5">
                                        Rank {role.rank}
                                    </span>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </CardContent>
        </Card>
    );
}

function PermissionModule({
    module,
    permissions,
    selected,
    original,
    collapsed,
    search,
    onToggleModule,
    onTogglePerm,
    onSelectAll,
    onDeselectAll,
}: {
    module: string;
    permissions: Permission[];
    selected: Set<string>;
    original: Set<string>;
    collapsed: boolean;
    search: string;
    onToggleModule: () => void;
    onTogglePerm: (id: string) => void;
    onSelectAll: (permissions: Permission[]) => void;
    onDeselectAll: (permissions: Permission[]) => void;
}) {
    const meta = MODULE_META[module];
    const selectedInModule = permissions.filter((permission) => selected.has(permission.id)).length;
    const allSelected = selectedInModule === permissions.length;

    return (
        <div className="overflow-hidden border-2 border-border bg-card">
            <div
                className={[
                    "flex items-center gap-2.5 border-b-2 border-border px-4 py-3",
                    meta?.chip ?? "bg-muted text-foreground",
                ].join(" ")}
            >
                <button
                    onClick={onToggleModule}
                    className="opacity-60 transition-opacity hover:opacity-100"
                    title={collapsed ? "Expand" : "Collapse"}
                >
                    {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                </button>
                <span className="opacity-70">{meta?.icon}</span>
                <div className="min-w-0 flex-1">
                    <span className="text-xs font-bold uppercase tracking-wider">
                        {meta?.label ?? module}
                    </span>
                    {!search && meta?.description && (
                        <span className="ml-2 text-[11px] font-normal normal-case tracking-normal opacity-60">
                            {meta.description}
                        </span>
                    )}
                </div>
                <span className="text-xs font-semibold tabular-nums opacity-60">
                    {selectedInModule}/{permissions.length}
                </span>
                <button
                    onClick={() => allSelected ? onDeselectAll(permissions) : onSelectAll(permissions)}
                    className="px-2 py-0.5 text-xs font-medium transition-colors hover:bg-black/10"
                >
                    {allSelected ? "None" : "All"}
                </button>
            </div>

            {!collapsed && (
                <div className="divide-y divide-border">
                    {permissions.map((permission) => {
                        const isOn = selected.has(permission.id);
                        const wasOriginal = original.has(permission.id);
                        const changed = isOn !== wasOriginal;
                        const isDangerous = permission.id === "admin:bypass";

                        return (
                            <button
                                key={permission.id}
                                type="button"
                                onClick={() => onTogglePerm(permission.id)}
                                className={[
                                    "group flex w-full items-start gap-4 px-5 py-3.5 text-left transition-colors",
                                    isDangerous
                                        ? isOn ? "bg-destructive/10 hover:bg-destructive/5" : "hover:bg-destructive/5"
                                        : isOn ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-muted/60",
                                ].join(" ")}
                            >
                                <div
                                    className={[
                                        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border-2 transition-all",
                                        isOn
                                            ? isDangerous
                                                ? "border-destructive bg-destructive"
                                                : "border-primary bg-primary"
                                            : "border-border group-hover:border-foreground/50",
                                    ].join(" ")}
                                >
                                    {isOn && <Check size={10} strokeWidth={3} className="text-white" />}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span
                                            className={[
                                                "text-sm font-medium leading-none",
                                                isDangerous && isOn
                                                    ? "text-destructive"
                                                    : isOn ? "text-foreground" : "text-muted-foreground",
                                            ].join(" ")}
                                        >
                                            {permission.label}
                                        </span>
                                        {isDangerous && (
                                            <Badge variant="destructive" className="h-4 px-1.5 text-[10px]">
                                                Dangerous
                                            </Badge>
                                        )}
                                        {changed && (
                                            <span className={`text-[10px] font-semibold ${isOn ? "text-green-600" : "text-red-500"}`}>
                                                {isOn ? "+ added" : "- removed"}
                                            </span>
                                        )}
                                    </div>
                                    {permission.description && (
                                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                            {permission.description}
                                        </p>
                                    )}
                                    <p className="mt-1 select-all font-mono text-[10px] text-muted-foreground/40">
                                        {permission.id}
                                    </p>
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
