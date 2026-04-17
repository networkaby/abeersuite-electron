"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ChevronRight, GitMerge, LayoutList, X } from "lucide-react";

interface SubStatus {
    id: string;
    label: string;
    color: string;
    group: string;
    order: number;
    applicableStatusIds: string[];
    allowedRoles: string[];
    notifyRoles: string[];
    triggerStatus: { id: string; label: string } | null;
    fromTransitions: { to: { id: string; label: string; color: string } }[];
}

const GROUP_LABELS: Record<string, string> = {
    customer_comm: "Customer Communication",
    approval: "Quote & Approval",
    parts: "Parts",
    qc: "Quality Check",
    escalated: "Escalated",
    ready: "Ready for Collection",
    no_fix: "No Fix",
};

const ROLE_LABELS: Record<string, string> = {
    R1: "Admin", R2: "Technician", R3: "Front Desk", R4: "Despatch",
};

const ALL_STATUSES = [
    { id: "S1", label: "Received" },
    { id: "S2", label: "Diagnosing" },
    { id: "S3", label: "Repairing" },
    { id: "S4", label: "Escalated" },
    { id: "S5", label: "Received Back" },
    { id: "S6", label: "Ready" },
    { id: "S7", label: "Returned" },
    { id: "S8", label: "Closed — No Fix" },
    { id: "S9", label: "Cancelled" },
];

const STATUS_LABELS = Object.fromEntries(ALL_STATUSES.map((s) => [s.id, s.label]));

