"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Lock, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

interface Props {
    ticketId: number;
    onClose: () => void;
}

export default function AddNoteModal({ ticketId, onClose }: Props) {
    const [privateNote, setPrivateNote] = useState("");
    const [publicNote, setPublicNote] = useState("");
    const [publicEnabled, setPublicEnabled] = useState(false);
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        if (!privateNote.trim() && !(publicEnabled && publicNote.trim())) {
            toast.error("Add at least one note");
            return;
        }
        setSaving(true);
        try {
            if (privateNote.trim()) {
                await axios.post(`/api/tickets/${ticketId}/notes`, { note: privateNote.trim(), visibility: "INTERNAL" });
            }
            if (publicEnabled && publicNote.trim()) {
                await axios.post(`/api/tickets/${ticketId}/notes`, { note: publicNote.trim(), visibility: "PUBLIC" });
            }
            toast.success("Note saved");
            onClose();
        } catch {
            toast.error("Failed to save note");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Add Note</DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-1.5">
                        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                            <Lock size={12} /> Private note (internal only)
                        </p>
                        <Textarea
                            autoFocus
                            rows={3}
                            value={privateNote}
                            onChange={(e) => setPrivateNote(e.target.value)}
                            placeholder="Team-only note…"
                            className="resize-none"
                        />
                    </div>

                    <div className="space-y-1.5">
                        <label className="flex cursor-pointer items-center gap-2">
                            <input
                                type="checkbox"
                                checked={publicEnabled}
                                onChange={(e) => {
                                    setPublicEnabled(e.target.checked);
                                    if (!e.target.checked) setPublicNote("");
                                }}
                                className="h-4 w-4"
                            />
                            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                                <Eye size={12} /> Send public note to customer
                            </span>
                        </label>
                        <Textarea
                            rows={3}
                            value={publicNote}
                            onChange={(e) => setPublicNote(e.target.value)}
                            placeholder="Message for the customer…"
                            disabled={!publicEnabled}
                            className={`resize-none transition-opacity ${!publicEnabled ? "opacity-40" : ""}`}
                        />
                    </div>
                </div>

                <DialogFooter className="mt-2 border-t border-border pt-4">
                    <Button onClick={onClose} variant="outline" className="flex-1">Cancel</Button>
                    <Button
                        onClick={handleSave}
                        disabled={saving || (!privateNote.trim() && !(publicEnabled && publicNote.trim()))}
                        className="flex-1"
                    >
                        {saving ? "Saving…" : "Save Note"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
