"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Trash2, Shield, X } from "lucide-react";

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
        setSelectedPerms(new Set(role.permissions.map((p) => p.permissionId)));
    };

    const handleSavePerms = async () => {
        if (!permModalRoleId) return;
        setSavingPerms(true);
        try {
            await axios.put(`/api/roles/${permModalRoleId}/permissions`, {
                permissionIds: [...selectedPerms],
            });
            toast.success("Permissions updated");
            setPermModalRoleId(null);
            fetchData();
        } catch {
            toast.error("Failed to update permissions");
        } finally {
            setSavingPerms(false);
        }
    };

    const permissionsByModule = allPermissions.reduce<Record<string, Permission[]>>((acc, p) => {
        (acc[p.module] ??= []).push(p);
        return acc;
    }, {});

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
                return (
                    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                        <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[85vh] flex flex-col">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-base font-semibold">
                                    Permissions — <span className={`text-xs px-2 py-0.5 rounded-full ${role?.color}`}>{role?.label}</span>
                                </h2>
                                <button onClick={() => setPermModalRoleId(null)} className="text-gray-400 hover:text-gray-600">
                                    <X size={18} />
                                </button>
                            </div>

                            <div className="overflow-y-auto flex-1 space-y-4 pr-1">
                                {Object.entries(permissionsByModule).map(([module, perms]) => (
                                    <div key={module}>
                                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{module}</p>
                                        <div className="space-y-1">
                                            {perms.map((p) => (
                                                <label key={p.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedPerms.has(p.id)}
                                                        onChange={(e) => {
                                                            setSelectedPerms((prev) => {
                                                                const next = new Set(prev);
                                                                e.target.checked ? next.add(p.id) : next.delete(p.id);
                                                                return next;
                                                            });
                                                        }}
                                                        className="rounded"
                                                    />
                                                    <div>
                                                        <p className="text-sm text-gray-800">{p.label}</p>
                                                        <p className="text-xs text-gray-400 font-mono">{p.id}</p>
                                                    </div>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="flex gap-3 pt-4 border-t mt-4">
                                <button
                                    onClick={() => setPermModalRoleId(null)}
                                    className="flex-1 border rounded-lg py-2 text-sm hover:bg-gray-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSavePerms}
                                    disabled={savingPerms}
                                    className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm hover:bg-blue-700 disabled:opacity-50"
                                >
                                    {savingPerms ? "Saving..." : "Save permissions"}
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}
