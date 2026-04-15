"use client";

import { useForm } from "react-hook-form";
import axios from "axios";
import { toast } from "sonner";
import { X } from "lucide-react";
import { useSession } from "next-auth/react";

const STATUSES = [
    "RECEIVED",
    "DIAGNOSING",
    "REPAIRING",
    "ESCALATED",
    "RECEIVED_BACK",
    "READY",
    "RETURNED",
];

interface Props {
    ticket: any;
    onClose: () => void;
}

export default function TicketStatusUpdate({ ticket, onClose }: Props) {
    const { data: session } = useSession();
    const { register, handleSubmit, formState: { isSubmitting } } = useForm({
        defaultValues: {
            status: ticket.status,
            logNote: "",
        },
    });

    const onSubmit = async (data: any) => {
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
                    <h2 className="text-lg font-semibold">Update Status</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-1">New Status</label>
                        <select
                            {...register("status")}
                            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                            {STATUSES.map((s) => (
                                <option key={s} value={s}>
                                    {s.replace("_", " ")}
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
                            placeholder="Add a note about this status change..."
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
                            className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm hover:bg-blue-700 disabled:opacity-50"
                        >
                            {isSubmitting ? "Saving..." : "Update"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}