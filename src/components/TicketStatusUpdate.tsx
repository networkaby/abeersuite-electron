"use client";

import { useForm } from "react-hook-form";
import axios from "axios";
import { toast } from "sonner";
import { X } from "lucide-react";
import { useSession } from "next-auth/react";

interface NextStatus {
    id: string;
    label: string;
}

interface Props {
    ticket: {
        id: number;
        status: string;
        ticketStatus: {
            label: string;
            fromTransitions: { to: NextStatus }[];
        };
    };
    onClose: () => void;
}

type StatusUpdateFormData = {
    status: string;
    logNote: string;
};

export default function TicketStatusUpdate({ ticket, onClose }: Props) {
    const { data: session } = useSession();
    const nextStatuses: NextStatus[] = ticket.ticketStatus.fromTransitions.map((t) => t.to);

    const { register, handleSubmit, formState: { isSubmitting } } = useForm({
        defaultValues: {
            status: nextStatuses[0]?.id || ticket.status,
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
                            Current: <span className="font-medium text-gray-600">{ticket.ticketStatus.label}</span>
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

                        {ticket.status === "S7" && (
                            <div className="rounded-lg border border-primary/20 bg-primary/10 p-3 text-sm text-primary">
                                ↩️ This will <strong>reopen</strong> the ticket and start a new repair cycle.
                            </div>
                        )}

                        <div>
                            <label className="block text-sm font-medium mb-1">New Status</label>
                            <select
                                {...register("status")}
                                className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                            >
                                {nextStatuses.map((s) => (
                                    <option key={s.id} value={s.id}>
                                        {s.label}
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
                                className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                                placeholder={
                                    ticket.status === "S7"
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
                                className="flex-1 rounded-lg bg-primary py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                            >
                                {isSubmitting
                                    ? "Saving..."
                                    : ticket.status === "S7"
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
