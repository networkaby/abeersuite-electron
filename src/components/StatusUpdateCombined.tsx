"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import axios from "axios";
import { toast } from "sonner";
import { X, ArrowRight, ChevronRight } from "lucide-react";
import { useSession } from "next-auth/react";

interface NextMainStatus {
    id: string;
    label: string;
}

interface NextSubStatus {
    id: string;
    label: string;
    color: string;
    notifyRoles: string[];
    triggerStatus: { id: string; label: string } | null;
}

const ROLE_LABELS: Record<string, string> = {
    R1: "Admin", R2: "Technician", R3: "Front Desk", R4: "Despatch",
};

interface Props {
    ticket: {
        id: number;
        status: string;
        subStatusId?: string | null;
        ticketStatus: {
            label: string;
            fromTransitions: { to: NextMainStatus }[];
        };
        ticketSubStatus?: { id: string; label: string; color: string } | null;
    };
    onClose: () => void;
}

type FormData = {
    mode: "substatus" | "mainstatus";
    subStatusId: string;
    mainStatusId: string;
    note: string;
};

export default function StatusUpdateCombined({ ticket, onClose }: Props) {
    const { data: session } = useSession();
    const [nextSubStatuses, setNextSubStatuses] = useState<NextSubStatus[]>([]);
    const [loadingSubStatuses, setLoadingSubStatuses] = useState(true);

    const nextMainStatuses: NextMainStatus[] = ticket.ticketStatus.fromTransitions.map((t) => t.to);

    const { register, handleSubmit, watch, setValue, formState: { isSubmitting } } = useForm<FormData>({
        defaultValues: {
            mode: "substatus",
            subStatusId: "",
            mainStatusId: nextMainStatuses[0]?.id ?? "",
            note: "",
        },
    });

    const mode = watch("mode");
    const selectedSubId = watch("subStatusId");
    const selectedMainId = watch("mainStatusId");

    const selectedSub = nextSubStatuses.find((ss) => ss.id === selectedSubId);
    const selectedMain = nextMainStatuses.find((s) => s.id === selectedMainId);

    useEffect(() => {
        // Load next sub-statuses based on current sub-status transitions
        const currentSubId = ticket.subStatusId ?? null;
        const params = new URLSearchParams({ statusId: ticket.status });
        if (currentSubId) params.set("fromSubStatusId", currentSubId);
        else params.set("entryOnly", "true");

        axios
            .get(`/api/sub-statuses/next?${params}`)
            .then((r) => {
                setNextSubStatuses(r.data);
                if (r.data.length === 0 && nextMainStatuses.length > 0) {
                    setValue("mode", "mainstatus");
                }
            })
            .catch(() => toast.error("Failed to load sub-statuses"))
            .finally(() => setLoadingSubStatuses(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ticket.status, ticket.subStatusId]);

    const onSubmit = async (data: FormData) => {
        try {
            if (data.mode === "substatus") {
                if (!data.subStatusId) { toast.error("Select a sub-status"); return; }
                await axios.patch(`/api/tickets/${ticket.id}/sub-status`, {
                    subStatusId: data.subStatusId,
                    note: data.note || undefined,
                    changedBy: session?.user?.id,
                });
            } else {
                if (!data.mainStatusId) { toast.error("Select a status"); return; }
                await axios.put(`/api/tickets/${ticket.id}`, {
                    status: data.mainStatusId,
                    logNote: data.note || undefined,
                    changedBy: session?.user?.id,
                });
            }
            toast.success("Status updated");
            onClose();
        } catch {
            toast.error("Failed to update status");
        }
    };

    const isTerminalReopen = ticket.status === "S7" || ticket.status === "S8";

    return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">

                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h2 className="text-lg font-semibold">Update Status</h2>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ticket.ticketStatus.label ? "bg-gray-100 text-gray-600" : ""}`}>
                                {ticket.ticketStatus.label}
                            </span>
                            {ticket.ticketSubStatus && (
                                <>
                                    <ChevronRight size={12} className="text-gray-400" />
                                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ticket.ticketSubStatus.color}`}>
                                        {ticket.ticketSubStatus.label}
                                    </span>
                                </>
                            )}
                        </div>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">

                    {/* Mode tabs */}
                    {!isTerminalReopen && (
                        <div className="flex rounded-lg border overflow-hidden text-sm">
                            <button
                                type="button"
                                onClick={() => setValue("mode", "substatus")}
                                className={`flex-1 py-2 font-medium transition-colors ${mode === "substatus"
                                    ? "bg-blue-600 text-white"
                                    : "bg-white text-gray-500 hover:bg-gray-50"}`}
                            >
                                Within this stage
                            </button>
                            <button
                                type="button"
                                onClick={() => setValue("mode", "mainstatus")}
                                className={`flex-1 py-2 font-medium transition-colors border-l ${mode === "mainstatus"
                                    ? "bg-blue-600 text-white"
                                    : "bg-white text-gray-500 hover:bg-gray-50"}`}
                            >
                                Advance stage
                            </button>
                        </div>
                    )}

                    {/* Sub-status picker */}
                    {(mode === "substatus" && !isTerminalReopen) && (
                        <div>
                            {loadingSubStatuses ? (
                                <p className="text-sm text-gray-400">Loading...</p>
                            ) : nextSubStatuses.length === 0 ? (
                                <p className="text-sm text-gray-400 py-2">
                                    No further sub-status steps available. Use &ldquo;Advance stage&rdquo; to move to the next main status.
                                </p>
                            ) : (
                                <div className="space-y-1.5">
                                    {nextSubStatuses.map((ss) => (
                                        <label
                                            key={ss.id}
                                            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${selectedSubId === ss.id
                                                ? "border-blue-500 bg-blue-50"
                                                : "border-gray-200 hover:bg-gray-50"}`}
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
                                            <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${ss.color}`}>
                                                {ss.id}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            )}

                            {selectedSub?.notifyRoles && selectedSub.notifyRoles.length > 0 && (
                                <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 flex items-center gap-2 text-sm text-blue-700">
                                    <ArrowRight size={13} />
                                    Notifies: {selectedSub.notifyRoles.map((r) => ROLE_LABELS[r] ?? r).join(", ")}
                                </div>
                            )}
                            {selectedSub?.triggerStatus && (
                                <div className="mt-2 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 text-sm text-orange-700">
                                    Stage will auto-advance to <strong>{selectedSub.triggerStatus.label}</strong>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Main-status picker */}
                    {(mode === "mainstatus" || isTerminalReopen) && (
                        <div>
                            {isTerminalReopen && (
                                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-700 mb-3">
                                    ↩ This will reopen the ticket and start a new repair cycle.
                                </div>
                            )}
                            {nextMainStatuses.length === 0 ? (
                                <p className="text-sm text-gray-400 py-2">No further stages available.</p>
                            ) : (
                                <div className="space-y-1.5">
                                    {nextMainStatuses.map((s) => (
                                        <label
                                            key={s.id}
                                            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${selectedMainId === s.id
                                                ? "border-blue-500 bg-blue-50"
                                                : "border-gray-200 hover:bg-gray-50"}`}
                                        >
                                            <input
                                                type="radio"
                                                value={s.id}
                                                {...register("mainStatusId")}
                                                className="accent-blue-600"
                                            />
                                            <span className="text-sm text-gray-700">{s.label}</span>
                                        </label>
                                    ))}
                                </div>
                            )}
                            {selectedMain && (
                                <div className="mt-3 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 text-sm text-orange-700">
                                    Moving to <strong>{selectedMain.label}</strong> will clear the current sub-status.
                                </div>
                            )}
                        </div>
                    )}

                    {/* Note */}
                    <div>
                        <label className="block text-sm font-medium mb-1">
                            Note <span className="text-gray-400">(optional)</span>
                        </label>
                        <textarea
                            {...register("note")}
                            rows={2}
                            placeholder="Add context — part number, customer quote, courier details..."
                            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>

                    <div className="flex gap-3 pt-1">
                        <button type="button" onClick={onClose} className="flex-1 border rounded-lg py-2 text-sm hover:bg-gray-50">
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm hover:bg-blue-700 disabled:opacity-50"
                        >
                            {isSubmitting ? "Saving..." : isTerminalReopen ? "↩ Reopen Ticket" : "Update Status"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
