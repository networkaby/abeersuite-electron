"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Trash2, Shield, X, Search, ChevronDown, ChevronRight, CheckSquare, Square } from "lucide-react";

interface Permission {
    id: string;
    label: string;
    module: string;
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

    const toggleModule = (module: string) => {
        setCollapsedModules(prev => {
            const next = new Set(prev);
            next.has(module) ? next.delete(module) : next.add(module);
            return next;
        });
    };

    const selectAllInModule = (module: string, perms: Permission[]) => {
        setSelectedPerms(prev => {
            const next = new Set(prev);
            perms.forEach(p => next.add(p.id));
            return next;
        });
    };

    const deselectAllInModule = (module: string, perms: Permission[]) => {
        setSelectedPerms(prev => {
            const next = new Set(prev);
            perms.forEach(p => next.delete(p.id));
            return next;
        });
    };

    const selectAllPermissions = () => {
        setSelectedPerms(new Set(allPermissions.map(p => p.id)));
    };

    const deselectAllPermissions = () => {
        setSelectedPerms(new Set());
    };

    const hasChanges = () => {
        if (selectedPerms.size !== originalPerms.size) return true;
        for (const perm of selectedPerms) {
            if (!originalPerms.has(perm)) return true;
        }
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
                    <p className="text-sm text-gray-500 mt-1">Manage roles and their permissions. System roles cannot be deleted.</p>
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
                    <button
                        onClick={() => setAddingNew(false)}
                        className="text-gray-400 hover:text-gray-600 p-2"
                    >
                        <X size={16} />
                    </button>
                </div>
            )}

            <div className="space-y-2">
                {roles.map((role) => (
                    <div key={role.id} className="bg-white rounded-xl border px-5 py-4 flex items-center gap-4">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${role.color}`}>
                            {role.id}
                        </span>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900">{role.label}</p>
                            <p className="text-xs text-gray-400">
                                {role._count.users} {role._count.users === 1 ? "user" : "users"} &middot; {role.permissions.length} permissions
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
                const filteredPermissions = permSearch.trim()
                    ? allPermissions.filter(p =>
                        p.label.toLowerCase().includes(permSearch.toLowerCase()) ||
                        p.id.toLowerCase().includes(permSearch.toLowerCase()) ||
                        p.module.toLowerCase().includes(permSearch.toLowerCase())
                    )
                    : allPermissions;
                const filteredByModule = filteredPermissions.reduce<Record<string, Permission[]>>((acc, p) => {
                    (acc[p.module] ??= []).push(p);
                    return acc;
                }, {});
                const selectedCount = selectedPerms.size;
                const totalCount = allPermissions.length;

                return (
                    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
                            {/* Header */}
                            <div className="flex items-center justify-between px-6 py-4 border-b">
                                <div>
                                    <h2 className="text-base font-semibold text-gray-900">
                                        Permissions — <span className={`text-xs px-2 py-0.5 rounded-full ${role?.color}`}>{role?.label}</span>
                                    </h2>
                                    <p className="text-xs text-gray-500 mt-0.5">
                                        {selectedCount} of {totalCount} permissions selected
                                        {hasChanges() && <span className="ml-2 text-blue-600 font-medium">• unsaved changes</span>}
                                    </p>
                                </div>
                                <button onClick={closePermModal} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">
                                    <X size={18} />
                                </button>
                            </div>

                            {/* Search and global actions */}
                            <div className="px-6 py-3 border-b bg-gray-50 flex gap-3">
                                <div className="flex-1 relative">
                                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                    <input
                                        type="text"
                                        value={permSearch}
                                        onChange={(e) => setPermSearch(e.target.value)}
                                        placeholder="Search permissions..."
                                        className="w-full pl-9 pr-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                    />
                                </div>
                                <button
                                    onClick={selectAllPermissions}
                                    className="text-xs px-3 py-1.5 border rounded-lg hover:bg-white text-gray-600 flex items-center gap-1.5"
                                    title="Select all permissions"
                                >
                                    <CheckSquare size={14} /> All
                                </button>
                                <button
                                    onClick={deselectAllPermissions}
                                    className="text-xs px-3 py-1.5 border rounded-lg hover:bg-white text-gray-600 flex items-center gap-1.5"
                                    title="Deselect all permissions"
                                >
                                    <Square size={14} /> None
                                </button>
                            </div>

                            {/* Permissions list */}
                            <div className="overflow-y-auto flex-1 px-6 py-4 space-y-3">
                                {Object.entries(filteredByModule).length === 0 ? (
                                    <div className="text-center py-12 text-gray-500">
                                        <p className="text-sm">No permissions match your search</p>
                                    </div>
                                ) : (
                                    Object.entries(filteredByModule).map(([module, perms]) => {
                                        const moduleSelected = perms.filter(p => selectedPerms.has(p.id)).length;
                                        const moduleTotal = perms.length;
                                        const isAllSelected = moduleSelected === moduleTotal;
                                        const isCollapsed = collapsedModules.has(module);

                                        return (
                                            <div key={module} className="border rounded-lg overflow-hidden">
                                                {/* Module header */}
                                                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b">
                                                    <button
                                                        onClick={() => toggleModule(module)}
                                                        className="text-gray-400 hover:text-gray-600 p-0.5"
                                                    >
                                                        {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                                    </button>
                                                    <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide flex-1">{module}</span>
                                                    <span className="text-xs text-gray-500">{moduleSelected}/{moduleTotal}</span>
                                                    <button
                                                        onClick={() => isAllSelected ? deselectAllInModule(module, perms) : selectAllInModule(module, perms)}
                                                        className="text-xs px-2 py-1 rounded hover:bg-gray-200 text-gray-600 ml-2"
                                                        title={isAllSelected ? "Deselect all in module" : "Select all in module"}
                                                    >
                                                        {isAllSelected ? "None" : "All"}
                                                    </button>
                                                </div>

                                                {/* Module permissions */}
                                                {!isCollapsed && (
                                                    <div className="divide-y divide-gray-100">
                                                        {perms.map((p) => {
                                                            const isSelected = selectedPerms.has(p.id);
                                                            return (
                                                                <label
                                                                    key={p.id}
                                                                    className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
                                                                        isSelected ? "bg-blue-50/50 hover:bg-blue-50" : "hover:bg-gray-50"
                                                                    }`}
                                                                >
                                                                    <div
                                                                        onClick={(e) => {
                                                                            e.preventDefault();
                                                                            setSelectedPerms((prev) => {
                                                                                const next = new Set(prev);
                                                                                isSelected ? next.delete(p.id) : next.add(p.id);
                                                                                return next;
                                                                            });
                                                                        }}
                                                                        className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                                                                            isSelected
                                                                                ? "bg-blue-600 border-blue-600"
                                                                                : "border-gray-300 hover:border-gray-400"
                                                                        }`}
                                                                    >
                                                                        {isSelected && (
                                                                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                                                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                                                            </svg>
                                                                        )}
                                                                    </div>
                                                                    <div className="flex-1 min-w-0">
                                                                        <p className={`text-sm font-medium ${isSelected ? "text-gray-900" : "text-gray-600"}`}>
                                                                            {p.label}
                                                                        </p>
                                                                        <p className="text-xs text-gray-400 font-mono">{p.id}</p>
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
                            <div className="flex gap-3 px-6 py-4 border-t bg-gray-50">
                                <button
                                    onClick={closePermModal}
                                    className="flex-1 border rounded-lg py-2 text-sm hover:bg-white text-gray-600"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSavePerms}
                                    disabled={savingPerms || !hasChanges()}
                                    className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm hover:bg-blue-700 disabled:opacity-50 font-medium"
                                >
                                    {savingPerms ? "Saving..." : hasChanges() ? `Save ${selectedCount} permission${selectedCount !== 1 ? "s" : ""}` : "No changes"}
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}