export default function SubStatusesPage() {
    const [subStatuses, setSubStatuses] = useState<SubStatus[]>([]);
    const [loading, setLoading] = useState(true);
    const [transitionModalId, setTransitionModalId] = useState<string | null>(null);
    const [selectedToIds, setSelectedToIds] = useState<string[]>([]);
    const [savingTransitions, setSavingTransitions] = useState(false);

    // Applies-to modal
    const [appliesToModalId, setAppliesToModalId] = useState<string | null>(null);
    const [selectedStatusIds, setSelectedStatusIds] = useState<string[]>([]);
    const [savingAppliesTo, setSavingAppliesTo] = useState(false);

    const fetchSubStatuses = async () => {
        try {
            const res = await axios.get("/api/sub-statuses");
            setSubStatuses(res.data);
        } catch {
            toast.error("Failed to load sub-statuses");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchSubStatuses(); }, []);

    const grouped = subStatuses.reduce<Record<string, SubStatus[]>>((acc, ss) => {
        (acc[ss.group] ??= []).push(ss);
        return acc;
    }, {});

    const openTransitionModal = (id: string) => {
        const ss = subStatuses.find((s) => s.id === id);
        setSelectedToIds(ss?.fromTransitions.map((t) => t.to.id) ?? []);
        setTransitionModalId(id);
    };

    const saveTransitions = async () => {
        if (!transitionModalId) return;
        setSavingTransitions(true);
        try {
            await axios.put(`/api/sub-statuses/${transitionModalId}/transitions`, {
                toIds: selectedToIds,
            });
            toast.success("Transitions saved");
            setTransitionModalId(null);
            fetchSubStatuses();
        } catch {
            toast.error("Failed to save transitions");
        } finally {
            setSavingTransitions(false);
        }
    };

    const toggleTo = (id: string) =>
        setSelectedToIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        );

    const openAppliesToModal = (id: string) => {
        const ss = subStatuses.find((s) => s.id === id);
        setSelectedStatusIds(ss?.applicableStatusIds ?? []);
        setAppliesToModalId(id);
    };

    const saveAppliesTo = async () => {
        if (!appliesToModalId) return;
        setSavingAppliesTo(true);
        try {
            await axios.patch(`/api/sub-statuses/${appliesToModalId}`, {
                applicableStatusIds: selectedStatusIds,
            });
            toast.success("Applies-to saved");
            setAppliesToModalId(null);
            fetchSubStatuses();
        } catch {
            toast.error("Failed to save");
        } finally {
            setSavingAppliesTo(false);
        }
    };

    const toggleStatus = (id: string) =>
        setSelectedStatusIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        );

    const modalSubStatus = subStatuses.find((s) => s.id === transitionModalId);

    // Candidates for "can transition to": same group sub-statuses excluding itself
    const transitionCandidates = modalSubStatus
        ? subStatuses.filter(
              (s) =>
                  s.id !== modalSubStatus.id &&
                  s.applicableStatusIds.some((sid) =>
                      modalSubStatus.applicableStatusIds.includes(sid)
                  )
          )
        : [];

    return (
        <div className="max-w-4xl mx-auto">
            <div className="mb-6">
                <h1 className="text-2xl font-bold">Sub-Statuses</h1>
                <p className="text-gray-400 text-sm mt-1">
                    Sub-statuses add detail within a main stage and trigger team notifications. Transitions define the allowed step-by-step flow.
                </p>
            </div>

            {loading ? (
                <p className="text-gray-400">Loading...</p>
            ) : (
                <div className="space-y-6">
                    {Object.entries(GROUP_LABELS).map(([group, groupLabel]) => {
                        const items = grouped[group] ?? [];
                        return (
                            <div key={group} className="bg-white rounded-xl shadow">
                                <div className="px-6 py-4 border-b">
                                    <h2 className="font-semibold text-gray-700">{groupLabel}</h2>
                                    <p className="text-xs text-gray-400 mt-0.5">
                                        Applies to:{" "}
                                        {[...new Set(items.flatMap((ss) => ss.applicableStatusIds))]
                                            .map((sid) => STATUS_LABELS[sid] ?? sid)
                                            .join(", ") || "—"}
                                    </p>
                                </div>

                                {items.length === 0 ? (
                                    <p className="px-6 py-4 text-sm text-gray-400">No sub-statuses in this group.</p>
                                ) : (
                                    <div className="divide-y">
                                        {items.map((ss) => (
                                            <div key={ss.id} className="px-6 py-4 flex items-start gap-4">
                                                <span className={`mt-0.5 text-xs px-2 py-1 rounded-full font-medium shrink-0 ${ss.color}`}>
                                                    {ss.id}
                                                </span>

                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="text-sm font-medium text-gray-800">{ss.label}</span>
                                                        {ss.triggerStatus && (
                                                            <span className="flex items-center gap-1 text-xs text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full">
                                                                <ChevronRight size={11} />
                                                                {ss.triggerStatus.label}
                                                            </span>
                                                        )}
                                                    </div>

                                                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-gray-500">
                                                        {ss.allowedRoles.length > 0 && (
                                                            <span>
                                                                <span className="font-medium text-gray-700">Set by:</span>{" "}
                                                                {ss.allowedRoles.map((r) => ROLE_LABELS[r] ?? r).join(", ")}
                                                            </span>
                                                        )}
                                                        {ss.notifyRoles.length > 0 && (
                                                            <span>
                                                                <span className="font-medium text-gray-700">Notifies:</span>{" "}
                                                                {ss.notifyRoles.map((r) => ROLE_LABELS[r] ?? r).join(", ")}
                                                            </span>
                                                        )}
                                                    </div>

                                                    {ss.fromTransitions.length > 0 && (
                                                        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                                                            <span className="text-xs text-gray-400">→</span>
                                                            {ss.fromTransitions.map((t) => (
                                                                <span key={t.to.id} className={`text-xs px-2 py-0.5 rounded-full ${t.to.color}`}>
                                                                    {t.to.label}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="flex flex-col gap-1.5 shrink-0">
                                                    <button
                                                        onClick={() => openAppliesToModal(ss.id)}
                                                        className="flex items-center gap-1.5 text-xs border border-gray-300 rounded-lg px-2.5 py-1.5 text-gray-600 hover:bg-gray-50"
                                                    >
                                                        <LayoutList size={13} />
                                                        Applies to
                                                    </button>
                                                    <button
                                                        onClick={() => openTransitionModal(ss.id)}
                                                        className="flex items-center gap-1.5 text-xs border border-gray-300 rounded-lg px-2.5 py-1.5 text-gray-600 hover:bg-gray-50"
                                                    >
                                                        <GitMerge size={13} />
                                                        Transitions
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Applies-to modal */}
            {appliesToModalId && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h2 className="text-base font-semibold">Applies to</h2>
                                <p className="text-xs text-gray-400 mt-0.5">
                                    {subStatuses.find((s) => s.id === appliesToModalId)?.label}
                                </p>
                            </div>
                            <button onClick={() => setAppliesToModalId(null)} className="text-gray-400 hover:text-gray-600">
                                <X size={18} />
                            </button>
                        </div>

                        <p className="text-xs text-gray-400 mb-3">
                            Select which main statuses this sub-status can appear under:
                        </p>

                        <div className="space-y-1">
                            {ALL_STATUSES.map((s) => (
                                <label key={s.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={selectedStatusIds.includes(s.id)}
                                        onChange={() => toggleStatus(s.id)}
                                        className="accent-blue-600"
                                    />
                                    <span className="text-xs text-gray-400 w-6">{s.id}</span>
                                    <span className="text-sm text-gray-700">{s.label}</span>
                                </label>
                            ))}
                        </div>

                        <div className="flex gap-3 pt-4 border-t mt-4">
                            <button
                                onClick={() => setAppliesToModalId(null)}
                                className="flex-1 border rounded-lg py-2 text-sm hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={saveAppliesTo}
                                disabled={savingAppliesTo}
                                className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm hover:bg-blue-700 disabled:opacity-50"
                            >
                                {savingAppliesTo ? "Saving..." : "Save"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Transition modal */}
            {transitionModalId && modalSubStatus && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 max-h-[80vh] flex flex-col">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h2 className="text-base font-semibold">Transitions from</h2>
                                <span className={`text-xs px-2 py-1 rounded-full font-medium mt-1 inline-block ${modalSubStatus.color}`}>
                                    {modalSubStatus.label}
                                </span>
                            </div>
                            <button onClick={() => setTransitionModalId(null)} className="text-gray-400 hover:text-gray-600">
                                <X size={18} />
                            </button>
                        </div>

                        <p className="text-xs text-gray-400 mb-3">
                            Select which sub-statuses this one can transition to:
                        </p>

                        <div className="flex-1 overflow-y-auto space-y-1 pr-1">
                            {transitionCandidates.length === 0 ? (
                                <p className="text-sm text-gray-400">No compatible sub-statuses found.</p>
                            ) : (
                                transitionCandidates.map((candidate) => (
                                    <label
                                        key={candidate.id}
                                        className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selectedToIds.includes(candidate.id)}
                                            onChange={() => toggleTo(candidate.id)}
                                            className="accent-blue-600"
                                        />
                                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${candidate.color}`}>
                                            {candidate.id}
                                        </span>
                                        <span className="text-sm text-gray-700">{candidate.label}</span>
                                    </label>
                                ))
                            )}
                        </div>

                        <div className="flex gap-3 pt-4 border-t mt-4">
                            <button
                                onClick={() => setTransitionModalId(null)}
                                className="flex-1 border rounded-lg py-2 text-sm hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={saveTransitions}
                                disabled={savingTransitions}
                                className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm hover:bg-blue-700 disabled:opacity-50"
                            >
                                {savingTransitions ? "Saving..." : "Save Transitions"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
