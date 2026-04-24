"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Trash2, Save, X, Pencil } from "lucide-react";

interface Pipeline {
    id: string;
    name: string;
    label: string;
    description: string | null;
    color: string;
    isDefault: boolean;
    isActive: boolean;
    order: number;
    _count: { statuses: number; tickets: number };
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
    { label: "Indigo", value: "bg-indigo-100 text-indigo-600" },
    { label: "Pink", value: "bg-pink-100 text-pink-600" },
];

const BLANK_FORM = {
    name: "",
    label: "",
    description: "",
    color: "bg-gray-100 text-gray-600",
    isActive: true,
};

export default function PipelinesPage() {
    const [pipelines, setPipelines] = useState<Pipeline[]>([]);
    const [loading, setLoading] = useState(true);

    // Create modal
    const [showCreate, setShowCreate] = useState(false);
    const [createForm, setCreateForm] = useState(BLANK_FORM);
    const [creating, setCreating] = useState(false);

    // Edit modal
    const [editId, setEditId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState({ label: "", description: "", color: "", isActive: true });
    const [editing, setEditing] = useState(false);

    const load = async () => {
        try {
            const res = await axios.get("/api/pipelines");
            setPipelines(res.data);
        } catch {
            toast.error("Failed to load pipelines");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const handleCreate = async () => {
        if (!createForm.name.trim() || !createForm.label.trim()) {
            toast.error("Name and label are required");
            return;
        }
        setCreating(true);
        try {
            await axios.post("/api/pipelines", {
                name: createForm.name.trim().toLowerCase().replace(/\s+/g, "_"),
                label: createForm.label.trim(),
                description: createForm.description.trim() || null,
                color: createForm.color,
                isActive: createForm.isActive,
            });
            toast.success("Pipeline created");
            setShowCreate(false);
            setCreateForm(BLANK_FORM);
            load();
        } catch (err) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : null;
            toast.error(msg ?? "Failed to create pipeline");
        } finally {
            setCreating(false);
        }
    };

    const openEdit = (p: Pipeline) => {
        setEditId(p.id);
        setEditForm({ label: p.label, description: p.description ?? "", color: p.color, isActive: p.isActive });
    };

    const handleEdit = async () => {
        if (!editId) return;
        setEditing(true);
        try {
            await axios.patch(`/api/pipelines/${editId}`, {
                label: editForm.label.trim(),
                description: editForm.description.trim() || null,
                color: editForm.color,
                isActive: editForm.isActive,
            });
            toast.success("Pipeline updated");
            setEditId(null);
            load();
        } catch {
            toast.error("Failed to update pipeline");
        } finally {
            setEditing(false);
        }
    };

    const handleDelete = async (p: Pipeline) => {
        if (p.isDefault) { toast.error("Cannot delete the default pipeline"); return; }
        if (p._count.tickets > 0) { toast.error(`Cannot delete: ${p._count.tickets} ticket(s) use this pipeline`); return; }
        if (!confirm(`Delete pipeline "${p.label}"? This cannot be undone.`)) return;
        try {
            await axios.delete(`/api/pipelines/${p.id}`);
            toast.success("Pipeline deleted");
            load();
        } catch (err) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : null;
            toast.error(msg ?? "Failed to delete pipeline");
        }
    };

    const toggleActive = async (p: Pipeline) => {
        if (p.isDefault && p.isActive) { toast.error("Cannot deactivate the default pipeline"); return; }
        try {
            await axios.patch(`/api/pipelines/${p.id}`, { isActive: !p.isActive });
            load();
        } catch {
            toast.error("Failed to update pipeline");
        }
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-3xl font-bold">Pipelines</h1>
                    <p className="text-sm text-gray-500 mt-1">
                        Each pipeline has its own independent set of statuses, sub-statuses, and workflow graph.
                    </p>
                </div>
                <button
                    onClick={() => setShowCreate(true)}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium"
                >
                    <Plus size={16} /> Add Pipeline
                </button>
            </div>

            {loading ? (
                <p className="text-gray-500">Loading…</p>
            ) : (
                <div className="grid gap-4">
                    {pipelines.map((p) => (
                        <div key={p.id} className="bg-white rounded-xl shadow p-5 flex items-start gap-4">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-3 flex-wrap">
                                    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${p.color}`}>
                                        {p.label}
                                    </span>
                                    <span className="text-xs font-mono text-gray-400">{p.id}</span>
                                    <span className="text-xs font-mono text-gray-400 bg-gray-100 px-2 py-0.5 rounded">{p.name}</span>
                                    {p.isDefault && (
                                        <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium">Default</span>
                                    )}
                                    {!p.isActive && (
                                        <span className="text-xs bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full">Inactive</span>
                                    )}
                                </div>
                                {p.description && (
                                    <p className="text-sm text-gray-500 mt-1.5">{p.description}</p>
                                )}
                                <div className="flex gap-4 mt-2 text-xs text-gray-400">
                                    <span>{p._count.statuses} stage{p._count.statuses !== 1 ? "s" : ""}</span>
                                    <span>{p._count.tickets} ticket{p._count.tickets !== 1 ? "s" : ""}</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <button
                                    onClick={() => toggleActive(p)}
                                    className={`text-xs px-3 py-1.5 border rounded-lg ${p.isActive ? "text-gray-500 hover:bg-gray-50" : "text-green-600 border-green-200 hover:bg-green-50"}`}
                                >
                                    {p.isActive ? "Deactivate" : "Activate"}
                                </button>
                                <button
                                    onClick={() => openEdit(p)}
                                    className="flex items-center gap-1 text-xs border rounded-lg px-3 py-1.5 text-gray-500 hover:bg-gray-50"
                                >
                                    <Pencil size={13} /> Edit
                                </button>
                                <button
                                    onClick={() => handleDelete(p)}
                                    disabled={p.isDefault || p._count.tickets > 0}
                                    className="p-1.5 rounded text-red-400 hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed"
                                    title={p.isDefault ? "Cannot delete default pipeline" : p._count.tickets > 0 ? `${p._count.tickets} tickets use this pipeline` : "Delete"}
                                >
                                    <Trash2 size={15} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Create modal */}
            {showCreate && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                        <div className="flex items-center justify-between mb-5">
                            <h2 className="text-base font-semibold">New Pipeline</h2>
                            <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium mb-1">Name <span className="text-gray-400">(slug, e.g. manufacturing)</span></label>
                                <input
                                    value={createForm.name}
                                    onChange={(e) => setCreateForm((v) => ({ ...v, name: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "_") }))}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                                    placeholder="e.g. manufacturing"
                                />
                                <p className="text-xs text-gray-400 mt-1">Lowercase letters, numbers, hyphens and underscores only.</p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Label</label>
                                <input
                                    value={createForm.label}
                                    onChange={(e) => setCreateForm((v) => ({ ...v, label: e.target.value }))}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    placeholder="e.g. Manufacturing"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Description <span className="text-gray-400">(optional)</span></label>
                                <input
                                    value={createForm.description}
                                    onChange={(e) => setCreateForm((v) => ({ ...v, description: e.target.value }))}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    placeholder="Brief description of what this pipeline is for"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Color</label>
                                <select
                                    value={createForm.color}
                                    onChange={(e) => setCreateForm((v) => ({ ...v, color: e.target.value }))}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                    {COLOR_OPTIONS.map((c) => (
                                        <option key={c.value} value={c.value}>{c.label}</option>
                                    ))}
                                </select>
                                <span className={`mt-1 inline-block text-xs px-2 py-0.5 rounded-full ${createForm.color}`}>
                                    {createForm.label || "Preview"}
                                </span>
                            </div>
                        </div>
                        <div className="flex gap-3 pt-5 border-t mt-5">
                            <button onClick={() => setShowCreate(false)} className="flex-1 border rounded-lg py-2 text-sm hover:bg-gray-50">Cancel</button>
                            <button
                                onClick={handleCreate}
                                disabled={creating || !createForm.name.trim() || !createForm.label.trim()}
                                className="flex-1 flex items-center justify-center gap-2 bg-blue-600 text-white rounded-lg py-2 text-sm hover:bg-blue-700 disabled:opacity-50"
                            >
                                <Save size={14} /> {creating ? "Creating…" : "Create Pipeline"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit modal */}
            {editId && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                        <div className="flex items-center justify-between mb-5">
                            <h2 className="text-base font-semibold">Edit Pipeline</h2>
                            <button onClick={() => setEditId(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium mb-1">Label</label>
                                <input
                                    value={editForm.label}
                                    onChange={(e) => setEditForm((v) => ({ ...v, label: e.target.value }))}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Description <span className="text-gray-400">(optional)</span></label>
                                <input
                                    value={editForm.description}
                                    onChange={(e) => setEditForm((v) => ({ ...v, description: e.target.value }))}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Color</label>
                                <select
                                    value={editForm.color}
                                    onChange={(e) => setEditForm((v) => ({ ...v, color: e.target.value }))}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                    {COLOR_OPTIONS.map((c) => (
                                        <option key={c.value} value={c.value}>{c.label}</option>
                                    ))}
                                </select>
                                <span className={`mt-1 inline-block text-xs px-2 py-0.5 rounded-full ${editForm.color}`}>
                                    {editForm.label || "Preview"}
                                </span>
                            </div>
                        </div>
                        <div className="flex gap-3 pt-5 border-t mt-5">
                            <button onClick={() => setEditId(null)} className="flex-1 border rounded-lg py-2 text-sm hover:bg-gray-50">Cancel</button>
                            <button
                                onClick={handleEdit}
                                disabled={editing || !editForm.label.trim()}
                                className="flex-1 flex items-center justify-center gap-2 bg-blue-600 text-white rounded-lg py-2 text-sm hover:bg-blue-700 disabled:opacity-50"
                            >
                                <Save size={14} /> {editing ? "Saving…" : "Save Changes"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
