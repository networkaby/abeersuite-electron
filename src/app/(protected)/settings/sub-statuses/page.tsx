"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ChevronRight, GitMerge, Pencil, Plus, Trash2, X } from "lucide-react";

interface StatusItem {
    id: string;
    label: string;
    color: string;
    order: number;
}

interface SubStatus {
    id: string;
    label: string;
    color: string;
    group: string;
    order: number;
    applicableStatusIds: string[];
    allowedRoles: string[];
    notifyRoles: string[];
    triggerMap: Record<string, string>;
    actionLabel: string | null;
    fromTransitions: { to: { id: string; label: string; color: string } }[];
}

type FormValues = {
    label: string;
    color: string;
    group: string;
    order: string;
    applicableStatusIds: string[];
    allowedRoles: string[];
    notifyRoles: string[];
    triggerMap: Record<string, string>;
    actionLabel: string;
};

const BLANK_FORM: FormValues = {
    label: "", color: "bg-gray-100 text-gray-600", group: "customer_comm",
    order: "", applicableStatusIds: [], allowedRoles: [], notifyRoles: [], triggerMap: {},
    actionLabel: "",
};

const GROUP_OPTIONS = [
    { value: "customer_comm", label: "Customer Communication" },
    { value: "approval",      label: "Quote & Approval" },
    { value: "parts",         label: "Parts" },
    { value: "qc",            label: "Quality Check" },
    { value: "escalated",     label: "Escalated" },
    { value: "ready",         label: "Ready for Collection" },
    { value: "no_fix",        label: "No Fix" },
];

const GROUP_LABELS = Object.fromEntries(GROUP_OPTIONS.map((g) => [g.value, g.label]));

const COLOR_OPTIONS = [
    { label: "Gray",   value: "bg-gray-100 text-gray-600" },
    { label: "Blue",   value: "bg-blue-100 text-blue-600" },
    { label: "Yellow", value: "bg-yellow-100 text-yellow-700" },
    { label: "Orange", value: "bg-orange-100 text-orange-600" },
    { label: "Purple", value: "bg-purple-100 text-purple-600" },
    { label: "Green",  value: "bg-green-100 text-green-700" },
    { label: "Red",    value: "bg-red-100 text-red-600" },
    { label: "Teal",   value: "bg-teal-100 text-teal-600" },
];

const ALL_ROLES = [
    { id: "R1", label: "Admin" },
    { id: "R2", label: "Technician" },
    { id: "R3", label: "Front Desk" },
    { id: "R4", label: "Despatch" },
];
const ROLE_LABELS = Object.fromEntries(ALL_ROLES.map((r) => [r.id, r.label]));

