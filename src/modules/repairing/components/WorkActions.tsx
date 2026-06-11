"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Play, CheckCircle, Lock, Eye, X, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

interface NextStep { id: string; label: string; color?: string }

interface Props {
    ticketId: number;
    /** The work being done (for the dialog title). */
    workLabel: string;
    /** Ticket's current main status id (for the flow's next-step lookup). */
    statusId: string;
    /** Current sub-status id, or null when the ticket has none yet (entry). */
    subStatusId?: string | null;
    isWarranty?: boolean;
    /** Whether the ticket is already claimed (started) by anyone. */
    isOwned: boolean;
    /** Whether the current user is the owner (can complete). */
    isOwnerMe: boolean;
    /** Called after a successful Start/Complete (defaults to router.refresh()). */
    onChanged?: () => void;
    size?: "sm" | "default";
    /** Hide the Complete action (e.g. new-ticket cards that only claim). */
    showComplete?: boolean;
}

/**
 * Start / Complete for a ticket's current work, reused on the Work Inbox board and
 * the ticket page. Start = claim (sets primaryOwner, so nobody double-works).
 * Complete = move the sub-status along the configured flow — "success" and
 * "unsuccess" are just different next-steps (e.g. "Ready" vs "Customer Unreachable")
 * — carrying a feedback note into the ticket activity. Reuses the sub-status PATCH
 * (which auto-advances the main status via triggerMap and logs the move).
 */
export default function WorkActions({
    ticketId, workLabel, statusId, subStatusId, isWarranty = false,
    isOwned, isOwnerMe, onChanged, size = "sm", showComplete = true,
}: Props) {
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const [open, setOpen] = useState(false);
    const [note, setNote] = useState("");
    const [visibility, setVisibility] = useState<"INTERNAL" | "PUBLIC">("INTERNAL");
    const [steps, setSteps] = useState<NextStep[] | null>(null); // null = loading

    const refresh = () => { if (onChanged) onChanged(); else router.refresh(); };

    const start = async () => {
        setBusy(true);
        try {
            await axios.post(`/api/tickets/${ticketId}/assign`, { action: "claim" });
            toast.success(`Started — ${workLabel}`);
            refresh();
        } catch (err: unknown) {
            toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Failed to start");
        } finally { setBusy(false); }
    };

    const openComplete = async () => {
        setOpen(true);
        setSteps(null);
        try {
            const params = new URLSearchParams({ statusId, isWarranty: String(isWarranty) });
            if (subStatusId) params.set("fromSubStatusId", subStatusId);
            else params.set("entryOnly", "true");
            const res = await axios.get(`/api/sub-statuses/next?${params.toString()}`);
            setSteps(res.data as NextStep[]);
        } catch {
            setSteps([]);
        }
    };

    const moveTo = async (target: NextStep | null) => {
        setBusy(true);
        try {
            if (target) {
                await axios.patch(`/api/tickets/${ticketId}/sub-status`, {
                    subStatusId: target.id,
                    note: note.trim() || undefined,
                    visibility,
                });
                toast.success(`Moved to ${target.label}`);
            } else {
                await axios.delete(`/api/tickets/${ticketId}/sub-status`); // no next step → just clear
                toast.success("Marked done");
            }
            setOpen(false); setNote(""); setSteps(null);
            refresh();
        } catch (err: unknown) {
            toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Failed to complete");
        } finally { setBusy(false); }
    };

    const dotOf = (color?: string) => color?.split(" ").find((c) => c.startsWith("bg-")) ?? "bg-muted-foreground";

    return (
        <>
            {!isOwned && (
                <Button onClick={start} disabled={busy} size={size}>
                    <Play size={13} /> Start
                </Button>
            )}
            {showComplete && isOwnerMe && (
                <Button onClick={openComplete} disabled={busy} size={size} variant="outline">
                    <CheckCircle size={13} /> Complete
                </Button>
            )}

            {open && (
                <Dialog open onOpenChange={(o) => { if (!o) { setOpen(false); setSteps(null); } }}>
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader className="flex-row items-center justify-between space-y-0">
                            <DialogTitle>Complete — {workLabel}</DialogTitle>
                            <Button onClick={() => setOpen(false)} variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground">
                                <X size={20} />
                            </Button>
                        </DialogHeader>

                        <div className="space-y-4">
                            <Textarea
                                autoFocus rows={3} value={note}
                                onChange={(e) => setNote(e.target.value)}
                                placeholder={`Feedback / outcome for ${workLabel}…`}
                                className="resize-none"
                            />
                            <div>
                                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Visibility</p>
                                <div className="flex gap-2">
                                    <Button type="button" onClick={() => setVisibility("INTERNAL")} variant="outline"
                                        className={`h-auto flex-1 items-center gap-2 px-3 py-2 text-sm font-medium ${visibility === "INTERNAL" ? "border-border bg-muted text-foreground" : "border-border text-muted-foreground hover:bg-muted"}`}>
                                        <Lock size={13} /> Internal
                                    </Button>
                                    <Button type="button" onClick={() => setVisibility("PUBLIC")} variant="outline"
                                        className={`h-auto flex-1 items-center gap-2 px-3 py-2 text-sm font-medium ${visibility === "PUBLIC" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}>
                                        <Eye size={13} /> Public
                                    </Button>
                                </div>
                            </div>
                            <div>
                                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Outcome — move to</p>
                                {steps === null ? (
                                    <p className="text-sm text-muted-foreground">Loading next steps…</p>
                                ) : steps.length === 0 ? (
                                    <Button onClick={() => moveTo(null)} disabled={busy} variant="outline" className="w-full justify-between">
                                        Mark done (clear sub-status) <ArrowRight size={14} />
                                    </Button>
                                ) : (
                                    <div className="space-y-2">
                                        {steps.map((s) => (
                                            <Button key={s.id} onClick={() => moveTo(s)} disabled={busy} variant="outline" className="w-full justify-between">
                                                <span className="flex items-center gap-2">
                                                    <span className={`h-2 w-2 rounded-full ${dotOf(s.color)}`} aria-hidden />
                                                    {s.label}
                                                </span>
                                                <ArrowRight size={14} />
                                            </Button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>
            )}
        </>
    );
}
