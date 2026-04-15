"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { RotateCcw, X } from "lucide-react";

interface Props {
    ticketId: number;
}

export default function TicketReopenButton({ ticketId }: Props) {
    const { data: session } = useSession();
    const router = useRouter();
    const [showModal, setShowModal] = useState(false);
    const [reason, setReason] = useState("");
    const [loading, setLoading] = useState(false);

    const handleReopen = async () => {
        setLoading(true);
        try {
            const res = await axios.post(`/api/tickets/${ticketId}/reopen`, {
                reason,
                userId: session?.user?.id,
            });
            toast.success(`New Ticket #${res.data.id} created!`);
            setShowModal(false);
            // Open receipt for new ticket
            window.open(`/receipt/${res.data.id}`, "_blank");
            router.push(`/tickets/${res.data.id}`);
        } catch {
            toast.error("Failed to reopen ticket");
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <button
                onClick={() => setShowModal(true)}
                className="w-full border border-blue-400 text-blue-500 rounded-lg py-2 text-sm hover:bg-blue-50 flex items-center justify-center gap-2"
            >
                <RotateCcw size={15} />
                Reopen / Same Problem
            </button>

            {showModal && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold">Reopen Ticket</h2>
                            <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-700 mb-4">
                            This will create a <strong>new ticket</strong> for the same device, linked to this ticket&apos;s history.
                        </div>

                        <div className="space-y-3">
                            <div>
                                <label className="block text-sm font-medium mb-1">
                                    Reason <span className="text-gray-400">(optional)</span>
                                </label>
                                <textarea
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                    rows={3}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    placeholder="e.g. Problem still exists after repair..."
                                />
                            </div>

                            <div className="flex gap-3 pt-1">
                                <button
                                    onClick={() => setShowModal(false)}
                                    className="flex-1 border rounded-lg py-2 text-sm hover:bg-gray-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleReopen}
                                    disabled={loading}
                                    className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm hover:bg-blue-700 disabled:opacity-50"
                                >
                                    {loading ? "Creating..." : "Create New Ticket"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}