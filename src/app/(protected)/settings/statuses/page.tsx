"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Trash2, Save, X, ArrowUpDown, GitMerge, Users } from "lucide-react";

interface TicketStatus {
    id: string;
    label: string;
    color: string;
    order: number;
    isTerminal: boolean;
    allowedRoles: string[];
    notifyRoles: string[];
    actionLabel: string | null;
    warrantyScope: string;
    fromTransitions: { toStatusId: string; to: { label: string } }[];
    _count: { tickets: number };
}

const COLOR_OPTIONS = [
    { label: "Gray", value: "bg-gray-100 text-gray-600" },
    { label: "Blue", value: "bg-blue-100 text-blue-600" },
    { label: "Yellow", value: "bg-yellow-100 text-yellow-600" },
    { label: "Orange", value: "bg-orange-100 text-orange-600" },
    { label: "Purple", value: "bg-purple-100 text-purple-600" },
    { label: "Green", value: "bg-green-100 text-green-600" },
    { label: "Red", value: "bg-red-100 text-red-600" },
    { label: "Teal", value: "bg-teal-100 text-teal-600" },
    { label: "Dim gray", value: "bg-gray-100 text-gray-400" },
];

export default function StatusesPage() {
    const [statuses, setStatuses] = useState<TicketStatus[]>([]);
    const [roles, setRoles] = useState<{ id: string; label: string }[]>([]);
    const [loading, setLoading] = useState(true);

    // Inline edit
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValues, setEditValues] = useState<{ label: string; color: string; order: number; isTerminal: boolean }>({
        label: "", color: "", order: 0, isTerminal: false,
    });

    // Transitions modal
    const [transitionModalId, setTransitionModalId] = useState<string | null>(null);
    const [selectedToIds, setSelectedToIds] = useState<string[]>([]);
    const [savingTransitions, setSavingTransitions] = useState(false);

    // Roles modal
    const [rolesModalId, setRolesModalId] = useState<string | null>(null);
    const [rolesForm, setRolesForm] = useState<{
        allowedRoles: string[];
        notifyRoles: string[];
        actionLabel: string;
        warrantyScope: string;
    }>({ allowedRoles: [], notifyRoles: [], actionLabel: "", warrantyScope: "any" });
    const [savingRoles, setSavingRoles] = useState(false);

    // Add new
    const [addingNew, setAddingNew] = useState(false);
    const [newStatus, setNewStatus] = useState({ label: "", color: "bg-gray-100 text-gray-600", isTerminal: false });

    const fetchData = async () => {
        try {
            const [sRes, rRes] = await Promise.all([
                axios.get("/api/ticket-statuses"),
                axios.get("/api/roles")
            ]);
            setStatuses(sRes.data);
            setRoles(rRes.data);
        } catch {
            toast.error("Failed to load data");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(); }, []);

    // ── Inline edit ──
    const startEdit = (s: TicketStatus) => {
        setEditingId(s.id);
        setEditValues({ label: s.label, color: s.color, order: s.order, isTerminal: s.isTerminal });
    };
    const cancelEdit = () => setEditingId(null);
    const saveEdit = async (id: string) => {
        try {
            await axios.patch(`/api/ticket-statuses/${id}`, editValues);
            toast.success("Status updated");
            setEditingId(null);
            await fetchData();
        } catch {
            toast.error("Failed to update status");
        }
    };

    // ── Delete ──
    const deleteStatus = async (id: string, ticketCount: number) => {
        if (ticketCount > 0) { toast.error(`Cannot delete: ${ticketCount} ticket(s) use this status.`); return; }
        if (!confirm("Delete this status? This cannot be undone.")) return;
        try {
            await axios.delete(`/api/ticket-statuses/${id}`);
            toast.success("Status deleted");
            await fetchData();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : null;
            toast.error(msg ?? "Failed to delete status");
        }
    };

    // ── Transitions modal ──
    const openTransitions = (s: TicketStatus) => {
        setTransitionModalId(s.id);
        setSelectedToIds(s.fromTransitions.map((t) => t.toStatusId));
    };
    const saveTransitions = async () => {
        if (!transitionModalId) return;
        setSavingTransitions(true);
        try {
            await axios.put(`/api/ticket-statuses/${transitionModalId}/transitions`, { toIds: selectedToIds });
            toast.success("Transitions saved");
            setTransitionModalId(null);
            await fetchData();
        } catch {
            toast.error("Failed to save transitions");
        } finally {
            setSavingTransitions(false);
        }
    };

    // ── Roles modal ──
    const openRoles = (s: TicketStatus) => {
        setRolesModalId(s.id);
        setRolesForm({
            allowedRoles: s.allowedRoles,
            notifyRoles: s.notifyRoles,
            actionLabel: s.actionLabel ?? "",
            warrantyScope: s.warrantyScope ?? "any",
        });
    };
    const toggleRole = (field: "allowedRoles" | "notifyRoles", id: string) => {
        setRolesForm((prev) => ({
            ...prev,
            [field]: prev[field].includes(id)
                ? prev[field].filter((r) => r !== id)
                : [...prev[field], id],
        }));
    };
    const saveRoles = async () => {
        if (!rolesModalId) return;
        setSavingRoles(true);
        try {
            await axios.patch(`/api/ticket-statuses/${rolesModalId}`, {
                allowedRoles: rolesForm.allowedRoles,
                notifyRoles: rolesForm.notifyRoles,
                actionLabel: rolesForm.actionLabel || null,
                warrantyScope: rolesForm.warrantyScope,
            });
            toast.success("Role settings saved");
            setRolesModalId(null);
            await fetchData();
        } catch {
            toast.error("Failed to save role settings");
        } finally {
            setSavingRoles(false);
        }
    };

    // ── Add new ──
    const addStatus = async () => {
        if (!newStatus.label.trim()) { toast.error("Label is required"); return; }
        try {
            await axios.post("/api/ticket-statuses", {
                label: newStatus.label.trim(),
                color: newStatus.color,
                isTerminal: newStatus.isTerminal,
                order: statuses.length + 1,
            });
            toast.success("Status added");
            setAddingNew(false);
            setNewStatus({ label: "", color: "bg-gray-100 text-gray-600", isTerminal: false });
            await fetchData();
        } catch {
            toast.error("Failed to create status");
        }
    };

    const transitionStatus = transitionModalId ? statuses.find((s) => s.id === transitionModalId) : null;
    const rolesStatus = rolesModalId ? statuses.find((s) => s.id === rolesModalId) : null;

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-3xl font-bold">Ticket Statuses</h1>
                    <p className="text-sm text-gray-500 mt-1">Manage status labels, colors, transitions, and role permissions.</p>
                </div>
                <button
                    onClick={() => setAddingNew(true)}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium"
                >
                    <Plus size={16} /> Add Status
                </button>
            </div>

            {loading ? (
                <p className="text-gray-500">Loading...</p>
            ) : (
                <div className="bg-white rounded-lg shadow overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                            <tr>
                                <th className="px-6 py-3 text-left w-16">ID</th>
                                <th className="px-6 py-3 text-left">Label</th>
                                <th className="px-6 py-3 text-left">Color</th>
                                <th className="px-6 py-3 text-left w-20">
                                    <span className="flex items-center gap-1"><ArrowUpDown size={12} />Order</span>
                                </th>
                                <th className="px-6 py-3 text-left">Terminal</th>
                                <th className="px-6 py-3 text-left">Who can set</th>
                                <th className="px-6 py-3 text-left">Notifies</th>
                                <th className="px-6 py-3 text-left">Transitions To</th>
                                <th className="px-6 py-3 text-left">Tickets</th>
                                <th className="px-6 py-3 text-left">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {statuses.map((s) => (
                                <tr key={s.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 font-mono text-gray-400 text-xs">{s.id}</td>

                                    {editingId === s.id ? (
                                        <>
                                            <td className="px-6 py-3">
                                                <input
                                                    autoFocus
                                                    value={editValues.label}
                                                    onChange={(e) => setEditValues((v) => ({ ...v, label: e.target.value }))}
                                                    className="border rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                />
                                            </td>
                                            <td className="px-6 py-3">
                                                <select
                                                    value={editValues.color}
                                                    onChange={(e) => setEditValues((v) => ({ ...v, color: e.target.value }))}
                                                    className="border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                >
                                                    {COLOR_OPTIONS.map((c) => (
                                                        <option key={c.value} value={c.value}>{c.label}</option>
                                                    ))}
                                                </select>
                                                <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-medium ${editValues.color}`}>
                                                    preview
                                                </span>
                                            </td>
                                            <td className="px-6 py-3">
                                                <input
                                                    type="number"
                                                    value={editValues.order}
                                                    onChange={(e) => setEditValues((v) => ({ ...v, order: Number(e.target.value) }))}
                                                    className="border rounded px-2 py-1 text-sm w-16 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                />
                                            </td>
                                            <td className="px-6 py-3">
                                                <input
                                                    type="checkbox"
                                                    checked={editValues.isTerminal}
                                                    onChange={(e) => setEditValues((v) => ({ ...v, isTerminal: e.target.checked }))}
                                                    className="w-4 h-4"
                                                />
                                            </td>
                                            <td className="px-6 py-3 text-gray-400 text-xs" colSpan={2}>—</td>
                                            <td className="px-6 py-3 text-gray-400 text-xs">—</td>
                                            <td className="px-6 py-3 text-gray-400">{s._count.tickets}</td>
                                            <td className="px-6 py-3">
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => saveEdit(s.id)}
                                                        className="flex items-center gap-1 px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
                                                    >
                                                        <Save size={12} /> Save
                                                    </button>
                                                    <button
                                                        onClick={cancelEdit}
                                                        className="flex items-center gap-1 px-3 py-1 border rounded text-xs text-gray-600 hover:bg-gray-50"
                                                    >
                                                        <X size={12} /> Cancel
                                                    </button>
                                                </div>
                                            </td>
                                        </>
                                    ) : (
                                        <>
                                            <td className="px-6 py-4">
                                                <span className={`px-2 py-1 rounded-full text-xs font-medium ${s.color}`}>
                                                    {s.label}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-gray-400 text-xs font-mono">{s.color}</td>
                                            <td className="px-6 py-4 text-gray-600">{s.order}</td>
                                            <td className="px-6 py-4">
                                                {s.isTerminal ? (
                                                    <span className="px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-600 font-medium">Yes</span>
                                                ) : (
                                                    <span className="text-gray-400 text-xs">No</span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4">
                                                {s.allowedRoles.length === 0 ? (
                                                    <span className="text-gray-400 text-xs">Anyone</span>
                                                ) : (
                                                    <div className="flex flex-wrap gap-1">
                                                        {s.allowedRoles.map((r) => (
                                                            <span key={r} className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-xs">{roles.find((x) => x.id === r)?.label ?? r}</span>
                                                        ))}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-6 py-4">
                                                {s.notifyRoles.length === 0 ? (
                                                    <span className="text-gray-400 text-xs">None</span>
                                                ) : (
                                                    <div className="flex flex-wrap gap-1">
                                                        {s.notifyRoles.map((r) => (
                                                            <span key={r} className="px-1.5 py-0.5 bg-orange-50 text-orange-600 rounded text-xs">{roles.find((x) => x.id === r)?.label ?? r}</span>
                                                        ))}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-6 py-4">
                                                {s.fromTransitions.length === 0 ? (
                                                    <span className="text-gray-400 text-xs">None</span>
                                                ) : (
                                                    <div className="flex flex-wrap gap-1">
                                                        {s.fromTransitions.map((t) => (
                                                            <span key={t.toStatusId} className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
                                                                {t.to.label}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 text-gray-500">{s._count.tickets}</td>
                                            <td className="px-6 py-4">
                                                <div className="flex gap-2 flex-wrap">
                                                    <button
                                                        onClick={() => startEdit(s)}
                                                        className="px-3 py-1 border rounded text-xs text-gray-600 hover:bg-gray-50"
                                                    >
                                                        Edit
                                                    </button>
                                                    <button
                                                        onClick={() => openRoles(s)}
                                                        className="flex items-center gap-1 px-3 py-1 border rounded text-xs text-purple-600 hover:bg-purple-50"
                                                    >
                                                        <Users size={12} /> Roles
                                                    </button>
                                                    <button
                                                        onClick={() => openTransitions(s)}
                                                        className="flex items-center gap-1 px-3 py-1 border rounded text-xs text-blue-600 hover:bg-blue-50"
                                                    >
                                                        <GitMerge size={12} /> Transitions
                                                    </button>
                                                    <button
                                                        onClick={() => deleteStatus(s.id, s._count.tickets)}
                                                        disabled={s._count.tickets > 0}
                                                        className="p-1.5 rounded text-red-400 hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed"
                                                        title={s._count.tickets > 0 ? `${s._count.tickets} tickets use this status` : "Delete"}
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                            </td>
                                        </>
                                    )}
                                </tr>
                            ))}

                            {/* Add new row */}
                            {addingNew && (
                                <tr className="bg-blue-50">
                                    <td className="px-6 py-3 text-gray-400 text-xs font-mono">auto</td>
                                    <td className="px-6 py-3">
                                        <input
                                            autoFocus
                                            value={newStatus.label}
                                            onChange={(e) => setNewStatus((v) => ({ ...v, label: e.target.value }))}
                                            placeholder="Label"
                                            className="border rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                    </td>
                                    <td className="px-6 py-3">
                                        <select
                                            value={newStatus.color}
                                            onChange={(e) => setNewStatus((v) => ({ ...v, color: e.target.value }))}
                                            className="border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        >
                                            {COLOR_OPTIONS.map((c) => (
                                                <option key={c.value} value={c.value}>{c.label}</option>
                                            ))}
                                        </select>
                                        <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-medium ${newStatus.color}`}>
                                            preview
                                        </span>
                                    </td>
                                    <td className="px-6 py-3 text-gray-400 text-xs">auto</td>
                                    <td className="px-6 py-3">
                                        <input
                                            type="checkbox"
                                            checked={newStatus.isTerminal}
                                            onChange={(e) => setNewStatus((v) => ({ ...v, isTerminal: e.target.checked }))}
                                            className="w-4 h-4"
                                        />
                                    </td>
                                    <td className="px-6 py-3 text-gray-400 text-xs" colSpan={3}>Set roles after creation</td>
                                    <td className="px-6 py-3 text-gray-400">0</td>
                                    <td className="px-6 py-3">
                                        <div className="flex gap-2">
                                            <button
                                                onClick={addStatus}
                                                className="flex items-center gap-1 px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
                                            >
                                                <Save size={12} /> Add
                                            </button>
                                            <button
                                                onClick={() => { setAddingNew(false); setNewStatus({ label: "", color: "bg-gray-100 text-gray-600", isTerminal: false }); }}
                                                className="flex items-center gap-1 px-3 py-1 border rounded text-xs text-gray-600 hover:bg-gray-50"
                                            >
                                                <X size={12} /> Cancel
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Transitions modal */}
            {transitionModalId && transitionStatus && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold">
                                Transitions from{" "}
                                <span className={`px-2 py-0.5 rounded-full text-sm font-medium ${transitionStatus.color}`}>
                                    {transitionStatus.label}
                                </span>
                            </h2>
                            <button onClick={() => setTransitionModalId(null)} className="text-gray-400 hover:text-gray-600">
                                <X size={20} />
                            </button>
                        </div>
                        <p className="text-xs text-gray-500 mb-3">Select which statuses this status can transition to:</p>
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                            {statuses
                                .filter((s) => s.id !== transitionModalId)
                                .map((s) => (
                                    <label key={s.id} className="flex items-center gap-3 p-2 rounded hover:bg-gray-50 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={selectedToIds.includes(s.id)}
                                            onChange={(e) => {
                                                setSelectedToIds((prev) =>
                                                    e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id)
                                                );
                                            }}
                                            className="w-4 h-4"
                                        />
                                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.color}`}>{s.label}</span>
                                        <span className="text-xs text-gray-400 font-mono">{s.id}</span>
                                    </label>
                                ))}
                        </div>
                        <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
                            <button onClick={() => setTransitionModalId(null)} className="px-4 py-2 border rounded text-sm text-gray-600 hover:bg-gray-50">
                                Cancel
                            </button>
                            <button
                                onClick={saveTransitions}
                                disabled={savingTransitions}
                                className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-60"
                            >
                                {savingTransitions ? "Saving…" : "Save Transitions"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Roles modal */}
            {rolesModalId && rolesStatus && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold">
                                Role settings —{" "}
                                <span className={`px-2 py-0.5 rounded-full text-sm font-medium ${rolesStatus.color}`}>
                                    {rolesStatus.label}
                                </span>
                            </h2>
                            <button onClick={() => setRolesModalId(null)} className="text-gray-400 hover:text-gray-600">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="space-y-5">
                            {/* Who can set */}
                            <div>
                                <p className="text-sm font-medium mb-2">Who can move a ticket to this status?</p>
                                <p className="text-xs text-gray-400 mb-2">Leave all unchecked to allow any role. Admin always bypasses this.</p>
                                <div className="grid grid-cols-2 gap-1">
                                    {roles.map((r) => (
                                        <label key={r.id} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer text-sm">
                                            <input
                                                type="checkbox"
                                                checked={rolesForm.allowedRoles.includes(r.id)}
                                                onChange={() => toggleRole("allowedRoles", r.id)}
                                                className="accent-blue-600"
                                            />
                                            {r.label}
                                        </label>
                                    ))}
                                </div>
                            </div>

                            {/* Who gets notified */}
                            <div>
                                <p className="text-sm font-medium mb-2">Which roles see this as an action item?</p>
                                <p className="text-xs text-gray-400 mb-2">These roles will see tickets in this status on their dashboard queue.</p>
                                <div className="grid grid-cols-2 gap-1">
                                    {roles.map((r) => (
                                        <label key={r.id} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer text-sm">
                                            <input
                                                type="checkbox"
                                                checked={rolesForm.notifyRoles.includes(r.id)}
                                                onChange={() => toggleRole("notifyRoles", r.id)}
                                                className="accent-orange-500"
                                            />
                                            {r.label}
                                        </label>
                                    ))}
                                </div>
                            </div>

                            {/* Warranty scope */}
                            <div>
                                <label className="block text-sm font-medium mb-1">Warranty scope</label>
                                <select
                                    value={rolesForm.warrantyScope}
                                    onChange={(e) => setRolesForm((prev) => ({ ...prev, warrantyScope: e.target.value }))}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                    <option value="any">Any (warranty + non-warranty)</option>
                                    <option value="warranty_only">Warranty only</option>
                                    <option value="non_warranty_only">Non-warranty only</option>
                                </select>
                                <p className="text-xs text-gray-400 mt-1">Controls whether this status appears for warranty or non-warranty tickets.</p>
                            </div>

                            {/* Action label */}
                            <div>
                                <label className="block text-sm font-medium mb-1">
                                    Action label <span className="text-gray-400">(optional)</span>
                                </label>
                                <input
                                    value={rolesForm.actionLabel}
                                    onChange={(e) => setRolesForm((prev) => ({ ...prev, actionLabel: e.target.value }))}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    placeholder="e.g. New ticket received — assign a technician"
                                />
                                <p className="text-xs text-gray-400 mt-1">
                                    Shown on the notified role&apos;s dashboard as the task description.
                                </p>
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 mt-6 pt-4 border-t">
                            <button onClick={() => setRolesModalId(null)} className="px-4 py-2 border rounded text-sm text-gray-600 hover:bg-gray-50">
                                Cancel
                            </button>
                            <button
                                onClick={saveRoles}
                                disabled={savingRoles}
                                className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-60"
                            >
                                {savingRoles ? "Saving…" : "Save Role Settings"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
