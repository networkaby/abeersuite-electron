"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { X, Lock, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

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
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader className="flex-row items-center justify-between space-y-0">
                    <DialogTitle>Add Note</DialogTitle>
                    <Button onClick={onClose} variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground">
                        <X size={20} />
                    </Button>
                </DialogHeader>

                <div className="space-y-4">
                    <Textarea
                        autoFocus
                        rows={4}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="e.g. Called customer — no answer. Will try again tomorrow."
                        className="resize-none"
                    />

                    <div>
                        <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Visibility</p>
                        <div className="flex gap-2">
                            <Button type="button" onClick={() => setVisibility("INTERNAL")} variant="outline"
                                className={`h-auto flex-1 items-center gap-2 px-3 py-2 text-sm font-medium transition-colors ${
                                    visibility === "INTERNAL"
                                        ? "border-border bg-muted text-foreground"
                                        : "border-border text-muted-foreground hover:bg-muted"
                                }`}>
                                <Lock size={13} /> Internal
                                <span className="text-xs font-normal text-muted-foreground ml-auto">staff only</span>
                            </Button>
                            <Button type="button" onClick={() => setVisibility("PUBLIC")} variant="outline"
                                className={`h-auto flex-1 items-center gap-2 px-3 py-2 text-sm font-medium transition-colors ${
                                    visibility === "PUBLIC"
                                        ? "border-primary bg-primary/10 text-primary"
                                        : "border-border text-muted-foreground hover:bg-muted"
                                }`}>
                                <Eye size={13} /> Public
                                <span className="text-xs font-normal ml-auto">customer visible</span>
                            </Button>
                        </div>
                    </div>
                </div>

                <DialogFooter className="mt-2 border-t border-border pt-4">
                    <Button onClick={onClose} variant="outline" className="flex-1">Cancel</Button>
                    <Button onClick={handleSave} disabled={saving || !note.trim()} className="flex-1">
                        {saving ? "Saving..." : "Save Note"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
