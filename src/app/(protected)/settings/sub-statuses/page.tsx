"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ChevronRight } from "lucide-react";

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
    R1: "Admin",
    R2: "Technician",
    R3: "Front Desk",
    R4: "Despatch",
};

const STATUS_LABELS: Record<string, string> = {
    S1: "Received", S2: "Diagnosing", S3: "Repairing",
    S4: "Escalated", S5: "Received Back", S6: "Ready",
    S7: "Returned", S8: "Closed — No Fix", S9: "Cancelled",
};

export default function SubStatusesPage() {
    const [subStatuses, setSubStatuses] = useState<SubStatus[]>([]);
    const [loading, setLoading] = useState(true);

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

    return (
        <div className="max-w-4xl mx-auto">
            <div className="mb-6">
                <h1 className="text-2xl font-bold">Sub-Statuses</h1>
                <p className="text-gray-400 text-sm mt-1">
                    Sub-statuses add detail within a main status and trigger team notifications.
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
                                        {[
                                            ...new Set(items.flatMap((ss) => ss.applicableStatusIds)),
                                        ]
                                            .map((sid) => STATUS_LABELS[sid] ?? sid)
                                            .join(", ") || "—"}
                                    </p>
                                </div>

                                {items.length === 0 ? (
                                    <p className="px-6 py-4 text-sm text-gray-400">No sub-statuses in this group.</p>
                                ) : (
                                    <div className="divide-y">
                                        {items.map((ss) => (
                                            <div
                                                key={ss.id}
                                                className="px-6 py-4 flex items-start gap-4"
                                            >
                                                <span className={`mt-0.5 text-xs px-2 py-1 rounded-full font-medium shrink-0 ${ss.color}`}>
                                                    {ss.id}
                                                </span>

                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm font-medium text-gray-800">
                                                            {ss.label}
                                                        </span>
                                                        {ss.triggerStatus && (
                                                            <span className="flex items-center gap-1 text-xs text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full">
                                                                <ChevronRight size={11} />
                                                                {ss.triggerStatus.label}
                                                            </span>
                                                        )}
                                                    </div>

                                                    <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-500">
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
                                                        <span>
                                                            <span className="font-medium text-gray-700">Applies to:</span>{" "}
                                                            {ss.applicableStatusIds
                                                                .map((sid) => STATUS_LABELS[sid] ?? sid)
                                                                .join(", ")}
                                                        </span>
                                                    </div>
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
        </div>
    );
}
