"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
    AlertTriangle,
    Check,
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
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

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
const NO_COPY_ROLE = "__none__";

const MATRIX_COLUMN_GROUPS = [
    {
        key: "create",
        label: "CREATE",
        columns: [
            { key: "create", label: "own" },
        ],
    },
    {
        key: "view",
        label: "VIEW",
        columns: [
            { key: "viewOwn", label: "own" },
            { key: "viewBranch", label: "br" },
            { key: "viewOrg", label: "org" },
        ],
    },
    {
        key: "edit",
        label: "EDIT",
        columns: [
            { key: "editOwn", label: "own" },
            { key: "editBranch", label: "br" },
            { key: "editOrg", label: "org" },
        ],
    },
    {
        key: "delete",
        label: "DELETE",
        columns: [
            { key: "deleteOwn", label: "own" },
            { key: "deleteBranch", label: "br" },
            { key: "deleteOrg", label: "org" },
        ],
    },
] as const;

type MatrixColumnKey = (typeof MATRIX_COLUMN_GROUPS)[number]["columns"][number]["key"];
type MatrixPermissionCell = string | string[];

const MATRIX_ROWS: {
    key: string;
    label: string;
    module: string;
    cells: Partial<Record<MatrixColumnKey, MatrixPermissionCell>>;
}[] = [
    {
        key: "tickets",
        label: "Tickets",
        module: "tickets",
        cells: {
            viewOwn: "assignments:view-team",
            viewBranch: "assignments:view-team",
            viewOrg: "assignments:view-org",
            create: "tickets:create",
            editOwn: "tickets:status:set",
            editBranch: "tickets:substatus:set",
            editOrg: "tickets:manage-participants",
            deleteOwn: "tickets:assign",
            deleteBranch: "tickets:assign",
            deleteOrg: "tickets:assign",
        },
    },
    {
        key: "ticketOwnership",
        label: "Ticket Ownership",
        module: "tickets",
        cells: {
            viewOwn: "assignments:view-team",
            viewBranch: "assignments:view-team",
            viewOrg: "assignments:view-org",
            editOrg: "tickets:assign",
            deleteOwn: "tickets:assign",
            deleteBranch: "tickets:assign",
            deleteOrg: "tickets:assign",
        },
    },
    {
        key: "warranty",
        label: "Warranty",
        module: "tickets",
        cells: {
            viewOwn: "assignments:view-team",
            viewBranch: "assignments:view-team",
            viewOrg: "assignments:view-org",
            editOrg: "warranty:convert",
        },
    },
    {
        key: "buyers",
        label: "Customers/Companies",
        module: "customers",
        cells: {
            viewOwn: "customers:view",
            viewBranch: "customers:view",
            viewOrg: "customers:view",
            create: ["customers:manage", "companies:manage"],
            editOwn: ["customers:manage", "companies:manage"],
            editBranch: ["customers:manage", "companies:manage"],
            editOrg: ["customers:manage", "companies:manage"],
            deleteOwn: ["customers:manage", "companies:manage"],
            deleteBranch: ["customers:manage", "companies:manage"],
            deleteOrg: ["customers:manage", "companies:manage"],
        },
    },
    {
        key: "invoices",
        label: "Invoices",
        module: "customers",
        cells: {
            viewOwn: "customers:view",
            viewBranch: "customers:view",
            viewOrg: "customers:view",
        },
    },
    {
        key: "assignments",
        label: "Assignments",
        module: "assignments",
        cells: {
            viewOwn: "assignments:view-team",
            viewBranch: "assignments:view-team",
            viewOrg: "assignments:view-org",
        },
    },
    {
        key: "serviceCenters",
        label: "Service Centers",
        module: "service",
        cells: {
            viewOwn: "service-centers:view",
            viewBranch: "service-centers:view",
            viewOrg: "service-centers:view",
            create: "service-centers:manage",
            editOwn: "service-centers:manage",
            editBranch: "service-centers:manage",
            editOrg: "service-centers:manage",
            deleteOwn: "service-centers:manage",
            deleteBranch: "service-centers:manage",
            deleteOrg: "service-centers:manage",
        },
    },
    {
        key: "users",
        label: "Users",
        module: "admin",
        cells: {
            viewOwn: "users:manage",
            viewBranch: "users:manage",
            viewOrg: "users:manage",
            create: "users:manage",
            editOwn: "users:manage",
            editBranch: "users:manage",
            editOrg: "users:manage",
            deleteOwn: "users:manage",
            deleteBranch: "users:manage",
            deleteOrg: "users:manage",
        },
    },
    {
        key: "roles",
        label: "Roles",
        module: "admin",
        cells: {
            viewOwn: "roles:manage",
            viewBranch: "roles:manage",
            viewOrg: "roles:manage",
            create: "roles:manage",
            editOwn: "roles:manage",
            editBranch: "roles:manage",
            editOrg: "roles:manage",
            deleteOwn: "roles:manage",
            deleteBranch: "roles:manage",
            deleteOrg: "roles:manage",
        },
    },
    {
        key: "orgSettings",
        label: "Org Settings",
        module: "admin",
        cells: {
            viewOwn: "settings:manage",
            viewBranch: "settings:manage",
            viewOrg: "settings:manage",
            create: "settings:manage",
            editOwn: "settings:manage",
            editBranch: "settings:manage",
            editOrg: "settings:manage",
            deleteOwn: "settings:manage",
            deleteBranch: "settings:manage",
            deleteOrg: "settings:manage",
        },
    },
    {
        key: "statuses",
        label: "Statuses",
        module: "admin",
        cells: {
            viewOwn: "settings:statuses",
            viewBranch: "settings:statuses",
            viewOrg: "settings:statuses",
            create: "settings:statuses",
            editOwn: "settings:statuses",
            editBranch: "settings:statuses",
            editOrg: "settings:statuses",
            deleteOwn: "settings:statuses",
            deleteBranch: "settings:statuses",
            deleteOrg: "settings:statuses",
        },
    },
    {
        key: "pipelines",
        label: "Pipelines",
        module: "admin",
        cells: {
            viewOwn: "settings:pipelines",
            viewBranch: "settings:pipelines",
            viewOrg: "settings:pipelines",
            create: "settings:pipelines",
            editOwn: "settings:pipelines",
            editBranch: "settings:pipelines",
            editOrg: "settings:pipelines",
            deleteOwn: "settings:pipelines",
            deleteBranch: "settings:pipelines",
            deleteOrg: "settings:pipelines",
        },
    },
    {
        key: "systemBypass",
        label: "System Bypass",
        module: "core",
        cells: {
            editOrg: "admin:bypass",
        },
    },
];

