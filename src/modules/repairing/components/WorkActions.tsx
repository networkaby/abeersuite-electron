"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Play, CheckCircle, Lock, Eye, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

interface Props {
    ticketId: number;
    /** The work being done (for the finish note + dialog title). */
    workLabel: string;
    /** Whether the ticket is already claimed (started) by anyone. */
    isOwned: boolean;
    /** Whether the current user is the owner (can finish). */
    isOwnerMe: boolean;
    /** Called after a successful Start/Finish (defaults to router.refresh()). */
    onChanged?: () => void;
    size?: "sm" | "default";
    /** Hide the Finish action (e.g. new-ticket cards that only claim, never "finish"). */
    showFinish?: boolean;
}

/**
 * Start / Finish for a ticket's current work, reused on the Work Inbox board and
 * the ticket page. Start = claim (sets primaryOwner, so nobody double-works);
 * Finish = a feedback note written to the ticket activity.
 */
export default function WorkActions({ ticketId, workLabel, isOwned, isOwnerMe, onChanged, size = "sm", showFinish = true }: Props) {
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const [finishOpen, setFinishOpen] = useState(false);
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

    const finish = async () => {
        if (!note.trim()) { toast.error("Add a feedback note"); return; }
        setBusy(true);
        try {
            await axios.post(`/api/tickets/${ticketId}/notes`, {
                note: `✓ ${workLabel} finished — ${note.trim()}`,
                visibility,
            });
            toast.success("Finished — note added to activity");
            setFinishOpen(false);
            setNote("");
            refresh();
        } catch {
            toast.error("Failed to finish");
        } finally { setBusy(false); }
    };

    return (
        <>
            {!isOwned && (
                <Button onClick={start} disabled={busy} size={size}>
                    <Play size={13} /> Start
                </Button>
            )}
            {showFinish && isOwnerMe && (
                <Button onClick={() => setFinishOpen(true)} disabled={busy} size={size} variant="outline">
                    <CheckCircle size={13} /> Finish
                </Button>
            )}

            {finishOpen && (
                <Dialog open onOpenChange={(o) => { if (!o) setFinishOpen(false); }}>
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader className="flex-row items-center justify-between space-y-0">
                            <DialogTitle>Finish — {workLabel}</DialogTitle>
                            <Button onClick={() => setFinishOpen(false)} variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground">
                                <X size={20} />
                            </Button>
                        </DialogHeader>

                        <div className="space-y-4">
                            <Textarea
                                autoFocus
                                rows={4}
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                placeholder={`e.g. Called customer — confirmed. ${workLabel} done.`}
                                className="resize-none"
                            />
                            <div>
                                <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Visibility</p>
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
                        </div>

                        <DialogFooter className="mt-2 border-t border-border pt-4">
                            <Button onClick={() => setFinishOpen(false)} variant="outline" className="flex-1">Cancel</Button>
                            <Button onClick={finish} disabled={busy || !note.trim()} className="flex-1">{busy ? "Saving…" : "Finish"}</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}
        </>
    );
}
