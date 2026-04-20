"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { X, UserCheck } from "lucide-react";

interface Candidate { id: number; name: string; role: string }

interface Props {
    ticketId: number;
    role: string;
    subStatusId: string;
    candidates: Candidate[];
    onClose: () => void;
    onDone: () => void;
}

export default function HandoffPickerModal({ ticketId, role, subStatusId, candidates, onClose, onDone }: Props) {
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const handleConfirm = async () => {
        if (!selectedId) { toast.error("Select a person"); return; }
        setSubmitting(true);
        try {
            await axios.post(`/api/tickets/${ticketId}/participants`, {
                userId: selectedId,
                addedForRole: role,
                addedBySubStatusId: subStatusId,
            });
            toast.success("Secondary owner assigned");
            onDone();
        } catch (err: unknown) {
            const errData = (err as { response?: { data?: { error?: string; code?: string } } })?.response?.data;
            if (errData?.code === "ROLE_MISMATCH") {
                toast.error("That person no longer has the required role. Please refresh and try again.");
            } else {
                toast.error(errData?.error ?? "Failed to assign");
            }
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
                <div className="flex items-center justify-between p-5 border-b">
                    <div>
                        <h2 className="font-semibold text-gray-800">Assign Secondary Owner</h2>
                        <p className="text-xs text-gray-400 mt-0.5">
                            Multiple <strong>{role}</strong> staff available — pick who handles this stage
                        </p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
                </div>
                <div className="p-5">
                    <div className="max-h-56 overflow-y-auto space-y-1 border rounded-lg p-2">
                        {candidates.map(c => (
                            <button
                                key={c.id}
                                onClick={() => setSelectedId(c.id)}
                                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                                    selectedId === c.id ? "bg-blue-600 text-white" : "hover:bg-gray-50 text-gray-700"
                                }`}
                            >
                                <UserCheck size={14} className="shrink-0" />
                                <span className="font-medium">{c.name}</span>
                                <span className={`ml-auto text-xs ${selectedId === c.id ? "text-blue-100" : "text-gray-400"}`}>{c.role}</span>
                            </button>
                        ))}
                    </div>
                    <p className="text-xs text-gray-400 mt-3">
                        The sub-status has already been set. You can also skip this and add a secondary owner manually from the ticket page.
                    </p>
                </div>
                <div className="flex gap-3 px-5 pb-5">
                    <button onClick={onClose} className="flex-1 border rounded-lg py-2 text-sm hover:bg-gray-50">Skip for now</button>
                    <button
                        onClick={handleConfirm}
                        disabled={submitting || !selectedId}
                        className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm hover:bg-blue-700 disabled:opacity-50"
                    >
                        {submitting ? "Assigning…" : "Assign"}
                    </button>
                </div>
            </div>
        </div>
    );
}
