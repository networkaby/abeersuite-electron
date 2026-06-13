"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Play, Check, X, CheckCircle, Lock, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { type WorkArg, isUserArg, argKey, argMatchesOutcome } from "@/modules/repairing/lib/ticketSources";

interface RouteTarget { id: string; label: string }
interface Pending { target: RouteTarget | null; kind: string; done: string }

interface Props {
    ticketId: number;
    /** The work being done (for the dialog title). */
    workLabel: string;
    /** Custom outcome-button labels from the Work (e.g. "Reachable" / "Unreachable").
     *  null → the buttons stay icon-only (generic). */
    successLabel?: string | null;
    failLabel?: string | null;
    /** The work's arguments — user-given ones are collected in the completion dialog. */
    args?: WorkArg[];
    /** Where this worker routes on a successful outcome (null = none configured). */
    successTarget?: RouteTarget | null;
    /** Where it routes on an unsuccessful outcome. */
    failTarget?: RouteTarget | null;
    /** Current worker owns a retry schedule — Unsuccess re-arms it (waits, then retries). */
    retryScheduled?: boolean;
    /** Whether the ticket is already claimed (started) by anyone. */
    isOwned: boolean;
    /** Whether the current user is the owner (can complete). */
    isOwnerMe: boolean;
    /** Called after a successful Start/Complete (defaults to router.refresh()). */
    onChanged?: () => void;
    size?: "sm" | "default";
    /** Hide the outcome actions (e.g. new-ticket cards that only claim). */
    showComplete?: boolean;
}

/**
 * Start / outcome actions for a ticket's current work, reused on the Work Inbox
 * board and the ticket page. Start = claim (sets primaryOwner, no double-work).
 * When you own it, the two outcomes show directly as colour-coded buttons —
 * green Success / red Unsuccess — that move the ticket to the worker the
 * *current* worker routes that outcome to (configured on the source). A quick
 * note box captures the feedback (→ ticket activity) before the move. Works with
 * no routing fall back to a single neutral Complete (clear).
 */
