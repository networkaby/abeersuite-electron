"use client";

import { useForm } from "react-hook-form";
import axios from "axios";
import { toast } from "sonner";
import { X } from "lucide-react";
import { useSession } from "next-auth/react";
import { TICKET_STATUS, NEXT_STATUSES, STATUS_LABELS } from "@/lib/constants";

interface Props {
    ticket: {
        id: number;
        status: string;
    };
    onClose: () => void;
}

type StatusUpdateFormData = {
    status: string;
    logNote: string;
};

export default function TicketStatusUpdate({ ticket, onClose }: Props) {
    const { data: session } = useSession();
    const nextStatuses = NEXT_STATUSES[ticket.status] || [];

    const { register, handleSubmit, formState: { isSubmitting } } = useForm({
        defaultValues: {
            status: nextStatuses[0] || ticket.status,
            logNote: "",
        },
    });

    const onSubmit = async (data: StatusUpdateFormData) => {
        try {
            await axios.put(`/api/tickets/${ticket.id}`, {
                ...data,
                changedBy: session?.user?.id,
            });
            toast.success("Status updated");
            onClose();
        } catch {
            toast.error("Failed to update status");
        }
    };

    return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h2 className="text-lg font-semibold">Update Status</h2>
                        <p className="text-xs text-gray-400 mt-0.5">
                            Current: <span className="font-medium text-gray-600">{STATUS_LABELS[ticket.status]}</span>
                        </p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X size={20} />
                    </button>
                </div>

                {nextStatuses.length === 0 ? (
                    <p className="text-gray-500 text-sm">No further status updates available.</p>
                ) : (
                    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">

                        {/* Reopen notice */}
                        {ticket.status === TICKET_STATUS.RETURNED && (
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-700">
                                ↩️ This will <strong>reopen</strong> the ticket and start a new repair cycle.
                            </div>
                        )}

                        <div>
                            <label className="block text-sm font-medium mb-1">New Status</label>
                            <select
                                {...register("status")}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                {nextStatuses.map((s) => (
                                    <option key={s} value={s}>
                                        {STATUS_LABELS[s]}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1">
                                Note <span className="text-gray-400">(optional)</span>
                            </label>
                            <textarea
                                {...register("logNote")}
                                rows={3}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder={
                                    ticket.status === TICKET_STATUS.RETURNED
                                        ? "Why is this being reopened?"
                                        : "Add a note about this status change..."
                                }
                            />
                        </div>

                        <div className="flex gap-3 pt-2">
                            <button
                                type="button"
                                onClick={onClose}
                                className="flex-1 border rounded-lg py-2 text-sm hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className={`flex-1 text-white rounded-lg py-2 text-sm disabled:opacity-50 ${ticket.status === TICKET_STATUS.RETURNED
                                        ? "bg-blue-500 hover:bg-blue-600"
                                        : "bg-blue-600 hover:bg-blue-700"
                                    }`}
                            >
                                {isSubmitting
                                    ? "Saving..."
                                    : ticket.status === TICKET_STATUS.RETURNED
                                        ? "↩️ Reopen Ticket"
                                        : "Update Status"}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}