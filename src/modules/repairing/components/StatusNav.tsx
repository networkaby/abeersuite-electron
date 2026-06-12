"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ArrowRight, ArrowLeft, Lock, Eye, LockKeyhole, Share2, Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

/** A sub-status hand-off — stays in the current stage, routes the work elsewhere. */
interface SubTarget { id: string; label: string; work: { label: string; color: string } | null }
/** A real stage change. `isTerminal` = a close-out (Closed / Cancelled). */
interface StatusTarget { id: string; label: string; color?: string; isTerminal?: boolean }
type Pending =
    | { dir: "next"; kind: "sub" | "status"; id: string; label: string }
    | { dir: "back"; statusId: string; subStatusId: string | null; label: string };

interface Props {
    ticketId: number;
    statusId: string;
    subStatusId: string | null;
    isWarranty: boolean;
    started: boolean;
    /** Lock all nav buttons — shown when work is in progress. */
    locked?: boolean;
    nextStatuses: StatusTarget[];
    backTarget: { statusId: string; subStatusId: string | null; label: string } | null;
    onChanged: () => void;
}

export default function StatusNav({
    ticketId, statusId, subStatusId, isWarranty, started, locked = false, nextStatuses, backTarget, onChanged,
}: Props) {
    const [nextSubs, setNextSubs] = useState<SubTarget[]>([]);
    const [pending, setPending] = useState<Pending | null>(null);
    const [privateNote, setPrivateNote] = useState("");
    const [publicNote, setPublicNote] = useState("");
    const [publicEnabled, setPublicEnabled] = useState(false);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        const fwd = new URLSearchParams({ statusId, isWarranty: String(isWarranty) });
        if (subStatusId) fwd.set("fromSubStatusId", subStatusId); else fwd.set("entryOnly", "true");
        try {
            const r = await axios.get(`/api/sub-statuses/next?${fwd}`);
            setNextSubs((r.data as SubTarget[]).map((s) => ({ id: s.id, label: s.label, work: s.work ?? null })));
        } catch { setNextSubs([]); }
    }, [statusId, subStatusId, isWarranty]);

    useEffect(() => { load(); }, [load]);

    const close = () => { setPending(null); setPrivateNote(""); setPublicNote(""); setPublicEnabled(false); };

    const submit = async () => {
        if (!pending) return;
        setBusy(true);
        try {
            if (pending.dir === "back") {
                // True undo: restore exact previous (status, sub-status) pair.
                await axios.put(`/api/tickets/${ticketId}`, {
                    status: pending.statusId,
                    restoreSubStatusId: pending.subStatusId,
                    logNote: privateNote.trim() || undefined,
                    visibility: "INTERNAL",
                });
            } else if (pending.kind === "sub") {
                await axios.patch(`/api/tickets/${ticketId}/sub-status`, {
                    subStatusId: pending.id,
                    note: privateNote.trim() || undefined,
                    visibility: "INTERNAL",
                });
            } else {
                await axios.put(`/api/tickets/${ticketId}`, {
                    status: pending.id,
                    logNote: privateNote.trim() || undefined,
                    visibility: "INTERNAL",
                });
            }
            // Post the public note separately if checkbox is on and note is filled
            if (publicEnabled && publicNote.trim()) {
                await axios.post(`/api/tickets/${ticketId}/notes`, {
                    note: publicNote.trim(),
                    visibility: "PUBLIC",
                });
            }
            toast.success(pending.dir === "back" ? `Reverted to ${pending.label}` : `Moved to ${pending.label}`);
            close();
            onChanged();
        } catch (err: unknown) {
            toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Failed to move");
        } finally { setBusy(false); }
    };

    // Hand-off: stays in the stage, routes the work to another team (the Work badge).
    const subBtn = (t: SubTarget) => (
        <Button
            key={`sub-${t.id}`}
            onClick={() => setPending({ dir: "next", kind: "sub", id: t.id, label: t.label })}
            size="sm" variant="outline"
            className="w-full justify-start gap-2"
        >
            <Share2 size={13} className="shrink-0 text-muted-foreground" />
            <span className="truncate">{t.label}</span>
            {t.work && (
                <span className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${t.work.color}`}>{t.work.label}</span>
            )}
        </Button>
    );

    // Real stage change — advances the ticket to a new stage.
    const statusBtn = (t: StatusTarget) => (
        <Button
            key={`st-${t.id}`}
            onClick={() => setPending({ dir: "next", kind: "status", id: t.id, label: t.label })}
            size="sm" variant="outline"
            className="w-full justify-start gap-2 border-primary/40 hover:bg-primary/5"
        >
            <ArrowRight size={13} className="shrink-0 text-primary" />
            <span className="truncate font-medium">{t.label}</span>
        </Button>
    );

    // Close-out — a terminal stage (Closed / Cancelled).
    const terminalBtn = (t: StatusTarget) => (
        <Button
            key={`tm-${t.id}`}
            onClick={() => setPending({ dir: "next", kind: "status", id: t.id, label: t.label })}
            size="sm" variant="outline"
            className="w-full justify-start gap-2 text-muted-foreground"
        >
            <Flag size={13} className="shrink-0" />
            <span className="truncate">{t.label}</span>
        </Button>
    );

    const section = (title: string, hint: string, children: ReactNode) => (
        <div className="space-y-1.5">
            <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
                <p className="text-[11px] leading-tight text-muted-foreground/70">{hint}</p>
            </div>
            <div className="flex flex-col gap-1.5">{children}</div>
        </div>
    );

    const forwardStatuses = nextStatuses.filter((s) => !s.isTerminal);
    const terminalStatuses = nextStatuses.filter((s) => s.isTerminal);
    const hasNext = nextSubs.length > 0 || nextStatuses.length > 0;

    return (
        <div className="space-y-3 rounded-lg border border-border bg-card p-4 shadow">
            <h2 className="text-sm font-semibold text-foreground">Move ticket</h2>

            {locked ? (
                <p className="flex items-center gap-1.5 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                    <LockKeyhole size={13} className="shrink-0" />
                    Complete or abandon current work to move this ticket.
                </p>
            ) : (
                <>
                    {nextSubs.length > 0 && section(
                        "Hand off · request",
                        "Routes the work to another team — ticket stays in this stage.",
                        nextSubs.map(subBtn),
                    )}
                    {forwardStatuses.length > 0 && section(
                        "Change stage",
                        "Advances the ticket to a new stage.",
                        forwardStatuses.map(statusBtn),
                    )}
                    {terminalStatuses.length > 0 && section(
                        "Close out",
                        "Ends this ticket.",
                        terminalStatuses.map(terminalBtn),
                    )}
                    {!hasNext && (
                        <p className="text-xs text-muted-foreground">No next step configured.</p>
                    )}

                    {backTarget && (
                        <Button
                            onClick={() => setPending({ dir: "back", statusId: backTarget.statusId, subStatusId: backTarget.subStatusId, label: backTarget.label })}
                            size="sm" variant="ghost"
                            className="w-full justify-start gap-1.5 border border-dashed border-border text-muted-foreground"
                        >
                            <ArrowLeft size={13} />
                            <span className="truncate">Back to {backTarget.label}</span>
                        </Button>
                    )}
                </>
            )}

            {pending && (
                <Dialog open onOpenChange={(o) => { if (!o) close(); }}>
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle>
                                {pending.dir === "back" ? `← Back to ${pending.label}` : `Move → ${pending.label}`}
                            </DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4">
                            {started && (
                                <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                                    This work is in progress — moving will leave it.
                                </p>
                            )}
                            <div className="space-y-1.5">
                                <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                                    <Lock size={12} /> Private note (internal only)
                                </p>
                                <Textarea
                                    autoFocus
                                    rows={2}
                                    value={privateNote}
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
                                    rows={2}
                                    value={publicNote}
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
                                {busy ? "Saving…" : pending.dir === "back" ? "← Revert" : "Move →"}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}
        </div>
    );
}
