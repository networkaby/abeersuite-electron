"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
    Plus, Trash2, Shield, X, Search,
    ChevronDown, ChevronRight, CheckSquare, Square,
    AlertTriangle, Users, Ticket, ClipboardList,
    Building2, Settings, ShieldCheck, UserCog, Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

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

const COLOR_OPTIONS = [
    { label: "Gray",   value: "bg-gray-100 text-gray-600" },
    { label: "Blue",   value: "bg-blue-100 text-blue-600" },
    { label: "Green",  value: "bg-green-100 text-green-600" },
    { label: "Red",    value: "bg-red-100 text-red-600" },
    { label: "Purple", value: "bg-purple-100 text-purple-600" },
    { label: "Orange", value: "bg-orange-100 text-orange-600" },
    { label: "Yellow", value: "bg-yellow-100 text-yellow-600" },
    { label: "Teal",   value: "bg-teal-100 text-teal-600" },
];

const MODULE_META: Record<string, { label: string; description: string; icon: React.ReactNode; headerColor: string }> = {
    core:        { label: "Core",          description: "System-level access controls",               icon: <ShieldCheck size={13} />, headerColor: "bg-red-50 border-red-200 text-red-700" },
    customers:   { label: "Customers",     description: "Customer and company record access",         icon: <Users size={13} />,       headerColor: "bg-blue-50 border-blue-200 text-blue-700" },
    tickets:     { label: "Tickets",       description: "Ticket workflow and ownership actions",      icon: <Ticket size={13} />,      headerColor: "bg-indigo-50 border-indigo-200 text-indigo-700" },
    assignments: { label: "Assignments",   description: "Work Inbox visibility scopes",              icon: <ClipboardList size={13} />, headerColor: "bg-green-50 border-green-200 text-green-700" },
    service:     { label: "Service",       description: "Service centers and warranty fields",        icon: <Wrench size={13} />,      headerColor: "bg-orange-50 border-orange-200 text-orange-700" },
    admin:       { label: "Administration",description: "System settings and user management",       icon: <Settings size={13} />,    headerColor: "bg-purple-50 border-purple-200 text-purple-700" },
};

const MODULE_ORDER = ["core", "customers", "tickets", "assignments", "service", "admin"];

