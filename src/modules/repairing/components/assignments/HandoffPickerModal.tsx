"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

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
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Assign Secondary Owner</DialogTitle>
                    <DialogDescription>
                        Multiple <strong>{role}</strong> staff are available. Pick who handles this stage.
                    </DialogDescription>
                </DialogHeader>
                <div>
                    <div className="max-h-56 overflow-y-auto space-y-1 border rounded-lg p-2">
                        {candidates.map(c => (
                            <Button
                                key={c.id}
                                onClick={() => setSelectedId(c.id)}
                                variant={selectedId === c.id ? "default" : "ghost"}
                                className="w-full justify-start gap-3 text-left"
                            >
                                <UserCheck size={14} className="shrink-0" />
                                <span className="font-medium">{c.name}</span>
                                <span className={`ml-auto text-xs ${selectedId === c.id ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{c.role}</span>
                            </Button>
                        ))}
                    </div>
                    <p className="text-xs text-muted-foreground mt-3">
                        The sub-status has already been set. You can also skip this and add a secondary owner manually from the ticket page.
                    </p>
                </div>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose}>Skip for now</Button>
                    <Button
                        type="button"
                        onClick={handleConfirm}
                        disabled={submitting || !selectedId}
                    >
                        {submitting ? "Assigning…" : "Assign"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