// ── Form modal ────────────────────────────────────────────────────────────────
function SubStatusFormModal({
    title,
    form,
    setForm,
    onSave,
    onClose,
    saving,
    statuses,
}: {
    title: string;
    form: FormValues;
    setForm: (f: FormValues) => void;
    onSave: () => void;
    onClose: () => void;
    saving: boolean;
    statuses: StatusItem[];
}) {
    const toggle = (field: "applicableStatusIds" | "allowedRoles" | "notifyRoles", val: string) =>
        setForm({
            ...form,
            [field]: form[field].includes(val)
                ? form[field].filter((x) => x !== val)
                : [...form[field], val],
        });

    const setTrigger = (statusId: string, targetId: string) => {
        const next = { ...form.triggerMap };
        if (targetId) next[statusId] = targetId;
        else delete next[statusId];
        setForm({ ...form, triggerMap: next });
    };

    return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-5">
                    <h2 className="text-base font-semibold">{title}</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
                </div>

                <div className="space-y-4">
                    {/* Label */}
                    <div>
                        <label className="block text-sm font-medium mb-1">Label</label>
                        <input
                            value={form.label}
                            onChange={(e) => setForm({ ...form, label: e.target.value })}
                            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="e.g. Waiting for Parts"
                        />
                    </div>

                    {/* Action label */}
                    <div>
                        <label className="block text-sm font-medium mb-1">
                            Action label <span className="text-gray-400">(optional)</span>
                        </label>
                        <input
                            value={form.actionLabel}
                            onChange={(e) => setForm({ ...form, actionLabel: e.target.value })}
                            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="e.g. Call customer — quote ready for approval"
                        />
                        <p className="text-xs text-gray-400 mt-1">
                            Shown on role dashboards as the task description (Front Desk / Despatch).
                        </p>
                    </div>

                    {/* Color + Group row */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium mb-1">Color</label>
                            <select
                                value={form.color}
                                onChange={(e) => setForm({ ...form, color: e.target.value })}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                {COLOR_OPTIONS.map((c) => (
                                    <option key={c.value} value={c.value}>{c.label}</option>
                                ))}
                            </select>
                            <span className={`mt-1 inline-block text-xs px-2 py-0.5 rounded-full ${form.color}`}>
                                Preview
                            </span>
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Group</label>
                            <select
                                value={form.group}
                                onChange={(e) => setForm({ ...form, group: e.target.value })}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                {GROUP_OPTIONS.map((g) => (
                                    <option key={g.value} value={g.value}>{g.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Applies to — fetched main statuses with per-parent trigger */}
                    <div>
                        <label className="block text-sm font-medium mb-2">Applies to (main status)</label>
                        {statuses.length === 0 ? (
                            <p className="text-xs text-gray-400">Loading statuses…</p>
                        ) : (
                            <div className="space-y-1">
                                {statuses.map((s) => (
                                    <div key={s.id} className="flex items-center gap-2 flex-wrap">
                                        <label className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer text-xs min-w-[160px]">
                                            <input
                                                type="checkbox"
                                                checked={form.applicableStatusIds.includes(s.id)}
                                                onChange={() => toggle("applicableStatusIds", s.id)}
                                                className="accent-blue-600"
                                            />
                                            <span className={`px-1.5 py-0.5 rounded-full font-medium ${s.color}`}>{s.label}</span>
                                        </label>
                                        {form.applicableStatusIds.includes(s.id) && (
                                            <div className="flex items-center gap-1 text-xs text-gray-500">
                                                <span className="text-gray-400">→ auto-advance to:</span>
                                                <select
                                                    value={form.triggerMap[s.id] ?? ""}
                                                    onChange={(e) => setTrigger(s.id, e.target.value)}
                                                    className="border rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                                                >
                                                    <option value="">— none —</option>
                                                    {statuses.filter((t) => t.id !== s.id).map((t) => (
                                                        <option key={t.id} value={t.id}>{t.label}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Roles row */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium mb-2">Who can set it</label>
                            {ALL_ROLES.map((r) => (
                                <label key={r.id} className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-gray-50 rounded cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={form.allowedRoles.includes(r.id)}
                                        onChange={() => toggle("allowedRoles", r.id)}
                                        className="accent-blue-600"
                                    />
                                    {r.label}
                                </label>
                            ))}
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-2">Notifies</label>
                            {ALL_ROLES.map((r) => (
                                <label key={r.id} className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-gray-50 rounded cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={form.notifyRoles.includes(r.id)}
                                        onChange={() => toggle("notifyRoles", r.id)}
                                        className="accent-blue-600"
                                    />
                                    {r.label}
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Order */}
                    <div>
                        <label className="block text-sm font-medium mb-1">Order <span className="text-gray-400">(optional)</span></label>
                        <input
                            type="number"
                            value={form.order}
                            onChange={(e) => setForm({ ...form, order: e.target.value })}
                            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Auto-assigned if blank"
                        />
                    </div>
                </div>

                <div className="flex gap-3 pt-5 border-t mt-5">
                    <button onClick={onClose} className="flex-1 border rounded-lg py-2 text-sm hover:bg-gray-50">Cancel</button>
                    <button
                        onClick={onSave}
                        disabled={saving || !form.label.trim()}
                        className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm hover:bg-blue-700 disabled:opacity-50"
                    >
                        {saving ? "Saving..." : "Save"}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function SubStatusesPage() {
    const [statuses, setStatuses] = useState<StatusItem[]>([]);
    const [subStatuses, setSubStatuses] = useState<SubStatus[]>([]);
    const [loading, setLoading] = useState(true);

    // Create modal
    const [showCreate, setShowCreate] = useState(false);
    const [createForm, setCreateForm] = useState<FormValues>(BLANK_FORM);
    const [creating, setCreating] = useState(false);

    // Edit modal
    const [editId, setEditId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<FormValues>(BLANK_FORM);
    const [editing, setEditing] = useState(false);

    // Delete
    const [deletingId, setDeletingId] = useState<string | null>(null);

    // Transitions modal
    const [transitionModalId, setTransitionModalId] = useState<string | null>(null);
    const [selectedToIds, setSelectedToIds] = useState<string[]>([]);
    const [savingTransitions, setSavingTransitions] = useState(false);

    const loadAll = async () => {
        try {
            const [statusRes, subRes] = await Promise.all([
                axios.get("/api/ticket-statuses"),
                axios.get("/api/sub-statuses"),
            ]);
            setStatuses(
                (statusRes.data as StatusItem[]).sort((a, b) => a.order - b.order)
            );
            setSubStatuses(subRes.data);
        } catch {
            toast.error("Failed to load data");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadAll(); }, []);

    // ── Create ──
    const handleCreate = async () => {
        setCreating(true);
        try {
            await axios.post("/api/sub-statuses", {
                ...createForm,
                order: createForm.order ? Number(createForm.order) : undefined,
            });
            toast.success("Sub-status created");
            setShowCreate(false);
            setCreateForm(BLANK_FORM);
            loadAll();
        } catch {
            toast.error("Failed to create");
        } finally {
            setCreating(false);
        }
    };

    // ── Edit ──
    const openEdit = (ss: SubStatus) => {
        setEditForm({
            label: ss.label,
            color: ss.color,
            group: ss.group,
            order: String(ss.order),
            applicableStatusIds: ss.applicableStatusIds,
            allowedRoles: ss.allowedRoles,
            notifyRoles: ss.notifyRoles,
            triggerMap: (ss.triggerMap ?? {}) as Record<string, string>,
            actionLabel: ss.actionLabel ?? "",
        });
        setEditId(ss.id);
    };

    const handleEdit = async () => {
        if (!editId) return;
        setEditing(true);
        try {
            await axios.patch(`/api/sub-statuses/${editId}`, {
                label: editForm.label,
                color: editForm.color,
                group: editForm.group,
                order: editForm.order ? Number(editForm.order) : undefined,
                applicableStatusIds: editForm.applicableStatusIds,
                allowedRoles: editForm.allowedRoles,
                notifyRoles: editForm.notifyRoles,
                triggerMap: editForm.triggerMap,
                actionLabel: editForm.actionLabel || null,
            });
            toast.success("Sub-status updated");
            setEditId(null);
            loadAll();
        } catch {
            toast.error("Failed to update");
        } finally {
            setEditing(false);
        }
    };

    // ── Delete ──
    const handleDelete = async (id: string) => {
        setDeletingId(id);
        try {
            await axios.delete(`/api/sub-statuses/${id}`);
            toast.success("Sub-status deleted");
            loadAll();
        } catch (err) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed to delete";
            toast.error(msg ?? "Failed to delete");
        } finally {
            setDeletingId(null);
        }
    };

    // ── Transitions ──
    const openTransitionModal = (id: string) => {
        const ss = subStatuses.find((s) => s.id === id);
        setSelectedToIds(ss?.fromTransitions.map((t) => t.to.id) ?? []);
        setTransitionModalId(id);
    };

    const saveTransitions = async () => {
        if (!transitionModalId) return;
        setSavingTransitions(true);
        try {
            await axios.put(`/api/sub-statuses/${transitionModalId}/transitions`, { toIds: selectedToIds });
            toast.success("Transitions saved");
            setTransitionModalId(null);
            loadAll();
        } catch {
            toast.error("Failed to save transitions");
        } finally {
            setSavingTransitions(false);
        }
    };

    const toggleTo = (id: string) =>
        setSelectedToIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

    const modalSubStatus = subStatuses.find((s) => s.id === transitionModalId);
    const transitionCandidates = modalSubStatus
        ? subStatuses.filter((s) =>
              s.id !== modalSubStatus.id &&
              s.applicableStatusIds.some((sid) => modalSubStatus.applicableStatusIds.includes(sid))
          )
        : [];

    // ── Parent-wise grouping (uses fetched statuses) ──
    const statusLabelMap = Object.fromEntries(statuses.map((s) => [s.id, s.label]));

    const byParent = statuses.map((status) => ({
        status,
        children: subStatuses
            .filter((ss) => ss.applicableStatusIds.includes(status.id))
            .sort((a, b) => a.order - b.order),
    })).filter((p) => p.children.length > 0);

    const unassigned = subStatuses.filter((ss) => ss.applicableStatusIds.length === 0);

    return (
        <div className="max-w-5xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold">Sub-Statuses</h1>
                    <p className="text-gray-400 text-sm mt-1">
                        Organised by main status — showing which sub-statuses apply at each stage.
                    </p>
                </div>
                <button
                    onClick={() => { setCreateForm(BLANK_FORM); setShowCreate(true); }}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700"
                >
                    <Plus size={16} /> Add Sub-Status
                </button>
            </div>

            {loading ? (
                <p className="text-gray-400">Loading...</p>
            ) : (
                <div className="space-y-5">
                    {byParent.map(({ status, children }) => (
                        <div key={status.id} className="bg-white rounded-xl shadow overflow-hidden">
                            {/* Parent header */}
                            <div className="flex items-center gap-3 px-6 py-3 bg-gray-50 border-b">
                                <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${status.color}`}>
                                    {status.id}
                                </span>
                                <span className="font-semibold text-gray-700">{status.label}</span>
                                <span className="ml-auto text-xs text-gray-400">{children.length} sub-status{children.length !== 1 ? "es" : ""}</span>
                            </div>

                            {/* Children rows */}
                            <div className="divide-y">
                                {children.map((ss) => (
                                    <div key={ss.id} className="flex items-start gap-3 px-6 py-3.5">
                                        <div className="flex flex-col items-center pt-1 shrink-0">
                                            <div className="w-px h-2 bg-gray-200" />
                                            <div className="w-3 h-px bg-gray-200" />
                                        </div>

                                        <span className={`mt-0.5 text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${ss.color}`}>
                                            {ss.id}
                                        </span>

                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-sm font-medium text-gray-800">{ss.label}</span>
                                                <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                                                    {GROUP_LABELS[ss.group] ?? ss.group}
                                                </span>
                                                {ss.triggerMap[status.id] && (
                                                    <span className="flex items-center gap-1 text-xs text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full">
                                                        <ChevronRight size={11} />
                                                        → {statusLabelMap[ss.triggerMap[status.id]] ?? ss.triggerMap[status.id]}
                                                    </span>
                                                )}
                                                {ss.applicableStatusIds.length > 1 && (
                                                    <span className="text-xs text-gray-400">
                                                        also in: {ss.applicableStatusIds
                                                            .filter((sid) => sid !== status.id)
                                                            .map((sid) => statusLabelMap[sid] ?? sid)
                                                            .join(", ")}
                                                    </span>
                                                )}
                                            </div>

                                            <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-xs text-gray-500">
                                                {ss.allowedRoles.length > 0 && (
                                                    <span>
                                                        <span className="font-medium text-gray-600">Set by:</span>{" "}
                                                        {ss.allowedRoles.map((r) => ROLE_LABELS[r] ?? r).join(", ")}
                                                    </span>
                                                )}
                                                {ss.notifyRoles.length > 0 && (
                                                    <span>
                                                        <span className="font-medium text-gray-600">Notifies:</span>{" "}
                                                        {ss.notifyRoles.map((r) => ROLE_LABELS[r] ?? r).join(", ")}
                                                    </span>
                                                )}
                                            </div>

                                            {ss.fromTransitions.length > 0 && (
                                                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                                    <span className="text-xs text-gray-400">Next:</span>
                                                    {ss.fromTransitions.map((t) => (
                                                        <span key={t.to.id} className={`text-xs px-2 py-0.5 rounded-full ${t.to.color}`}>
                                                            {t.to.label}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-1.5 shrink-0">
                                            <button onClick={() => openTransitionModal(ss.id)} title="Transitions" className="flex items-center gap-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-500 hover:bg-gray-50">
                                                <GitMerge size={13} />
                                                <span className="hidden sm:inline">Flow</span>
                                            </button>
                                            <button onClick={() => openEdit(ss)} title="Edit" className="flex items-center gap-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-500 hover:bg-gray-50">
                                                <Pencil size={13} />
                                                <span className="hidden sm:inline">Edit</span>
                                            </button>
                                            <button onClick={() => handleDelete(ss.id)} disabled={deletingId === ss.id} title="Delete" className="flex items-center gap-1 text-xs border border-red-200 rounded-lg px-2 py-1.5 text-red-500 hover:bg-red-50 disabled:opacity-40">
                                                <Trash2 size={13} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}

                    {unassigned.length > 0 && (
                        <div className="bg-white rounded-xl shadow overflow-hidden">
                            <div className="flex items-center gap-3 px-6 py-3 bg-yellow-50 border-b">
                                <span className="text-xs font-semibold text-yellow-700">Unassigned</span>
                                <span className="text-xs text-yellow-600">Not linked to any main status — edit to assign.</span>
                            </div>
                            <div className="divide-y">
                                {unassigned.map((ss) => (
                                    <div key={ss.id} className="flex items-center gap-3 px-6 py-3.5">
                                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ss.color}`}>{ss.id}</span>
                                        <span className="text-sm text-gray-700 flex-1">{ss.label}</span>
                                        <div className="flex items-center gap-1.5">
                                            <button onClick={() => openEdit(ss)} className="flex items-center gap-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-500 hover:bg-gray-50">
                                                <Pencil size={13} /><span className="hidden sm:inline">Edit</span>
                                            </button>
                                            <button onClick={() => handleDelete(ss.id)} disabled={deletingId === ss.id} className="flex items-center gap-1 text-xs border border-red-200 rounded-lg px-2 py-1.5 text-red-500 hover:bg-red-50 disabled:opacity-40">
                                                <Trash2 size={13} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {showCreate && (
                <SubStatusFormModal
                    title="Add Sub-Status"
                    form={createForm}
                    setForm={setCreateForm}
                    onSave={handleCreate}
                    onClose={() => setShowCreate(false)}
                    saving={creating}
                    statuses={statuses}
                />
            )}

            {editId && (
                <SubStatusFormModal
                    title={`Edit — ${subStatuses.find((s) => s.id === editId)?.id}`}
                    form={editForm}
                    setForm={setEditForm}
                    onSave={handleEdit}
                    onClose={() => setEditId(null)}
                    saving={editing}
                    statuses={statuses}
                />
            )}

            {transitionModalId && modalSubStatus && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 max-h-[80vh] flex flex-col">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h2 className="text-base font-semibold">Step flow from</h2>
                                <span className={`text-xs px-2 py-1 rounded-full font-medium mt-1 inline-block ${modalSubStatus.color}`}>
                                    {modalSubStatus.label}
                                </span>
                            </div>
                            <button onClick={() => setTransitionModalId(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
                        </div>
                        <p className="text-xs text-gray-400 mb-3">Which sub-statuses can come after this one?</p>
                        <div className="flex-1 overflow-y-auto space-y-1 pr-1">
                            {transitionCandidates.length === 0 ? (
                                <p className="text-sm text-gray-400">No compatible sub-statuses in the same stage.</p>
                            ) : (
                                transitionCandidates.map((c) => (
                                    <label key={c.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                                        <input type="checkbox" checked={selectedToIds.includes(c.id)} onChange={() => toggleTo(c.id)} className="accent-blue-600" />
                                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.color}`}>{c.id}</span>
                                        <span className="text-sm text-gray-700">{c.label}</span>
                                    </label>
                                ))
                            )}
                        </div>
                        <div className="flex gap-3 pt-4 border-t mt-4">
                            <button onClick={() => setTransitionModalId(null)} className="flex-1 border rounded-lg py-2 text-sm hover:bg-gray-50">Cancel</button>
                            <button onClick={saveTransitions} disabled={savingTransitions} className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm hover:bg-blue-700 disabled:opacity-50">
                                {savingTransitions ? "Saving..." : "Save Flow"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
