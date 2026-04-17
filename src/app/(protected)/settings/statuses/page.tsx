"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Trash2, Save, X, ArrowUpDown, GitMerge } from "lucide-react";

interface TicketStatus {
    id: string;
    label: string;
    color: string;
    order: number;
    isTerminal: boolean;
    fromTransitions: { toStatusId: string; to: { label: string } }[];
    _count: { tickets: number };
}

const COLOR_OPTIONS = [
    { label: "Gray",   value: "bg-gray-100 text-gray-600" },
    { label: "Blue",   value: "bg-blue-100 text-blue-600" },
    { label: "Yellow", value: "bg-yellow-100 text-yellow-600" },
    { label: "Orange", value: "bg-orange-100 text-orange-600" },
    { label: "Purple", value: "bg-purple-100 text-purple-600" },
    { label: "Green",  value: "bg-green-100 text-green-600" },
    { label: "Red",    value: "bg-red-100 text-red-600" },
    { label: "Teal",   value: "bg-teal-100 text-teal-600" },
    { label: "Dim gray", value: "bg-gray-100 text-gray-400" },
];

export default function StatusesPage() {
    const [statuses, setStatuses] = useState<TicketStatus[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValues, setEditValues] = useState<{ label: string; color: string; order: number; isTerminal: boolean }>({
        label: "", color: "", order: 0, isTerminal: false,
    });
    const [transitionModalId, setTransitionModalId] = useState<string | null>(null);
    const [selectedToIds, setSelectedToIds] = useState<string[]>([]);
    const [savingTransitions, setSavingTransitions] = useState(false);
    const [addingNew, setAddingNew] = useState(false);
    const [newStatus, setNewStatus] = useState({ label: "", color: "bg-gray-100 text-gray-600", isTerminal: false });

    const fetchStatuses = async () => {
        try {
            const res = await axios.get("/api/ticket-statuses");
            setStatuses(res.data);
        } catch {
            toast.error("Failed to load statuses");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchStatuses(); }, []);

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
            await fetchStatuses();
        } catch {
            toast.error("Failed to update status");
        }
    };

    const deleteStatus = async (id: string, ticketCount: number) => {
        if (ticketCount > 0) {
            toast.error(`Cannot delete: ${ticketCount} ticket(s) use this status.`);
            return;
        }
        if (!confirm("Delete this status? This cannot be undone.")) return;
        try {
            await axios.delete(`/api/ticket-statuses/${id}`);
            toast.success("Status deleted");
            await fetchStatuses();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : null;
            toast.error(msg ?? "Failed to delete status");
        }
    };

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
            await fetchStatuses();
        } catch {
            toast.error("Failed to save transitions");
        } finally {
            setSavingTransitions(false);
        }
    };

    const addStatus = async () => {
        if (!newStatus.label.trim()) { toast.error("Label is required"); return; }
        try {
            await axios.post("/api/ticket-statuses", {
                label: newStatus.label.trim(),
                color: newStatus.color,
                isTerminal: newStatus.isTerminal,
                order: statuses.length + 1,
            });
            toast.success("Status created");
            setAddingNew(false);
            setNewStatus({ label: "", color: "bg-gray-100 text-gray-600", isTerminal: false });
            await fetchStatuses();
        } catch {
            toast.error("Failed to create status");
        }
    };

    const transitionStatus = transitionModalId ? statuses.find((s) => s.id === transitionModalId) : null;

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-3xl font-bold">Ticket Statuses</h1>
                    <p className="text-sm text-gray-500 mt-1">Manage status labels, colors, order, and allowed transitions.</p>
                </div>
                <button
                    onClick={() => setAddingNew(true)}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium"
                >
                    <Plus size={16} />
                    Add Status
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
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => startEdit(s)}
                                                        className="px-3 py-1 border rounded text-xs text-gray-600 hover:bg-gray-50"
                                                    >
                                                        Edit
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
                                    <td className="px-6 py-3 text-gray-400 text-xs">Set after creation</td>
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
                            <button
                                onClick={() => setTransitionModalId(null)}
                                className="px-4 py-2 border rounded text-sm text-gray-600 hover:bg-gray-50"
                            >
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
        </div>
    );
}
