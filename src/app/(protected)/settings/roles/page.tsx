"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
    Plus, Trash2, Shield, X, Search,
    ChevronDown, ChevronRight, AlertTriangle,
    Lock, Users, Check,
    ClipboardList, Ticket, Settings, ShieldCheck, Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
    DialogDescription, DialogClose,
} from "@/components/ui/dialog";

// ─── Types ────────────────────────────────────────────────────────────────────

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
    isSystem: boolean;
    _count: { users: number };
    permissions: { permissionId: string; permission: Permission }[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const COLOR_OPTIONS = [
    { label: "Gray",   value: "bg-gray-100 text-gray-600",    dot: "bg-gray-400" },
    { label: "Blue",   value: "bg-blue-100 text-blue-600",    dot: "bg-blue-500" },
    { label: "Green",  value: "bg-green-100 text-green-600",  dot: "bg-green-500" },
    { label: "Red",    value: "bg-red-100 text-red-600",      dot: "bg-red-500" },
    { label: "Purple", value: "bg-purple-100 text-purple-600",dot: "bg-purple-500" },
    { label: "Orange", value: "bg-orange-100 text-orange-600",dot: "bg-orange-500" },
    { label: "Yellow", value: "bg-yellow-100 text-yellow-600",dot: "bg-yellow-400" },
    { label: "Teal",   value: "bg-teal-100 text-teal-600",    dot: "bg-teal-500" },
];

// Static map so Tailwind JIT sees all classes
const ROLE_ACCENT: Record<string, string> = {
    "bg-gray-100 text-gray-600":    "border-l-gray-300",
    "bg-blue-100 text-blue-600":    "border-l-blue-400",
    "bg-green-100 text-green-600":  "border-l-green-400",
    "bg-red-100 text-red-600":      "border-l-red-400",
    "bg-purple-100 text-purple-600":"border-l-purple-400",
    "bg-orange-100 text-orange-600":"border-l-orange-400",
    "bg-yellow-100 text-yellow-600":"border-l-yellow-300",
    "bg-teal-100 text-teal-600":    "border-l-teal-400",
};

const MODULE_META: Record<string, {
    label: string;
    description: string;
    icon: React.ReactNode;
    chip: string;
}> = {
    core:        { label: "Core",           description: "System-level access controls",          icon: <ShieldCheck size={12} />, chip: "bg-red-100 text-red-700 border-red-200" },
    customers:   { label: "Customers",      description: "Customer and company record access",    icon: <Users size={12} />,       chip: "bg-blue-100 text-blue-700 border-blue-200" },
    tickets:     { label: "Tickets",        description: "Ticket workflow and ownership",         icon: <Ticket size={12} />,      chip: "bg-indigo-100 text-indigo-700 border-indigo-200" },
    assignments: { label: "Assignments",    description: "Work Inbox visibility scopes",         icon: <ClipboardList size={12} />,chip: "bg-emerald-100 text-emerald-700 border-emerald-200" },
    service:     { label: "Service",        description: "Service centers and warranty fields",   icon: <Wrench size={12} />,      chip: "bg-orange-100 text-orange-700 border-orange-200" },
    admin:       { label: "Administration", description: "System settings and user management",  icon: <Settings size={12} />,    chip: "bg-purple-100 text-purple-700 border-purple-200" },
};

const MODULE_ORDER = ["core", "customers", "tickets", "assignments", "service", "admin"];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RolesSettingsPage() {
    const [roles, setRoles] = useState<Role[]>([]);
    const [allPermissions, setAllPermissions] = useState<Permission[]>([]);
    const [loading, setLoading] = useState(true);

    const [addingNew, setAddingNew] = useState(false);
    const [newRole, setNewRole] = useState({ label: "", color: "bg-blue-100 text-blue-600" });
    const [saving, setSaving] = useState(false);

    const [permModalRoleId, setPermModalRoleId] = useState<string | null>(null);
    const [selectedPerms, setSelectedPerms] = useState<Set<string>>(new Set());
    const [savingPerms, setSavingPerms] = useState(false);
    const [permSearch, setPermSearch] = useState("");
    const [collapsedModules, setCollapsedModules] = useState<Set<string>>(new Set());
    const [originalPerms, setOriginalPerms] = useState<Set<string>>(new Set());

    const fetchData = async () => {
        try {
            const [rolesRes, permsRes] = await Promise.all([
                axios.get<Role[]>("/api/roles"),
                axios.get<Permission[]>("/api/permissions"),
            ]);
            setRoles(rolesRes.data);
            setAllPermissions(permsRes.data);
        } catch {
            toast.error("Failed to load roles");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(); }, []);

    const handleCreate = async () => {
        if (!newRole.label.trim()) return;
        setSaving(true);
        try {
            await axios.post("/api/roles", newRole);
            toast.success("Role created");
            setAddingNew(false);
            setNewRole({ label: "", color: "bg-blue-100 text-blue-600" });
            fetchData();
        } catch {
            toast.error("Failed to create role");
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Delete this role? Users assigned this role will lose it.")) return;
        try {
            await axios.delete(`/api/roles/${id}`);
            toast.success("Role deleted");
            fetchData();
        } catch (e: unknown) {
            const msg = axios.isAxiosError(e) ? e.response?.data?.error : "Failed to delete role";
            toast.error(msg);
        }
    };

    const openPermModal = (role: Role) => {
        setPermModalRoleId(role.id);
        const perms = new Set(role.permissions.map((p) => p.permissionId));
        setSelectedPerms(perms);
        setOriginalPerms(perms);
        setPermSearch("");
        setCollapsedModules(new Set());
    };

    const closePermModal = () => {
        setPermModalRoleId(null);
        setPermSearch("");
        setCollapsedModules(new Set());
    };

    const togglePerm = (id: string) =>
        setSelectedPerms(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });

    const toggleModule = (module: string) =>
        setCollapsedModules(prev => {
            const next = new Set(prev);
            next.has(module) ? next.delete(module) : next.add(module);
            return next;
        });

    const selectAllInModule = (perms: Permission[]) =>
        setSelectedPerms(prev => { const n = new Set(prev); perms.forEach(p => n.add(p.id)); return n; });

    const deselectAllInModule = (perms: Permission[]) =>
        setSelectedPerms(prev => { const n = new Set(prev); perms.forEach(p => n.delete(p.id)); return n; });

    const hasChanges = () => {
        if (selectedPerms.size !== originalPerms.size) return true;
        for (const p of selectedPerms) if (!originalPerms.has(p)) return true;
        return false;
    };

    const handleSavePerms = async () => {
        if (!permModalRoleId) return;
        setSavingPerms(true);
        try {
            await axios.put(`/api/roles/${permModalRoleId}/permissions`, {
                permissionIds: [...selectedPerms],
            });
            toast.success("Permissions updated");
            closePermModal();
            fetchData();
        } catch {
            toast.error("Failed to update permissions");
        } finally {
            setSavingPerms(false);
        }
    };

    // ── Modal derived state ───────────────────────────────────────────────────
    const modalRole = roles.find(r => r.id === permModalRoleId);
    const hasBypass = selectedPerms.has("admin:bypass");
    const selectedCount = selectedPerms.size;
    const totalCount = allPermissions.length;

    const filteredPerms = permSearch.trim()
        ? allPermissions.filter(p =>
            [p.label, p.id, p.module, p.description ?? ""]
                .some(s => s.toLowerCase().includes(permSearch.toLowerCase()))
        )
        : allPermissions;

    const byModule = filteredPerms.reduce<Record<string, Permission[]>>((acc, p) => {
        (acc[p.module] ??= []).push(p);
        return acc;
    }, {});

    const orderedModules = [
        ...MODULE_ORDER.filter(m => byModule[m]),
        ...Object.keys(byModule).filter(m => !MODULE_ORDER.includes(m)),
    ];

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">
                Loading roles…
            </div>
        );
    }

    return (
        <div className="max-w-3xl space-y-6">

            {/* ── Page header ─────────────────────────────────────────────── */}
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-gray-900">
                        Roles &amp; Permissions
                    </h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Define what each role can do. System roles cannot be deleted.
                    </p>
                </div>
                <Button onClick={() => setAddingNew(true)}>
                    <Plus /> New Role
                </Button>
            </div>

            {/* ── New role form ────────────────────────────────────────────── */}
            {addingNew && (
                <Card className="border-blue-200 bg-blue-50/50 shadow-sm">
                    <CardContent className="pt-5 pb-4">
                        <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-3">
                            New Role
                        </p>
                        <div className="flex flex-wrap gap-3 items-end">
                            {/* Label */}
                            <div className="flex-1 min-w-48">
                                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                                    Role name
                                </label>
                                <Input
                                    autoFocus
                                    value={newRole.label}
                                    onChange={(e) => setNewRole(r => ({ ...r, label: e.target.value }))}
                                    onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                                    placeholder="e.g. Senior Technician"
                                    className="bg-white"
                                />
                            </div>

                            {/* Colour picker */}
                            <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                                    Colour
                                </label>
                                <div className="flex gap-1.5 flex-wrap">
                                    {COLOR_OPTIONS.map(c => (
                                        <button
                                            key={c.value}
                                            type="button"
                                            title={c.label}
                                            onClick={() => setNewRole(r => ({ ...r, color: c.value }))}
                                            className={[
                                                "h-7 w-7 rounded-full border-2 transition-all duration-150",
                                                c.dot,
                                                newRole.color === c.value
                                                    ? "border-gray-800 ring-2 ring-gray-300 ring-offset-1 scale-110"
                                                    : "border-white hover:scale-105 hover:border-gray-300",
                                            ].join(" ")}
                                        />
                                    ))}
                                </div>
                            </div>

                            {/* Preview */}
                            {newRole.label && (
                                <Badge className={newRole.color}>{newRole.label}</Badge>
                            )}

                            {/* Actions */}
                            <div className="flex gap-2 ml-auto">
                                <Button variant="outline" size="sm" onClick={() => setAddingNew(false)}>
                                    Cancel
                                </Button>
                                <Button size="sm" disabled={saving || !newRole.label.trim()} onClick={handleCreate}>
                                    {saving ? "Creating…" : "Create Role"}
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* ── Role list ────────────────────────────────────────────────── */}
            <div className="space-y-2.5">
                {roles.map((role) => {
                    const accent = ROLE_ACCENT[role.color] ?? "border-l-gray-300";
                    return (
                        <Card
                            key={role.id}
                            className={`border-l-4 ${accent} transition-shadow duration-150 hover:shadow-md`}
                        >
                            <CardContent className="py-3.5 flex items-center gap-4">
                                {/* Role badge */}
                                <Badge className={`${role.color} shrink-0 font-mono text-xs`}>
                                    {role.id}
                                </Badge>

                                {/* Info */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="font-semibold text-sm text-gray-900">
                                            {role.label}
                                        </span>
                                        {role.isSystem && (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400 bg-gray-100 rounded-full px-1.5 py-0.5">
                                                <Lock size={9} /> System
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-1">
                                        <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded-full px-2 py-0.5">
                                            <Users size={9} />
                                            {role._count.users} {role._count.users === 1 ? "user" : "users"}
                                        </span>
                                        <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded-full px-2 py-0.5">
                                            <Shield size={9} />
                                            {role.permissions.length} permissions
                                        </span>
                                    </div>
                                </div>

                                {/* Actions */}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => openPermModal(role)}
                                    className="shrink-0"
                                >
                                    <Shield size={13} />
                                    Permissions
                                </Button>

                                {!role.isSystem && (
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        onClick={() => handleDelete(role.id)}
                                        className="shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                        title="Delete role"
                                    >
                                        <Trash2 size={14} />
                                    </Button>
                                )}
                            </CardContent>
                        </Card>
                    );
                })}
            </div>

            {/* ── Permissions Dialog ───────────────────────────────────────── */}
            <Dialog open={!!permModalRoleId} onOpenChange={(open) => !open && closePermModal()}>
                <DialogContent
                    showCloseButton={false}
                    className="sm:max-w-2xl max-h-[88vh] p-0 gap-0 flex flex-col overflow-hidden"
                >
                    {/* Header */}
                    <DialogHeader className="flex-row items-start justify-between gap-4 space-y-0 border-b px-6 py-4">
                        <div>
                            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
                                Permissions
                                {modalRole && (
                                    <Badge className={modalRole.color}>{modalRole.label}</Badge>
                                )}
                            </DialogTitle>
                            <DialogDescription className="mt-0.5 text-xs">
                                {selectedCount} of {totalCount} selected
                                {hasChanges() && (
                                    <span className="ml-2 font-medium text-blue-600">· unsaved changes</span>
                                )}
                            </DialogDescription>
                        </div>
                        <DialogClose asChild>
                            <Button variant="ghost" size="icon-sm" className="shrink-0 mt-0.5">
                                <X size={15} />
                            </Button>
                        </DialogClose>
                    </DialogHeader>

                    {/* admin:bypass warning */}
                    {hasBypass && (
                        <div className="mx-6 mt-4 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-red-500" />
                            <p className="text-xs leading-relaxed text-red-700">
                                <span className="font-semibold">admin:bypass is active.</span>{" "}
                                This role skips every permission check in the system.
                                All other permissions are redundant while this is enabled.
                            </p>
                        </div>
                    )}

                    {/* Search + bulk */}
                    <div className="flex gap-2 border-b bg-muted/30 px-6 py-3">
                        <div className="relative flex-1">
                            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                value={permSearch}
                                onChange={(e) => setPermSearch(e.target.value)}
                                placeholder="Search permissions…"
                                className="pl-8 h-8 bg-white text-sm"
                            />
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedPerms(new Set(allPermissions.map(p => p.id)))}
                        >
                            Select all
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedPerms(new Set())}
                        >
                            Clear
                        </Button>
                    </div>

                    {/* Scrollable list */}
                    <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
                        {orderedModules.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                                <Search size={32} className="mb-3 opacity-20" />
                                <p className="text-sm">No permissions match your search</p>
                            </div>
                        ) : (
                            orderedModules.map((module) => {
                                const perms = byModule[module];
                                const meta = MODULE_META[module];
                                const selectedInModule = perms.filter(p => selectedPerms.has(p.id)).length;
                                const isAllSelected = selectedInModule === perms.length;
                                const isCollapsed = collapsedModules.has(module);

                                return (
                                    <div key={module} className="overflow-hidden rounded-xl border bg-white shadow-sm">
                                        {/* Module header */}
                                        <div className={`flex items-center gap-2 border-b px-3 py-2.5 ${meta?.chip ?? "bg-gray-50 text-gray-700 border-gray-200"}`}>
                                            <button
                                                onClick={() => toggleModule(module)}
                                                className="flex items-center justify-center opacity-70 hover:opacity-100 transition-opacity"
                                            >
                                                {isCollapsed
                                                    ? <ChevronRight size={13} />
                                                    : <ChevronDown size={13} />}
                                            </button>
                                            <span className="opacity-80">{meta?.icon}</span>
                                            <div className="flex-1 min-w-0">
                                                <span className="text-xs font-bold uppercase tracking-wider">
                                                    {meta?.label ?? module}
                                                </span>
                                                {!permSearch && meta?.description && (
                                                    <span className="ml-2 text-[10px] font-normal normal-case tracking-normal opacity-70">
                                                        {meta.description}
                                                    </span>
                                                )}
                                            </div>
                                            <span className="text-[11px] font-semibold tabular-nums opacity-70">
                                                {selectedInModule}/{perms.length}
                                            </span>
                                            <button
                                                onClick={() => isAllSelected
                                                    ? deselectAllInModule(perms)
                                                    : selectAllInModule(perms)
                                                }
                                                className="ml-1 rounded-md px-2 py-0.5 text-xs font-medium hover:bg-black/10 transition-colors"
                                            >
                                                {isAllSelected ? "None" : "All"}
                                            </button>
                                        </div>

                                        {/* Permission rows */}
                                        {!isCollapsed && (
                                            <div className="divide-y divide-gray-100">
                                                {perms.map((p) => {
                                                    const isSelected = selectedPerms.has(p.id);
                                                    const isDangerous = p.id === "admin:bypass";

                                                    return (
                                                        <button
                                                            key={p.id}
                                                            type="button"
                                                            onClick={() => togglePerm(p.id)}
                                                            className={[
                                                                "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors",
                                                                isDangerous
                                                                    ? isSelected
                                                                        ? "bg-red-50/70 hover:bg-red-50"
                                                                        : "hover:bg-red-50/40"
                                                                    : isSelected
                                                                        ? "bg-blue-50/60 hover:bg-blue-50"
                                                                        : "hover:bg-gray-50",
                                                            ].join(" ")}
                                                        >
                                                            {/* Custom checkbox */}
                                                            <div className={[
                                                                "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition-all duration-150",
                                                                isSelected
                                                                    ? isDangerous
                                                                        ? "border-red-500 bg-red-500"
                                                                        : "border-blue-600 bg-blue-600"
                                                                    : "border-gray-300 hover:border-gray-400",
                                                            ].join(" ")}>
                                                                {isSelected && (
                                                                    <Check size={10} strokeWidth={3} className="text-white" />
                                                                )}
                                                            </div>

                                                            {/* Text */}
                                                            <div className="min-w-0 flex-1">
                                                                <div className="flex items-center gap-2 flex-wrap">
                                                                    <span className={[
                                                                        "text-sm font-medium leading-none",
                                                                        isDangerous && isSelected ? "text-red-800"
                                                                            : isSelected ? "text-gray-900"
                                                                                : "text-gray-600",
                                                                    ].join(" ")}>
                                                                        {p.label}
                                                                    </span>
                                                                    {isDangerous && (
                                                                        <Badge variant="destructive" className="h-4 px-1.5 text-[10px]">
                                                                            Dangerous
                                                                        </Badge>
                                                                    )}
                                                                </div>
                                                                {p.description && (
                                                                    <p className="mt-1 text-xs leading-relaxed text-gray-400">
                                                                        {p.description}
                                                                    </p>
                                                                )}
                                                                <p className="mt-1 font-mono text-[10px] text-gray-300 select-all">
                                                                    {p.id}
                                                                </p>
                                                            </div>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>

                    {/* Footer */}
                    <div className="flex gap-2.5 border-t bg-muted/30 px-6 py-4">
                        <DialogClose asChild>
                            <Button variant="outline" className="flex-1">
                                Cancel
                            </Button>
                        </DialogClose>
                        <Button
                            onClick={handleSavePerms}
                            disabled={savingPerms || !hasChanges()}
                            className="flex-1"
                        >
                            {savingPerms
                                ? "Saving…"
                                : hasChanges()
                                    ? `Save ${selectedCount} permission${selectedCount !== 1 ? "s" : ""}`
                                    : "No changes"}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
