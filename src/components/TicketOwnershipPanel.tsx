"use client";

import { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "sonner";
import { UserCheck, Users, X, Plus } from "lucide-react";

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
        `w-full flex items-center gap-2 px-2 py-1.5 text-xs text-left transition-colors ${
            selectedUserId === id ? "bg-primary text-primary-foreground" : "hover:bg-muted text-foreground"
        }`;

    return (
        <div className="border-2 border-border shadow bg-card p-4 space-y-3">
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
                        <button onClick={() => { setShowReassign(true); setShowAddParticipant(false); setSelectedUserId(null); }}
                            className="text-xs text-primary hover:underline">
                            Reassign
                        </button>
                    )}
                </div>
                {showReassign && (
                    <div className="mt-2 border-2 border-border p-2 space-y-1.5">
                        <div className="max-h-40 overflow-y-auto space-y-0.5">
                            {allUsers.map(u => (
                                <button key={u.id} onClick={() => setSelectedUserId(u.id)} className={userPickerClass(u.id)}>
                                    <span className="font-medium">{u.name}</span>
                                    <span className={`ml-auto text-xs ${selectedUserId === u.id ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{u.role}</span>
                                </button>
                            ))}
                        </div>
                        <div className="flex gap-2 pt-1">
                            <button onClick={() => setShowReassign(false)} className="flex-1 border-2 border-border py-1 text-xs hover:bg-muted">Cancel</button>
                            <button onClick={handleReassign} disabled={submitting || !selectedUserId}
                                className="flex-1 border-2 border-primary bg-primary py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                                {submitting ? "…" : "Confirm"}
                            </button>
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
                        <button onClick={() => { setShowAddParticipant(true); setShowReassign(false); setSelectedUserId(null); }}
                            className="text-xs text-primary hover:underline flex items-center gap-1">
                            <Plus size={11} /> Add
                        </button>
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
                                    <button onClick={() => handleRemove(p.user.id)} disabled={removingId === p.user.id}
                                        className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50">
                                        <X size={13} />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {showAddParticipant && (
                    <div className="mt-2 border-2 border-border p-2 space-y-1.5">
                        <div className="max-h-40 overflow-y-auto space-y-0.5">
                            {allUsers.filter(u => u.id !== primaryOwner?.id && !participantIds.has(u.id)).map(u => (
                                <button key={u.id} onClick={() => setSelectedUserId(u.id)} className={userPickerClass(u.id)}>
                                    <span className="font-medium">{u.name}</span>
                                    <span className={`ml-auto text-xs ${selectedUserId === u.id ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{u.role}</span>
                                </button>
                            ))}
                        </div>
                        <div className="flex gap-2 pt-1">
                            <button onClick={() => setShowAddParticipant(false)} className="flex-1 border-2 border-border py-1 text-xs hover:bg-muted">Cancel</button>
                            <button onClick={handleAddParticipant} disabled={submitting || !selectedUserId}
                                className="flex-1 border-2 border-primary bg-primary py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                                {submitting ? "…" : "Add"}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
