"use client";

import { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "sonner";
import { X, UserCheck } from "lucide-react";

interface User { id: number; name: string; role: string }

interface Props {
    ticketId: number;
    action: "pass" | "reject";
    onClose: () => void;
    onDone: () => void;
}

export default function PassRejectModal({ ticketId, action, onClose, onDone }: Props) {
    const [users, setUsers] = useState<User[]>([]);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (action === "pass") {
            axios.get<User[]>("/api/users").then(r => setUsers(r.data)).catch(() => {});
        }
    }, [action]);

    const handleSubmit = async () => {
        if (action === "pass" && !selectedId) {
            toast.error("Select a person to pass to");
            return;
        }
        setSubmitting(true);
        try {
            await axios.post(`/api/tickets/${ticketId}/assign`, {
                action,
                ...(action === "pass" && { toUserId: selectedId }),
            });
            toast.success(action === "pass" ? "Ticket passed" : "Ticket returned to pool");
            onDone();
        } catch (err: unknown) {
            const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
            toast.error(msg ?? "Failed");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
                <div className="flex items-center justify-between p-5 border-b">
                    <h2 className="font-semibold text-gray-800">
                        {action === "pass" ? "Pass Ticket" : "Reject Assignment"}
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
                </div>
                <div className="p-5">
                    {action === "reject" ? (
                        <p className="text-sm text-gray-600">
                            This will return the ticket to the unassigned pool. Someone else can claim it.
                        </p>
                    ) : (
                        <div className="space-y-3">
                            <p className="text-sm text-gray-600">Select who to pass this ticket to:</p>
                            <div className="max-h-56 overflow-y-auto space-y-1 border rounded-lg p-2">
                                {users.map(u => (
                                    <button
                                        key={u.id}
                                        onClick={() => setSelectedId(u.id)}
                                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                                            selectedId === u.id ? "bg-blue-600 text-white" : "hover:bg-gray-50 text-gray-700"
                                        }`}
                                    >
                                        <UserCheck size={14} className="shrink-0" />
                                        <span className="font-medium">{u.name}</span>
                                        <span className={`ml-auto text-xs ${selectedId === u.id ? "text-blue-100" : "text-gray-400"}`}>{u.role}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
                <div className="flex gap-3 px-5 pb-5">
                    <button onClick={onClose} className="flex-1 border rounded-lg py-2 text-sm hover:bg-gray-50">Cancel</button>
                    <button
                        onClick={handleSubmit}
                        disabled={submitting || (action === "pass" && !selectedId)}
                        className={`flex-1 rounded-lg py-2 text-sm text-white disabled:opacity-50 ${
                            action === "reject" ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"
                        }`}
                    >
                        {submitting ? "…" : action === "pass" ? "Pass Ticket" : "Return to Pool"}
                    </button>
                </div>
            </div>
        </div>
    );
}