export default function RolesSettingsPage() {
    const [roles, setRoles] = useState<Role[]>([]);
    const [allPermissions, setAllPermissions] = useState<Permission[]>([]);
    const [loading, setLoading] = useState(true);

    const [addingNew, setAddingNew] = useState(false);
    const [newRole, setNewRole] = useState({ label: "", color: "bg-gray-100 text-gray-600" });
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
            setNewRole({ label: "", color: "bg-gray-100 text-gray-600" });
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

    const toggleModule = (module: string) =>
        setCollapsedModules(prev => {
            const next = new Set(prev);
            next.has(module) ? next.delete(module) : next.add(module);
            return next;
        });

    const selectAllInModule = (perms: Permission[]) =>
        setSelectedPerms(prev => { const next = new Set(prev); perms.forEach(p => next.add(p.id)); return next; });

    const deselectAllInModule = (perms: Permission[]) =>
        setSelectedPerms(prev => { const next = new Set(prev); perms.forEach(p => next.delete(p.id)); return next; });

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

    if (loading) return <p className="text-gray-500 text-sm">Loading...</p>;

    return (
        <div className="max-w-3xl">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Roles</h1>
                    <p className="text-sm text-gray-500 mt-1">
                        Manage roles and their permissions. System roles cannot be deleted.
                    </p>
                </div>
                <button
                    onClick={() => setAddingNew(true)}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700"
                >
                    <Plus size={16} /> New Role
                </button>
            </div>

            {/* New role form */}
            {addingNew && (
                <div className="bg-white rounded-xl border p-4 mb-4 flex gap-3 items-end">
                    <div className="flex-1">
                        <label className="block text-xs font-medium text-gray-600 mb-1">Label</label>
                        <input
                            autoFocus
                            value={newRole.label}
                            onChange={(e) => setNewRole((r) => ({ ...r, label: e.target.value }))}
                            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="e.g. Senior Technician"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Colour</label>
                        <select
                            value={newRole.color}
                            onChange={(e) => setNewRole((r) => ({ ...r, color: e.target.value }))}
                            className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                            {COLOR_OPTIONS.map((c) => (
                                <option key={c.value} value={c.value}>{c.label}</option>
                            ))}
                        </select>
                    </div>
                    <button
                        onClick={handleCreate}
                        disabled={saving}
                        className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
                    >
                        {saving ? "Creating..." : "Create"}
                    </button>
                    <button onClick={() => setAddingNew(false)} className="text-gray-400 hover:text-gray-600 p-2">
                        <X size={16} />
                    </button>
                </div>
            )}

            {/* Role list */}
            <div className="space-y-2">
                {roles.map((role) => (
                    <div key={role.id} className="bg-white rounded-xl border px-5 py-4 flex items-center gap-4">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${role.color}`}>
                            {role.id}
                        </span>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900">{role.label}</p>
                            <p className="text-xs text-gray-400">
                                {role._count.users} {role._count.users === 1 ? "user" : "users"}
                                {" · "}{role.permissions.length} permissions
                                {role.isSystem && " · System role"}
                            </p>
                        </div>

                        <button
                            onClick={() => openPermModal(role)}
                            className="flex items-center gap-1.5 text-xs text-gray-600 border rounded-lg px-3 py-1.5 hover:bg-gray-50"
                        >
                            <Shield size={13} /> Permissions
                        </button>

                        {!role.isSystem && (
                            <button
                                onClick={() => handleDelete(role.id)}
                                className="text-red-400 hover:text-red-600 p-1"
                                title="Delete role"
                            >
                                <Trash2 size={15} />
                            </button>
                        )}
                    </div>
                ))}
            </div>

            {/* Permissions modal */}
            {permModalRoleId && (() => {
                const role = roles.find((r) => r.id === permModalRoleId);
                const hasBypass = selectedPerms.has("admin:bypass");

                const filtered = permSearch.trim()
                    ? allPermissions.filter(p =>
                        p.label.toLowerCase().includes(permSearch.toLowerCase()) ||
                        p.id.toLowerCase().includes(permSearch.toLowerCase()) ||
                        p.module.toLowerCase().includes(permSearch.toLowerCase()) ||
                        (p.description ?? "").toLowerCase().includes(permSearch.toLowerCase())
                    )
                    : allPermissions;

                // Group by module, respecting MODULE_ORDER
                const byModule = filtered.reduce<Record<string, Permission[]>>((acc, p) => {
                    (acc[p.module] ??= []).push(p);
                    return acc;
                }, {});
                const orderedModules = [
                    ...MODULE_ORDER.filter(m => byModule[m]),
                    ...Object.keys(byModule).filter(m => !MODULE_ORDER.includes(m)),
                ];

                const selectedCount = selectedPerms.size;
                const totalCount = allPermissions.length;

                return (
                    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">

                            {/* Header */}
                            <div className="flex items-center justify-between px-6 py-4 border-b">
                                <div>
                                    <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                                        Permissions
                                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${role?.color}`}>
                                            {role?.label}
                                        </span>
                                    </h2>
                                    <p className="text-xs text-gray-500 mt-0.5">
                                        {selectedCount} of {totalCount} permissions selected
                                        {hasChanges() && (
                                            <span className="ml-2 text-blue-600 font-medium">· unsaved changes</span>
                                        )}
                                    </p>
                                </div>
                                <button
                                    onClick={closePermModal}
                                    className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100"
                                >
                                    <X size={18} />
                                </button>
                            </div>

                            {/* admin:bypass warning */}
                            {hasBypass && (
                                <div className="mx-6 mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                                    <AlertTriangle size={15} className="mt-0.5 shrink-0 text-red-500" />
                                    <p className="text-xs text-red-700">
                                        <span className="font-semibold">admin:bypass is active.</span>{" "}
                                        This role skips every permission check in the system. All other permissions below are redundant while this is enabled.
                                    </p>
                                </div>
                            )}

                            {/* Search + bulk actions */}
                            <div className="px-6 py-3 border-b bg-gray-50 flex gap-3">
                                <div className="flex-1 relative">
                                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                    <input
                                        type="text"
                                        value={permSearch}
                                        onChange={(e) => setPermSearch(e.target.value)}
                                        placeholder="Search permissions…"
                                        className="w-full pl-9 pr-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                    />
                                </div>
                                <button
                                    onClick={() => setSelectedPerms(new Set(allPermissions.map(p => p.id)))}
                                    className="text-xs px-3 py-1.5 border rounded-lg hover:bg-white text-gray-600 flex items-center gap-1.5"
                                >
                                    <CheckSquare size={14} /> All
                                </button>
                                <button
                                    onClick={() => setSelectedPerms(new Set())}
                                    className="text-xs px-3 py-1.5 border rounded-lg hover:bg-white text-gray-600 flex items-center gap-1.5"
                                >
                                    <Square size={14} /> None
                                </button>
                            </div>

                            {/* Permission list */}
                            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
                                {orderedModules.length === 0 ? (
                                    <div className="py-12 text-center text-sm text-gray-400">
                                        No permissions match your search
                                    </div>
                                ) : (
                                    orderedModules.map((module) => {
                                        const perms = byModule[module];
                                        const meta = MODULE_META[module];
                                        const selectedInModule = perms.filter(p => selectedPerms.has(p.id)).length;
                                        const isAllSelected = selectedInModule === perms.length;
                                        const isCollapsed = collapsedModules.has(module);

                                        return (
                                            <div key={module} className="overflow-hidden rounded-lg border">
                                                {/* Module header */}
                                                <div className={`flex items-center gap-2 border-b px-3 py-2 ${meta?.headerColor ?? "bg-gray-50 border-gray-200 text-gray-700"}`}>
                                                    <button
                                                        onClick={() => toggleModule(module)}
                                                        className="opacity-60 hover:opacity-100 transition-opacity"
                                                    >
                                                        {isCollapsed
                                                            ? <ChevronRight size={14} />
                                                            : <ChevronDown size={14} />}
                                                    </button>
                                                    {meta?.icon && (
                                                        <span className="opacity-70">{meta.icon}</span>
                                                    )}
                                                    <div className="flex-1 min-w-0">
                                                        <span className="text-xs font-semibold uppercase tracking-wide">
                                                            {meta?.label ?? module}
                                                        </span>
                                                        {meta?.description && !permSearch && (
                                                            <span className="ml-2 text-[10px] opacity-70 normal-case tracking-normal font-normal">
                                                                {meta.description}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <span className="text-xs opacity-60 tabular-nums">
                                                        {selectedInModule}/{perms.length}
                                                    </span>
                                                    <button
                                                        onClick={() => isAllSelected
                                                            ? deselectAllInModule(perms)
                                                            : selectAllInModule(perms)
                                                        }
                                                        className="ml-2 rounded px-2 py-0.5 text-xs hover:bg-black/10 transition-colors"
                                                    >
                                                        {isAllSelected ? "None" : "All"}
                                                    </button>
                                                </div>

                                                {/* Permissions */}
                                                {!isCollapsed && (
                                                    <div className="divide-y divide-gray-100 bg-white">
                                                        {perms.map((p) => {
                                                            const isSelected = selectedPerms.has(p.id);
                                                            const isDangerous = p.id === "admin:bypass";

                                                            return (
                                                                <label
                                                                    key={p.id}
                                                                    className={`flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors ${
                                                                        isDangerous
                                                                            ? isSelected
                                                                                ? "bg-red-50/60 hover:bg-red-50"
                                                                                : "hover:bg-red-50/30"
                                                                            : isSelected
                                                                                ? "bg-blue-50/50 hover:bg-blue-50"
                                                                                : "hover:bg-gray-50"
                                                                    }`}
                                                                >
                                                                    {/* Checkbox */}
                                                                    <div
                                                                        onClick={(e) => {
                                                                            e.preventDefault();
                                                                            setSelectedPerms(prev => {
                                                                                const next = new Set(prev);
                                                                                isSelected ? next.delete(p.id) : next.add(p.id);
                                                                                return next;
                                                                            });
                                                                        }}
                                                                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition-colors ${
                                                                            isSelected
                                                                                ? isDangerous
                                                                                    ? "border-red-500 bg-red-500"
                                                                                    : "border-blue-600 bg-blue-600"
                                                                                : "border-gray-300 hover:border-gray-400"
                                                                        }`}
                                                                    >
                                                                        {isSelected && (
                                                                            <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                                                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                                                            </svg>
                                                                        )}
                                                                    </div>

                                                                    {/* Text */}
                                                                    <div className="min-w-0 flex-1">
                                                                        <div className="flex items-center gap-2">
                                                                            <span className={`text-sm font-medium ${
                                                                                isSelected
                                                                                    ? isDangerous ? "text-red-800" : "text-gray-900"
                                                                                    : "text-gray-600"
                                                                            }`}>
                                                                                {p.label}
                                                                            </span>
                                                                            {isDangerous && (
                                                                                <Badge variant="destructive" className="h-4 px-1.5 text-[10px]">
                                                                                    Dangerous
                                                                                </Badge>
                                                                            )}
                                                                        </div>
                                                                        {p.description && (
                                                                            <p className="mt-0.5 text-xs text-gray-400">{p.description}</p>
                                                                        )}
                                                                        <p className="mt-0.5 font-mono text-[10px] text-gray-300">{p.id}</p>
                                                                    </div>
                                                                </label>
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
                            <div className="flex gap-3 border-t bg-gray-50 px-6 py-4">
                                <button
                                    onClick={closePermModal}
                                    className="flex-1 rounded-lg border py-2 text-sm text-gray-600 hover:bg-white"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSavePerms}
                                    disabled={savingPerms || !hasChanges()}
                                    className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                                >
                                    {savingPerms
                                        ? "Saving…"
                                        : hasChanges()
                                            ? `Save ${selectedCount} permission${selectedCount !== 1 ? "s" : ""}`
                                            : "No changes"}
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}