export default function WorkActions({
    ticketId, workLabel, successLabel, failLabel, args = [], successTarget, failTarget, retryScheduled = false,
    isOwned, isOwnerMe, onChanged, size = "sm", showComplete = true,
}: Props) {
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const [pending, setPending] = useState<Pending | null>(null);
    const [privateNote, setPrivateNote] = useState("");
    const [publicNote, setPublicNote] = useState("");
    const [publicEnabled, setPublicEnabled] = useState(false);
    const [argValues, setArgValues] = useState<Record<string, string>>({});

    const userArgs = args.filter(isUserArg);  // collected from the operator at completion
    // Only collect the inputs that apply to the outcome being pressed (on: success/fail/always).
    const pendingArgs = pending ? userArgs.filter((a) => argMatchesOutcome(a, pending.kind)) : [];
    const refresh = () => { if (onChanged) onChanged(); else router.refresh(); };
    const close = () => { setPending(null); setPrivateNote(""); setPublicNote(""); setPublicEnabled(false); setArgValues({}); };

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

    const submit = async () => {
        if (!pending) return;
        setBusy(true);
        try {
            // Tag the completion outcome so it lands in the Work Inbox "Finished" list.
            const outcome = pending.kind === "Success" ? "success" : pending.kind === "Unsuccess" ? "unsuccess" : undefined;
            // Collected user-given arguments (for this outcome) → saved into the ticket's context.
            const collected = Object.fromEntries(
                pendingArgs.map((a) => [argKey(a), (argValues[argKey(a)] ?? "").trim()]).filter(([, v]) => v),
            );
            if (pending.target) {
                await axios.patch(`/api/tickets/${ticketId}/worker`, {
                    workerId: pending.target.id,
                    note: privateNote.trim() || undefined,
                    visibility: "INTERNAL",
                    outcome,
                    args: Object.keys(collected).length ? collected : undefined,
                });
            } else {
                await axios.delete(`/api/tickets/${ticketId}/worker`);
            }
            if (publicEnabled && publicNote.trim()) {
                await axios.post(`/api/tickets/${ticketId}/notes`, { note: publicNote.trim(), visibility: "PUBLIC" });
            }
            toast.success(pending.done);
            close();
            refresh();
        } catch (err: unknown) {
            toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Failed to complete");
        } finally { setBusy(false); }
    };

    const hasRouting = !!(successTarget || failTarget);

    return (
        <>
            {!isOwned && (
                <Button onClick={start} disabled={busy} size={size}>
                    <Play size={13} /> Reply
                    {/* Start */}
                </Button>
            )}
            {showComplete && isOwnerMe && (hasRouting ? (
                <>
                    {successTarget && (
                        <Button
                            onClick={() => setPending({ target: successTarget, kind: "Success", done: `${successLabel || "Success"} → ${successTarget.label}` })}
                            disabled={busy} size={size} variant="outline" title={`${successLabel || "Success"} → ${successTarget.label}`}
                            className="border-green-300 bg-green-50 text-green-700 hover:bg-green-100 dark:border-green-800 dark:bg-green-950 dark:text-green-300"
                        >
                            <Check size={20} className="text-green-500" />
                            {successLabel && <span>{successLabel}</span>}
                        </Button>
                    )}
                    {failTarget && (
                        <Button
                            onClick={() => setPending({ target: failTarget, kind: "Unsuccess", done: retryScheduled ? "Next attempt scheduled" : `${failLabel || "Unsuccess"} → ${failTarget.label}` })}
                            disabled={busy} size={size} variant="outline" title={retryScheduled ? "Couldn't — schedule next attempt" : `${failLabel || "Unsuccess"} → ${failTarget.label}`}
                            className="border-red-300 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
                        >
                            <X size={50} className="text-red-500" />
                            {failLabel && <span>{failLabel}</span>}
                        </Button>
                    )}
                </>
            ) : (
                <Button onClick={() => setPending({ target: null, kind: "Done", done: "Marked done" })} disabled={busy} size={size} variant="outline">
                    <CheckCircle size={13} /> Complete
                </Button>
            ))}

            {pending && (
                <Dialog open onOpenChange={(o) => { if (!o) close(); }}>
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle>{pending.target ? `${pending.kind} — ${workLabel}` : `Complete — ${workLabel}`}</DialogTitle>
                        </DialogHeader>

                        <div className="space-y-4">
                            {pending.target && (
                                retryScheduled && pending.kind === "Unsuccess" ? (
                                    <p className="text-sm text-muted-foreground">
                                        This attempt is recorded as unsuccessful. The <span className="font-medium text-foreground">next attempt is scheduled automatically</span> — the ticket moves to <span className="font-medium text-foreground">Waiting</span> until it&apos;s due.
                                    </p>
                                ) : (
                                    <p className="text-sm text-muted-foreground">
                                        Moves to <span className="font-medium text-foreground">{pending.target.label}</span>.
                                    </p>
                                )
                            )}
                            {pendingArgs.length > 0 && (
                                <div className="space-y-2 rounded-md border border-border bg-muted/30 p-2.5">
                                    {pendingArgs.map((a) => (
                                        <div key={argKey(a)} className="space-y-1">
                                            <label className="text-xs font-medium text-foreground">{a.label}</label>
                                            <Input
                                                value={argValues[argKey(a)] ?? ""}
                                                onChange={(e) => setArgValues((v) => ({ ...v, [argKey(a)]: e.target.value }))}
                                                placeholder={a.label}
                                                className="h-8"
                                            />
                                        </div>
                                    ))}
                                </div>
                            )}
                            <div className="space-y-1.5">
                                <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                                    <Lock size={12} /> Private note (internal only)
                                </p>
                                <Textarea
                                    autoFocus rows={2} value={privateNote}
                                    onChange={(e) => setPrivateNote(e.target.value)}
                                    placeholder="Team-only note (optional)…"
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
                                    rows={2} value={publicNote}
                                    onChange={(e) => setPublicNote(e.target.value)}
                                    placeholder="Message for the customer…"
                                    disabled={!publicEnabled}
                                    className={`resize-none transition-opacity ${!publicEnabled ? "opacity-40" : ""}`}
                                />
                            </div>
                        </div>

                        <DialogFooter className="mt-2 border-t border-border pt-4">
                            <Button onClick={close} variant="outline" className="flex-1">Cancel</Button>
                            <Button onClick={submit} disabled={busy} className="flex-1">
                                {busy ? "Saving…" : retryScheduled && pending.kind === "Unsuccess" ? "Schedule retry" : pending.target ? `Move → ${pending.target.label}` : "Mark done"}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}
        </>
    );
}