const MATRIX_PERMISSION_IDS = new Set(
    MATRIX_ROWS.flatMap((row) =>
        Object.values(row.cells).flatMap((cell) => (Array.isArray(cell) ? cell : [cell]))
    )
        .filter((permissionId): permissionId is string => Boolean(permissionId))
);

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
    const [newRoleOpen, setNewRoleOpen] = useState(false);
    const [newRole, setNewRole] = useState<RoleForm>(EMPTY_ROLE);
    const [copyFromRoleId, setCopyFromRoleId] = useState(NO_COPY_ROLE);
    const [roleForm, setRoleForm] = useState<RoleForm>(EMPTY_ROLE);
    const [search, setSearch] = useState("");

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

    const permissionById = useMemo(() => new Map(allPerms.map((permission) => [permission.id, permission])), [allPerms]);

    const filtered = search.trim()
        ? allPerms.filter((permission) =>
            [permission.label, permission.id, permission.module, permission.description ?? ""]
                .some((value) => value.toLowerCase().includes(search.toLowerCase()))
        )
        : allPerms;

    const matrixPermissions = filtered.filter((permission) => MATRIX_PERMISSION_IDS.has(permission.id));

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
            if (copyFromRoleId !== NO_COPY_ROLE) {
                const sourceRole = roles.find((role) => role.id === copyFromRoleId);
                const permissionIds = sourceRole?.permissions.map((permission) => permission.permissionId) ?? [];
                await axios.put(`/api/roles/${res.data.id}/permissions`, { permissionIds });
            }
            toast.success("Role created");
            setNewRoleOpen(false);
            setNewRole(EMPTY_ROLE);
            setCopyFromRoleId(NO_COPY_ROLE);
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

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
                Loading roles...
            </div>
        );
    }

    return (
        <div className="space-y-3 pb-8 text-xs">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-xl font-bold tracking-tight text-foreground">
                        Roles &amp; Permissions
                    </h1>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                        Create roles, edit role details, and manage permissions from one page.
                    </p>
                </div>
                <Button size="sm" onClick={() => setNewRoleOpen(true)}>
                    <Plus /> New Role
                </Button>
            </div>

            {roles.length === 0 ? (
                <Card>
                    <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
                        <Shield size={36} className="opacity-20" />
                        <p className="text-sm">No roles found. Create one to get started.</p>
                    </CardContent>
                </Card>
            ) : activeRole && (
                <>
                    <RoleDetailsCard
                        role={activeRole}
                        form={roleForm}
                        selectedCount={selectedCount}
                        totalCount={totalCount}
                        saving={savingRole}
                        hasChanges={hasRoleChanges}
                        onFormChange={setRoleForm}
                        onSave={handleUpdateRole}
                        onDiscard={() => setRoleForm(roleToForm(activeRole))}
                        onDelete={() => handleDelete(activeRole)}
                    />

                    <div className="grid gap-3 xl:grid-cols-[240px_minmax(0,1fr)]">
                        <aside className="xl:sticky xl:top-6 xl:self-start">
                            <RoleList
                                roles={roles}
                                activeRoleId={activeRoleId}
                                totalCount={totalCount}
                                onSelect={handleTabChange}
                            />
                        </aside>

                        <section className="min-w-0 space-y-3">
                        <Card>
                            <CardContent className="space-y-3 pt-4">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <h2 className="text-base font-bold tracking-tight">
                                            Role: {activeRole.label} <Badge className={`${activeRole.color} ml-2`}>{activeRole.id}</Badge>
                                        </h2>
                                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                                            {activeRole._count.users} {activeRole._count.users === 1 ? "user" : "users"} · {selectedCount}/{totalCount} permissions selected. Changes apply on next login.
                                        </p>
                                    </div>
                                    <div className="flex gap-1.5">
                                        <Button
                                            size="sm"
                                            onClick={handleSavePermissions}
                                            disabled={savingPerms || !hasPermissionChanges}
                                        >
                                            <Save size={14} />
                                            {savingPerms ? "Saving..." : "Save permissions"}
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={handleDiscardPermissions}
                                            disabled={!hasPermissionChanges}
                                        >
                                            <RotateCcw size={14} />
                                            Discard
                                        </Button>
                                    </div>
                                </div>

                                <div className="flex flex-wrap gap-1.5 rounded-md border border-border bg-muted/30 px-3 py-2">
                                    <div className="relative min-w-64 flex-1">
                                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                        <Input
                                            value={search}
                                            onChange={(event) => setSearch(event.target.value)}
                                            placeholder="Search permissions by name, module, or ID..."
                                            className="h-7 pl-8 text-xs"
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

                                {hasBypass && (
                                    <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5">
                                        <AlertTriangle size={13} className="mt-0.5 shrink-0 text-destructive" />
                                        <p className="text-[11px] leading-relaxed text-destructive">
                                            <span className="font-semibold">admin:bypass active.</span>{" "}
                                            This role skips every permission check in the system.
                                        </p>
                                    </div>
                                )}

                                {filtered.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                                        <Search size={32} className="mb-3 opacity-20" />
                                        <p className="text-sm">No permissions match your search.</p>
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        <PermissionMatrix
                                            permissions={matrixPermissions}
                                            permissionById={permissionById}
                                            search={search}
                                            selected={selected}
                                            original={original}
                                            onTogglePerm={togglePerm}
                                        />
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                        </section>
                    </div>
                </>
            )}

            <NewRoleDialog
                open={newRoleOpen}
                onOpenChange={setNewRoleOpen}
                roles={roles}
                form={newRole}
                copyFromRoleId={copyFromRoleId}
                saving={savingRole}
                onFormChange={setNewRole}
                onCopyFromRoleChange={setCopyFromRoleId}
                onCreate={handleCreate}
                onCancel={() => {
                    setNewRoleOpen(false);
                    setNewRole(EMPTY_ROLE);
                    setCopyFromRoleId(NO_COPY_ROLE);
                }}
            />
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
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_78px_minmax(160px,1fr)]">
            <div>
                <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                    Role name
                </label>
                <Input
                    value={form.label}
                    onChange={(event) => onChange((prev) => ({ ...prev, label: event.target.value }))}
                    placeholder="e.g. Senior Technician"
                    className="h-7 text-xs"
                />
            </div>
            <div>
                <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                    Rank
                </label>
                <Input
                    type="number"
                    min={0}
                    max={100}
                    value={form.rank}
                    onChange={(event) => onChange((prev) => ({ ...prev, rank: Number(event.target.value) }))}
                    className="h-7 text-xs"
                />
            </div>
            <div>
                <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                    Colour
                </label>
                <div className="flex flex-wrap gap-1">
                    {COLOR_OPTIONS.map((color) => (
                        <button
                            key={color.value}
                            type="button"
                            title={color.label}
                            onClick={() => onChange((prev) => ({ ...prev, color: color.value }))}
                            className={[
                                "h-6 w-6 rounded-md border transition-all duration-150",
                                color.dot,
                                form.color === color.value
                                    ? "scale-105 border-foreground ring-1 ring-border ring-offset-1"
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

function RoleDetailsCard({
    role,
    form,
    selectedCount,
    totalCount,
    saving,
    hasChanges,
    onFormChange,
    onSave,
    onDiscard,
    onDelete,
}: {
    role: Role;
    form: RoleForm;
    selectedCount: number;
    totalCount: number;
    saving: boolean;
    hasChanges: boolean;
    onFormChange: React.Dispatch<React.SetStateAction<RoleForm>>;
    onSave: () => void;
    onDiscard: () => void;
    onDelete: () => void;
}) {
    return (
        <Card className={`border-l-4 ${ROLE_ACCENT[form.color] ?? "border-l-gray-300"}`}>
            <CardContent className="grid gap-3 pt-4 lg:grid-cols-[minmax(160px,0.7fr)_minmax(300px,1.5fr)_auto] lg:items-end">
                <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                        <Badge className={`${role.color} font-mono text-xs`}>{role.id}</Badge>
                        {role.isSystem && (
                            <span className="inline-flex items-center gap-1 border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                <Lock size={9} /> System
                            </span>
                        )}
                    </div>
                    <div>
                        <p className="text-base font-bold leading-tight text-foreground">{role.label}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {role._count.users} {role._count.users === 1 ? "user" : "users"} · {selectedCount}/{totalCount} permissions
                        </p>
                    </div>
                </div>

                <RoleFields form={form} onChange={onFormChange} />

                <div className="flex flex-wrap gap-1.5 lg:justify-end">
                    <Button
                        size="sm"
                        onClick={onSave}
                        disabled={saving || !hasChanges || !form.label.trim()}
                    >
                        <Save size={14} />
                        {saving ? "Saving..." : "Save role"}
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={onDiscard}
                        disabled={!hasChanges}
                    >
                        <RotateCcw size={14} />
                    </Button>
                    {!role.isSystem && (
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={onDelete}
                            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            title="Delete role"
                        >
                            <Trash2 size={14} />
                        </Button>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

function NewRoleDialog({
    open,
    onOpenChange,
    roles,
    form,
    copyFromRoleId,
    saving,
    onFormChange,
    onCopyFromRoleChange,
    onCreate,
    onCancel,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    roles: Role[];
    form: RoleForm;
    copyFromRoleId: string;
    saving: boolean;
    onFormChange: React.Dispatch<React.SetStateAction<RoleForm>>;
    onCopyFromRoleChange: (roleId: string) => void;
    onCreate: () => void;
    onCancel: () => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Create New Role</DialogTitle>
                    <DialogDescription>
                        Create the role details and optionally start with permissions copied from an existing role.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-5">
                    <RoleFields form={form} onChange={onFormChange} />

                    <div>
                        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                            Copy permissions from
                        </label>
                        <Select value={copyFromRoleId} onValueChange={onCopyFromRoleChange}>
                            <SelectTrigger className="w-full">
                                <SelectValue placeholder="Start with no copied permissions" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={NO_COPY_ROLE}>No copied permissions</SelectItem>
                                {roles.map((role) => (
                                    <SelectItem key={role.id} value={role.id}>
                                        {role.label} ({role.id})
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                            The new role will be created first, then the copied permission set will be applied with the existing API.
                        </p>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button disabled={saving || !form.label.trim()} onClick={onCreate}>
                        {saving ? "Creating..." : "Create Role"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function RoleList({
    roles,
    activeRoleId,
    totalCount,
    onSelect,
}: {
    roles: Role[];
    activeRoleId: string;
    totalCount: number;
    onSelect: (roleId: string) => void;
}) {
    return (
        <Card>
            <CardContent className="space-y-2 pt-3">
                <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Roles
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                        Select a role to edit its details and permissions.
                    </p>
                </div>

                <div className="space-y-1">
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
                                    "group w-full rounded-md border border-l-4 bg-background px-2 py-1.5 text-left transition-all",
                                    accent,
                                    isActive
                                        ? "border-primary shadow-sm"
                                        : "border-border hover:border-primary/50 hover:bg-muted/40",
                                ].join(" ")}
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0 space-y-1">
                                        <div className="flex flex-wrap items-center gap-1.5">
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
                                    <span className="text-[10px] text-muted-foreground">
                                        {isActive ? "Active" : ""}
                                    </span>
                                </div>
                                <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                                    <span className="inline-flex items-center gap-1 border border-border bg-muted px-1.5 py-0.5">
                                        <Users size={10} />
                                        {role._count.users}
                                    </span>
                                    <span className="inline-flex items-center gap-1 border border-border bg-muted px-1.5 py-0.5">
                                        <Shield size={10} />
                                        {permissionCount}/{totalCount}
                                    </span>
                                    <span className="inline-flex items-center border border-border bg-muted px-1.5 py-0.5">
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

function PermissionMatrix({
    permissions,
    permissionById,
    search,
    selected,
    original,
    onTogglePerm,
}: {
    permissions: Permission[];
    permissionById: Map<string, Permission>;
    search: string;
    selected: Set<string>;
    original: Set<string>;
    onTogglePerm: (id: string) => void;
}) {
    const visiblePermissionIds = new Set(permissions.map((permission) => permission.id));
    const flattenedColumns = MATRIX_COLUMN_GROUPS.flatMap((group) =>
        group.columns.map((column) => ({ ...column, groupKey: group.key }))
    );
    const cellPermissionIds = (cell?: MatrixPermissionCell) => {
        if (!cell) return [] as string[];
        return Array.isArray(cell) ? cell : [cell];
    };
    const normalizedSearch = search.trim().toLowerCase();
    const rows = MATRIX_ROWS.filter((row) => {
        if (!normalizedSearch) return true;
        if (row.label.toLowerCase().includes(normalizedSearch) || row.module.toLowerCase().includes(normalizedSearch)) {
            return true;
        }

        return Object.values(row.cells).some((cell) =>
            cellPermissionIds(cell).some((permissionId) => {
                const permission = permissionById.get(permissionId);
                return permission
                    ? [permission.id, permission.label, permission.module, permission.description ?? ""]
                        .some((value) => value.toLowerCase().includes(normalizedSearch))
                    : false;
            })
        );
    });

    const groupedRows = [
        ...MODULE_ORDER.filter((module) => rows.some((row) => row.module === module)),
        ...Array.from(new Set(rows.map((row) => row.module))).filter((module) => !MODULE_ORDER.includes(module)),
    ].map((module) => ({
        module,
        rows: rows.filter((row) => row.module === module),
    }));

    return (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="border-b border-border bg-muted/40 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Enterprise Permission Matrix
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Module-wise control for create, view, edit, and delete scopes. Disabled cells are future backend permissions.
                </p>
            </div>
            <div className="max-h-[68vh] overflow-auto">
                <table className="w-full min-w-[760px] text-xs">
                    <thead>
                        <tr className="border-b border-border bg-muted/20 text-[10px] uppercase tracking-wide text-muted-foreground">
                            <th rowSpan={2} className="sticky top-0 left-0 z-40 bg-muted px-3 py-1.5 text-left align-bottom font-semibold">Area</th>
                            {MATRIX_COLUMN_GROUPS.map((group) => (
                                <th
                                    key={group.key}
                                    colSpan={group.columns.length}
                                    className={[
                                        "sticky top-0 z-20 border-l border-border px-2 py-1.5 text-center font-semibold",
                                        group.key === "view" ? "bg-blue-100 dark:bg-blue-950" : "",
                                        group.key === "delete" ? "bg-rose-100 dark:bg-rose-950" : "",
                                        group.key === "create" ? "bg-emerald-100 dark:bg-emerald-950" : "",
                                        group.key === "edit" ? "bg-amber-100 dark:bg-amber-950" : "",
                                    ].join(" ")}
                                >
                                    {group.label}
                                </th>
                            ))}
                        </tr>
                        <tr className="border-b border-border bg-muted/20 text-[10px] lowercase tracking-wide text-muted-foreground">
                            {flattenedColumns.map((column) => (
                                <th
                                    key={column.key}
                                    className={[
                                        "sticky top-7 z-20 border-l border-border px-2 py-1 text-center font-medium",
                                        column.groupKey === "view" ? "bg-blue-100 dark:bg-blue-950" : "",
                                        column.groupKey === "delete" ? "bg-rose-100 dark:bg-rose-950" : "",
                                        column.groupKey === "create" ? "bg-emerald-100 dark:bg-emerald-950" : "",
                                        column.groupKey === "edit" ? "bg-amber-100 dark:bg-amber-950" : "",
                                    ].join(" ")}
                                >
                                    {column.label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {groupedRows.map((group) => (
                            <Fragment key={group.module}>
                                <tr className="bg-muted/50">
                                    <td colSpan={1 + MATRIX_COLUMN_GROUPS.reduce((count, item) => count + item.columns.length, 0)} className="px-3 py-1.5">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[11px] font-bold uppercase tracking-wider text-foreground">
                                                {MODULE_META[group.module]?.label ?? group.module}
                                            </span>
                                            <span className="text-[10px] text-muted-foreground">
                                                {group.rows.length} {group.rows.length === 1 ? "area" : "areas"}
                                            </span>
                                        </div>
                                    </td>
                                </tr>
                                {group.rows.map((row) => (
                                    <tr key={row.key} className="hover:bg-muted/30">
                                        <td className="sticky left-0 z-10 bg-card px-3 py-2">
                                            <div className="font-medium text-foreground">{row.label}</div>
                                            <div className="text-[10px] text-muted-foreground">{row.module}</div>
                                        </td>
                                        {flattenedColumns.map((column) => {
                                            const permissionIds = cellPermissionIds(row.cells[column.key]);
                                            const validPermissionIds = permissionIds.filter(
                                                (permissionId) => permissionById.has(permissionId) && visiblePermissionIds.has(permissionId)
                                            );
                                            const enabled = validPermissionIds.length > 0;
                                            const isOn = enabled && validPermissionIds.every((permissionId) => selected.has(permissionId));
                                            const changed = enabled && validPermissionIds.some(
                                                (permissionId) => selected.has(permissionId) !== original.has(permissionId)
                                            );
                                            const title = enabled
                                                ? validPermissionIds
                                                    .map((permissionId) => {
                                                        const permission = permissionById.get(permissionId);
                                                        return `${permission?.label ?? permissionId} (${permissionId})`;
                                                    })
                                                    .join(" + ")
                                                : "Future scope, not connected to backend yet";

                                            return (
                                                <td
                                                    key={column.key}
                                                    className={[
                                                        "border-l border-border px-2 py-2 text-center",
                                                        column.groupKey === "view" ? "bg-blue-50/30 dark:bg-blue-950/15" : "",
                                                        column.groupKey === "delete" ? "bg-rose-50/30 dark:bg-rose-950/15" : "",
                                                        column.groupKey === "create" ? "bg-emerald-50/30 dark:bg-emerald-950/15" : "",
                                                        column.groupKey === "edit" ? "bg-amber-50/30 dark:bg-amber-950/15" : "",
                                                    ].join(" ")}
                                                >
                                                    {enabled ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                validPermissionIds.forEach((permissionId) => onTogglePerm(permissionId));
                                                            }}
                                                            title={title}
                                                            className={[
                                                                "mx-auto flex h-6 w-6 items-center justify-center rounded-md border transition-colors",
                                                                isOn
                                                                    ? "border-primary bg-primary text-primary-foreground"
                                                                    : "border-border hover:border-primary/60 hover:bg-primary/5",
                                                                changed ? "ring-2 ring-primary/20" : "",
                                                            ].join(" ")}
                                                        >
                                                            {isOn && <Check size={11} strokeWidth={3} />}
                                                        </button>
                                                    ) : (
                                                        <span
                                                            title={title}
                                                            className="mx-auto block h-6 w-6 border border-dashed border-border bg-muted/30 text-muted-foreground/40"
                                                        />
                                                    )}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </Fragment>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
