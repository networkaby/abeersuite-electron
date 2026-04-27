"use client";

import { useState, useEffect } from "react";
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
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>
                        {action === "pass" ? "Pass Ticket" : "Reject Assignment"}
                    </DialogTitle>
                    <DialogDescription>
                        {action === "pass"
                            ? "Choose who should take over this ticket."
                            : "Return this ticket to the unassigned pool so someone else can claim it."}
                    </DialogDescription>
                </DialogHeader>
                <div>
                    {action === "reject" ? (
                        <p className="text-sm text-muted-foreground">
                            This will return the ticket to the unassigned pool. Someone else can claim it.
                        </p>
                    ) : (
                        <div className="space-y-3">
                            <p className="text-sm text-muted-foreground">Select who to pass this ticket to:</p>
                            <div className="max-h-56 overflow-y-auto space-y-1 border rounded-lg p-2">
                                {users.map(u => (
                                    <Button
                                        key={u.id}
                                        onClick={() => setSelectedId(u.id)}
                                        variant={selectedId === u.id ? "default" : "ghost"}
                                        className="w-full justify-start gap-3 text-left"
                                    >
                                        <UserCheck size={14} className="shrink-0" />
                                        <span className="font-medium">{u.name}</span>
                                        <span className={`ml-auto text-xs ${selectedId === u.id ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{u.role}</span>
                                    </Button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                    <Button
                        type="button"
                        onClick={handleSubmit}
                        disabled={submitting || (action === "pass" && !selectedId)}
                        variant={action === "reject" ? "destructive" : "default"}
                    >
                        {submitting ? "…" : action === "pass" ? "Pass Ticket" : "Return to Pool"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
