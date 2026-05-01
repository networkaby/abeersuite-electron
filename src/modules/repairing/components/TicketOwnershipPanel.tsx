"use client";

import { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "sonner";
import { UserCheck, Users, X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Owner { id: number; name: string }
interface Participant { user: { id: number; name: string; role: string }; addedForRole?: string | null }

interface Props {
    ticketId: number;
    primaryOwner: Owner | null | undefined;
    participants: Participant[];
    currentUserId: number;
    canManage: boolean;
    isTerminal: boolean;
    onChanged: () => void;
}

export default function TicketOwnershipPanel({
    ticketId, primaryOwner, participants, currentUserId, canManage, isTerminal, onChanged,
}: Props) {
    const [allUsers, setAllUsers] = useState<{ id: number; name: string; role: string }[]>([]);
    const [showReassign, setShowReassign] = useState(false);
    const [showAddParticipant, setShowAddParticipant] = useState(false);
    const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [removingId, setRemovingId] = useState<number | null>(null);

    const participantIds = new Set(participants.map(p => p.user.id));

    useEffect(() => {
        if (showReassign || showAddParticipant) {
            axios.get<{ id: number; name: string; role: string }[]>("/api/users")
                .then(r => setAllUsers(r.data))
                .catch(() => {});
        }
    }, [showReassign, showAddParticipant]);

    const handleReassign = async () => {
        if (!selectedUserId) { toast.error("Select a user"); return; }
        setSubmitting(true);
        try {
            await axios.put(`/api/tickets/${ticketId}`, { primaryOwnerId: selectedUserId });
            toast.success("Primary owner updated");
            setShowReassign(false);
            setSelectedUserId(null);
            onChanged();
        } catch { toast.error("Failed to reassign"); }
        finally { setSubmitting(false); }
    };

    const handleAddParticipant = async () => {
        if (!selectedUserId) { toast.error("Select a user"); return; }
        setSubmitting(true);
        try {
            await axios.post(`/api/tickets/${ticketId}/participants`, { userId: selectedUserId });
            toast.success("Participant added");
            setShowAddParticipant(false);
            setSelectedUserId(null);
            onChanged();
        } catch (err: unknown) {
            const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
            toast.error(msg ?? "Failed to add participant");
        } finally { setSubmitting(false); }
    };

    const handleRemove = async (userId: number) => {
        setRemovingId(userId);
        try {
            await axios.delete(`/api/tickets/${ticketId}/participants/${userId}`);
            toast.success("Participant removed");
            onChanged();
        } catch { toast.error("Failed to remove"); }
        finally { setRemovingId(null); }
    };

    const userPickerClass = (id: number) =>
        `h-auto w-full justify-start gap-2 px-2 py-1.5 text-xs text-left transition-colors ${
            selectedUserId === id ? "bg-primary text-primary-foreground" : "hover:bg-muted text-foreground"
        }`;

    return (
        <div className="space-y-3 rounded-lg border border-border bg-card p-4 shadow">
            <h2 className="font-semibold text-foreground text-sm flex items-center gap-2">
                <UserCheck size={15} /> Ownership
            </h2>

            {/* Primary Owner */}
            <div>
                <p className="text-xs text-muted-foreground uppercase mb-1">Primary Owner</p>
                <div className="flex items-center justify-between gap-2">
                    <p className="text-sm text-foreground font-medium">
                        {primaryOwner?.name ?? <span className="text-muted-foreground font-normal">Unassigned</span>}
                    </p>
                    {canManage && !isTerminal && !showReassign && (
                        <Button variant="link" size="xs" onClick={() => { setShowReassign(true); setShowAddParticipant(false); setSelectedUserId(null); }}
                            className="h-auto p-0 text-xs">
                            Reassign
                        </Button>
                    )}
                </div>
                {showReassign && (
                    <div className="mt-2 space-y-1.5 rounded-md border border-border p-2">
                        <div className="max-h-40 overflow-y-auto space-y-0.5">
                            {allUsers.map(u => (
                                <Button key={u.id} variant="ghost" onClick={() => setSelectedUserId(u.id)} className={userPickerClass(u.id)}>
                                    <span className="font-medium">{u.name}</span>
                                    <span className={`ml-auto text-xs ${selectedUserId === u.id ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{u.role}</span>
                                </Button>
                            ))}
                        </div>
                        <div className="flex gap-2 pt-1">
                            <Button onClick={() => setShowReassign(false)} variant="outline" size="xs" className="flex-1">Cancel</Button>
                            <Button onClick={handleReassign} disabled={submitting || !selectedUserId} size="xs" className="flex-1">
                                {submitting ? "…" : "Confirm"}
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {/* Participants */}
            <div>
                <div className="flex items-center justify-between mb-1">
                    <p className="text-xs text-muted-foreground uppercase flex items-center gap-1">
                        <Users size={11} /> Participants
                    </p>
                    {canManage && !isTerminal && !showAddParticipant && (
                        <Button variant="link" size="xs" onClick={() => { setShowAddParticipant(true); setShowReassign(false); setSelectedUserId(null); }}
                            className="h-auto p-0 text-xs">
                            <Plus size={11} /> Add
                        </Button>
                    )}
                </div>

                {participants.length === 0 ? (
                    <p className="text-xs text-muted-foreground">None</p>
                ) : (
                    <div className="space-y-1">
                        {participants.map(p => (
                            <div key={p.user.id} className="flex items-center gap-2 text-sm">
                                <span className="flex-1 text-foreground">{p.user.name}</span>
                                {p.addedForRole && <span className="text-xs text-muted-foreground">{p.addedForRole}</span>}
                                {(canManage || p.user.id === currentUserId) && (
                                    <Button onClick={() => handleRemove(p.user.id)} disabled={removingId === p.user.id}
                                        variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-destructive disabled:opacity-50">
                                        <X size={13} />
                                    </Button>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {showAddParticipant && (
                    <div className="mt-2 space-y-1.5 rounded-md border border-border p-2">
                        <div className="max-h-40 overflow-y-auto space-y-0.5">
                            {allUsers.filter(u => u.id !== primaryOwner?.id && !participantIds.has(u.id)).map(u => (
                                <Button key={u.id} variant="ghost" onClick={() => setSelectedUserId(u.id)} className={userPickerClass(u.id)}>
                                    <span className="font-medium">{u.name}</span>
                                    <span className={`ml-auto text-xs ${selectedUserId === u.id ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{u.role}</span>
                                </Button>
                            ))}
                        </div>
                        <div className="flex gap-2 pt-1">
                            <Button onClick={() => setShowAddParticipant(false)} variant="outline" size="xs" className="flex-1">Cancel</Button>
                            <Button onClick={handleAddParticipant} disabled={submitting || !selectedUserId} size="xs" className="flex-1">
                                {submitting ? "…" : "Add"}
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
