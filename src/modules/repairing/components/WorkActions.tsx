"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Play, CheckCircle, Lock, Eye, X, ArrowRight, ThumbsUp, ThumbsDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

interface RouteTarget { id: string; label: string }

interface Props {
    ticketId: number;
    /** The work being done (for the dialog title). */
    workLabel: string;
    /** Where this sub-status routes on a successful outcome (null = none configured). */
    successTarget?: RouteTarget | null;
    /** Where it routes on an unsuccessful outcome. */
    failTarget?: RouteTarget | null;
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
 * Complete = the caller picks Success or Unsuccess and the ticket moves to the
 * sub-status that the *current* sub-status routes that outcome to (configured on
 * the source sub-status). The move goes through the sub-status PATCH (which
 * auto-advances the main status via triggerMap and logs the feedback note).
 */
export default function WorkActions({
    ticketId, workLabel, successTarget, failTarget,
    isOwned, isOwnerMe, onChanged, size = "sm", showComplete = true,
}: Props) {
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const [open, setOpen] = useState(false);
    const [note, setNote] = useState("");
    const [visibility, setVisibility] = useState<"INTERNAL" | "PUBLIC">("INTERNAL");

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

    const moveTo = async (target: RouteTarget | null, kind: string) => {
        setBusy(true);
        try {
            if (target) {
                await axios.patch(`/api/tickets/${ticketId}/sub-status`, { subStatusId: target.id, note: note.trim() || undefined, visibility });
                toast.success(`${kind} → ${target.label}`);
            } else {
                await axios.delete(`/api/tickets/${ticketId}/sub-status`);
                toast.success("Marked done");
            }
            setOpen(false); setNote("");
            refresh();
        } catch (err: unknown) {
            toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Failed to complete");
        } finally { setBusy(false); }
    };

    return (
        <>
            {!isOwned && (
                <Button onClick={start} disabled={busy} size={size}>
                    <Play size={13} /> Start
                </Button>
            )}
            {showComplete && isOwnerMe && (
                <Button onClick={() => setOpen(true)} disabled={busy} size={size} variant="outline">
                    <CheckCircle size={13} /> Complete
                </Button>
            )}

            {open && (
                <Dialog open onOpenChange={(o) => { if (!o) setOpen(false); }}>
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
                                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Outcome</p>
                                {!successTarget && !failTarget ? (
                                    <Button onClick={() => moveTo(null, "Done")} disabled={busy} variant="outline" className="w-full justify-between">
                                        Mark done (clear sub-status) <ArrowRight size={14} />
                                    </Button>
                                ) : (
                                    <div className="space-y-2">
                                        {successTarget && (
                                            <Button onClick={() => moveTo(successTarget, "Success")} disabled={busy} variant="outline"
                                                className="w-full justify-between border-green-300 text-green-700 hover:bg-green-50 dark:border-green-800 dark:text-green-300">
                                                <span className="flex items-center gap-2"><ThumbsUp size={14} /> Success → {successTarget.label}</span>
                                                <ArrowRight size={14} />
                                            </Button>
                                        )}
                                        {failTarget && (
                                            <Button onClick={() => moveTo(failTarget, "Unsuccess")} disabled={busy} variant="outline"
                                                className="w-full justify-between border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300">
                                                <span className="flex items-center gap-2"><ThumbsDown size={14} /> Unsuccess → {failTarget.label}</span>
                                                <ArrowRight size={14} />
                                            </Button>
                                        )}
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
