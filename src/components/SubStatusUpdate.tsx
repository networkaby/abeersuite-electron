"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import axios from "axios";
import { toast } from "sonner";
import { X, ArrowRight } from "lucide-react";
import { useSession } from "next-auth/react";

interface SubStatus {
    id: string;
    label: string;
    color: string;
    group: string;
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

interface Props {
    ticket: { id: number; status: string };
    onClose: () => void;
}

type FormData = { subStatusId: string; note: string };

export default function SubStatusUpdate({ ticket, onClose }: Props) {
    const { data: session } = useSession();
    const [subStatuses, setSubStatuses] = useState<SubStatus[]>([]);
    const [loading, setLoading] = useState(true);

    const { register, handleSubmit, watch, formState: { isSubmitting } } = useForm<FormData>({
        defaultValues: { subStatusId: "", note: "" },
    });

    const selectedId = watch("subStatusId");
    const selected = subStatuses.find((ss) => ss.id === selectedId);

    useEffect(() => {
        axios
            .get(`/api/sub-statuses?statusId=${ticket.status}`)
            .then((r) => setSubStatuses(r.data))
            .catch(() => toast.error("Failed to load sub-statuses"))
            .finally(() => setLoading(false));
    }, [ticket.status]);

    const onSubmit = async (data: FormData) => {
        if (!data.subStatusId) {
            toast.error("Please select a sub-status");
            return;
        }
        try {
            await axios.patch(`/api/tickets/${ticket.id}/sub-status`, {
                subStatusId: data.subStatusId,
                note: data.note || undefined,
                changedBy: session?.user?.id,
            });
            toast.success("Sub-status updated");
            onClose();
        } catch {
            toast.error("Failed to update sub-status");
        }
    };

    // Group sub-statuses by group
    const grouped = subStatuses.reduce<Record<string, SubStatus[]>>((acc, ss) => {
        (acc[ss.group] ??= []).push(ss);
        return acc;
    }, {});

    return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h2 className="text-lg font-semibold">Update Sub-Status</h2>
                        <p className="text-xs text-gray-400 mt-0.5">
                            Add detail or trigger a handoff
                        </p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X size={20} />
                    </button>
                </div>

                {loading ? (
                    <p className="text-sm text-gray-400">Loading...</p>
                ) : subStatuses.length === 0 ? (
                    <p className="text-sm text-gray-500">No sub-statuses available for this status.</p>
                ) : (
                    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                        <div className="space-y-3">
                            {Object.entries(grouped).map(([group, items]) => (
                                <div key={group}>
                                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                                        {GROUP_LABELS[group] ?? group}
                                    </p>
                                    <div className="space-y-1">
                                        {items.map((ss) => (
                                            <label
                                                key={ss.id}
                                                className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${selectedId === ss.id
                                                    ? "border-blue-500 bg-blue-50"
                                                    : "border-gray-200 hover:bg-gray-50"
                                                    }`}
                                            >
                                                <input
                                                    type="radio"
                                                    value={ss.id}
                                                    {...register("subStatusId")}
                                                    className="accent-blue-600"
                                                />
                                                <div className="flex-1">
                                                    <span className="text-sm text-gray-700">{ss.label}</span>
                                                    {ss.triggerStatus && (
                                                        <span className="ml-2 text-xs text-orange-600 font-medium">
                                                            → {ss.triggerStatus.label}
                                                        </span>
                                                    )}
                                                </div>
                                                <span className={`text-xs px-2 py-0.5 rounded-full ${ss.color}`}>
                                                    {ss.id}
                                                </span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {selected && selected.notifyRoles.length > 0 && (
                            <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 flex items-center gap-2 text-sm text-blue-700">
                                <ArrowRight size={14} />
                                Notifies:{" "}
                                {selected.notifyRoles
                                    .map((r) => ROLE_LABELS[r] ?? r)
                                    .join(", ")}
                            </div>
                        )}

                        {selected?.triggerStatus && (
                            <div className="bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 text-sm text-orange-700">
                                Status will auto-advance to{" "}
                                <strong>{selected.triggerStatus.label}</strong>
                            </div>
                        )}

                        <div>
                            <label className="block text-sm font-medium mb-1">
                                Note <span className="text-gray-400">(optional)</span>
                            </label>
                            <textarea
                                {...register("note")}
                                rows={3}
                                placeholder="Add context — missing item, part number, customer quote, etc."
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>

                        <div className="flex gap-3 pt-1">
                            <button
                                type="button"
                                onClick={onClose}
                                className="flex-1 border rounded-lg py-2 text-sm hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={isSubmitting || !selectedId}
                                className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm hover:bg-blue-700 disabled:opacity-50"
                            >
                                {isSubmitting ? "Saving..." : "Update Sub-Status"}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
