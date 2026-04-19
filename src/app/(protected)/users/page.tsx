"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Plus, Pencil, Trash2, ShieldCheck, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import UserForm from "@/components/UserForm";
import { formatDate } from "@/lib/format-date";

interface User {
    id: number;
    name: string;
    email: string;
    role: string;
    createdAt: string;
    userRole: { label: string; color: string };
}

interface PermRow {
    id: string;
    label: string;
    module: string;
    description: string | null;
    roleGranted: boolean;
    userOverride: boolean | null;
    effective: boolean;
}

function PermissionsModal({ user, onClose }: { user: User; onClose: () => void }) {
    const [perms, setPerms] = useState<PermRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    // local overrides: permissionId → true | false | null (null = clear override)
    const [overrides, setOverrides] = useState<Map<string, boolean | null>>(new Map());

    useEffect(() => {
        axios.get(`/api/users/${user.id}/permissions`)
            .then(r => setPerms(r.data))
            .catch(() => toast.error("Failed to load permissions"))
            .finally(() => setLoading(false));
    }, [user.id]);

    const toggle = (permId: string, current: boolean | null, roleGranted: boolean) => {
        setOverrides(prev => {
            const next = new Map(prev);
            if (current === null) {
                // No override → grant explicitly
                next.set(permId, true);
            } else if (current === true && !roleGranted) {
                // Explicit grant (not from role) → deny
                next.set(permId, false);
            } else if (current === false) {
                // Explicit deny → clear override
                next.set(permId, null);
            } else {
                // Role-granted & true → deny
                next.set(permId, false);
            }
            return next;
        });
    };

    const save = async () => {
        if (overrides.size === 0) { onClose(); return; }
        setSaving(true);
        try {
            const payload = Array.from(overrides.entries()).map(([permissionId, granted]) => ({ permissionId, granted }));
            await axios.put(`/api/users/${user.id}/permissions`, { overrides: payload });
            toast.success("Permissions saved");
            onClose();
        } catch {
            toast.error("Failed to save permissions");
        } finally {
            setSaving(false);
        }
    };

    // Group by module
    const grouped = perms.reduce<Record<string, PermRow[]>>((acc, p) => {
        (acc[p.module] ??= []).push(p);
        return acc;
    }, {});

    return (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col">
                <div className="flex items-center justify-between px-6 py-4 border-b">
                    <div>
                        <h2 className="font-semibold text-gray-800">Permissions — {user.name}</h2>
                        <p className="text-xs text-gray-400 mt-0.5">Role grants are read-only. Overrides add or deny individual permissions.</p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
                </div>

                <div className="overflow-y-auto flex-1 px-6 py-4">
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 size={24} className="animate-spin text-gray-400" />
                        </div>
                    ) : (
                        <div className="space-y-5">
                            {Object.entries(grouped).map(([module, rows]) => (
                                <div key={module}>
                                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{module}</p>
                                    <div className="space-y-1">
                                        {rows.map(p => {
                                            const localOverride = overrides.get(p.id);
                                            const displayOverride = localOverride !== undefined ? localOverride : p.userOverride;
                                            const effective = displayOverride !== null ? !!displayOverride : p.roleGranted;

                                            return (
                                                <div
                                                    key={p.id}
                                                    className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer hover:bg-gray-50 ${
                                                        effective ? "opacity-100" : "opacity-50"
                                                    }`}
                                                    onClick={() => toggle(p.id, displayOverride, p.roleGranted)}
                                                >
                                                    {/* Checkbox visual */}
                                                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${
                                                        effective
                                                            ? "bg-blue-600 border-blue-600"
                                                            : "border-gray-300"
                                                    }`}>
                                                        {effective && <div className="w-2 h-2 bg-white rounded-sm" />}
                                                    </div>

                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-medium text-gray-700">{p.label}</p>
                                                        {p.description && <p className="text-xs text-gray-400 truncate">{p.description}</p>}
                                                    </div>

                                                    {/* Source badge */}
                                                    <div className="shrink-0 flex gap-1">
                                                        {p.roleGranted && (
                                                            <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700">Role</span>
                                                        )}
                                                        {displayOverride !== null && (
                                                            <span className={`text-xs px-1.5 py-0.5 rounded ${
                                                                displayOverride ? "bg-blue-100 text-blue-700" : "bg-red-100 text-red-600"
                                                            }`}>
                                                                {displayOverride ? "+Grant" : "Deny"}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="px-6 py-4 border-t flex gap-3">
                    <button onClick={onClose} className="flex-1 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
                    <button
                        onClick={save}
                        disabled={saving || overrides.size === 0}
                        className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40 flex items-center justify-center gap-2"
                    >
                        {saving && <Loader2 size={14} className="animate-spin" />}
                        {overrides.size === 0 ? "No changes" : `Save ${overrides.size} change${overrides.size !== 1 ? "s" : ""}`}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function UsersPage() {
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editUser, setEditUser] = useState<User | null>(null);
    const [permUser, setPermUser] = useState<User | null>(null);

    const fetchUsers = async () => {
        try {
            const res = await axios.get("/api/users");
            setUsers(res.data);
        } catch {
            toast.error("Failed to load users");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchUsers(); }, []);

    const handleDelete = async (id: number) => {
        if (!confirm("Delete this user?")) return;
        try {
            await axios.delete(`/api/users/${id}`);
            toast.success("User deleted");
            fetchUsers();
        } catch {
            toast.error("Failed to delete user");
        }
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-3xl font-bold">Users</h1>
                <button
                    onClick={() => setShowForm(true)}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
                >
                    <Plus size={18} />
                    Add User
                </button>
            </div>

            {(showForm || editUser) && (
                <UserForm
                    user={editUser ?? undefined}
                    onClose={() => { setShowForm(false); setEditUser(null); fetchUsers(); }}
                />
            )}

            {permUser && (
                <PermissionsModal user={permUser} onClose={() => setPermUser(null)} />
            )}

            {loading ? (
                <p className="text-gray-500">Loading...</p>
            ) : (
                <div className="bg-white rounded-lg shadow overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
                            <tr>
                                <th className="px-6 py-3 text-left">#</th>
                                <th className="px-6 py-3 text-left">Name</th>
                                <th className="px-6 py-3 text-left">Email</th>
                                <th className="px-6 py-3 text-left">Role</th>
                                <th className="px-6 py-3 text-left">Joined</th>
                                <th className="px-6 py-3 text-left">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {users.map((u) => (
                                <tr key={u.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 text-gray-400">{u.id}</td>
                                    <td className="px-6 py-4 font-medium">{u.name}</td>
                                    <td className="px-6 py-4 text-gray-500">{u.email}</td>
                                    <td className="px-6 py-4">
                                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${u.userRole.color}`}>
                                            {u.userRole.label}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-gray-400">{formatDate(u.createdAt)}</td>
                                    <td className="px-6 py-4">
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => setPermUser(u)}
                                                className="p-1.5 rounded hover:bg-purple-50 text-purple-500"
                                                title="Manage permissions"
                                            >
                                                <ShieldCheck size={15} />
                                            </button>
                                            <button
                                                onClick={() => setEditUser(u)}
                                                className="p-1.5 rounded hover:bg-blue-50 text-blue-600"
                                            >
                                                <Pencil size={15} />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(u.id)}
                                                className="p-1.5 rounded hover:bg-red-50 text-red-500"
                                            >
                                                <Trash2 size={15} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
