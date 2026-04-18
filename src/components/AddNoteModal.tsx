"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { X, Lock, Eye } from "lucide-react";

interface Props {
    ticketId: number;
    onClose: () => void;
}

export default function AddNoteModal({ ticketId, onClose }: Props) {
    const [note, setNote] = useState("");
    const [visibility, setVisibility] = useState<"internal" | "public">("internal");
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        if (!note.trim()) { toast.error("Note cannot be empty"); return; }
        setSaving(true);
        try {
            await axios.post(`/api/tickets/${ticketId}/notes`, { note, visibility });
            toast.success("Note saved");
            onClose();
        } catch {
            toast.error("Failed to save note");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold">Add Note</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X size={20} />
                    </button>
                </div>

                <div className="space-y-4">
                    <textarea
                        autoFocus
                        rows={4}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="e.g. Called customer — no answer. Will try again tomorrow."
                        className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    />

                    {/* Visibility toggle */}
                    <div>
                        <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">Visibility</p>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => setVisibility("internal")}
                                className={`flex items-center gap-2 flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                                    visibility === "internal"
                                        ? "border-gray-400 bg-gray-100 text-gray-700"
                                        : "border-gray-200 text-gray-400 hover:bg-gray-50"
                                }`}
                            >
                                <Lock size={13} />
                                Internal
                                <span className="text-xs font-normal text-gray-400 ml-auto">staff only</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setVisibility("public")}
                                className={`flex items-center gap-2 flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                                    visibility === "public"
                                        ? "border-blue-400 bg-blue-50 text-blue-700"
                                        : "border-gray-200 text-gray-400 hover:bg-gray-50"
                                }`}
                            >
                                <Eye size={13} />
                                Public
                                <span className="text-xs font-normal ml-auto">customer visible</span>
                            </button>
                        </div>
                    </div>
                </div>

                <div className="flex gap-3 pt-4 mt-2 border-t">
                    <button
                        onClick={onClose}
                        className="flex-1 border rounded-lg py-2 text-sm hover:bg-gray-50"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving || !note.trim()}
                        className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm hover:bg-blue-700 disabled:opacity-50"
                    >
                        {saving ? "Saving..." : "Save Note"}
                    </button>
                </div>
            </div>
        </div>
    );
}
