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
    const [visibility, setVisibility] = useState<"INTERNAL" | "PUBLIC">("INTERNAL");
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
            <div className="border-2 border-border shadow bg-card w-full max-w-md p-6">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold">Add Note</h2>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
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
                        className="w-full resize-none border-2 border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />

                    <div>
                        <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Visibility</p>
                        <div className="flex gap-2">
                            <button type="button" onClick={() => setVisibility("INTERNAL")}
                                className={`flex items-center gap-2 flex-1 px-3 py-2 border-2 text-sm font-medium transition-colors ${
                                    visibility === "INTERNAL"
                                        ? "border-border bg-muted text-foreground"
                                        : "border-border text-muted-foreground hover:bg-muted"
                                }`}>
                                <Lock size={13} /> Internal
                                <span className="text-xs font-normal text-muted-foreground ml-auto">staff only</span>
                            </button>
                            <button type="button" onClick={() => setVisibility("PUBLIC")}
                                className={`flex items-center gap-2 flex-1 px-3 py-2 border-2 text-sm font-medium transition-colors ${
                                    visibility === "PUBLIC"
                                        ? "border-primary bg-primary/10 text-primary"
                                        : "border-border text-muted-foreground hover:bg-muted"
                                }`}>
                                <Eye size={13} /> Public
                                <span className="text-xs font-normal ml-auto">customer visible</span>
                            </button>
                        </div>
                    </div>
                </div>

                <div className="flex gap-3 pt-4 mt-2 border-t border-border">
                    <button onClick={onClose} className="flex-1 border-2 border-border py-2 text-sm hover:bg-muted">Cancel</button>
                    <button onClick={handleSave} disabled={saving || !note.trim()}
                        className="flex-1 border-2 border-primary bg-primary py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                        {saving ? "Saving..." : "Save Note"}
                    </button>
                </div>
            </div>
        </div>
    );
}
