"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import axios from "axios";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { navigateInApp } from "@/modules/repairing/lib/clientNav";
import { ArrowRight, ArrowLeft, Lock, Eye, LockKeyhole, Share2, Flag, HelpCircle } from "lucide-react";
import { badgeColor } from "@/shared/lib/format/entityColor";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { argKey, type WorkArg } from "@/modules/repairing/lib/ticketSources";

/** A worker hand-off — stays in the current stage, routes the work elsewhere.
 *  skipNoteOnEntry hides the note popup (friction-free move); entryQuestion is the
 *  guidance shown in that popup (the answer goes in the private/public note). */
interface SubTarget { id: string; label: string; work: { label: string; color: string } | null; skipNoteOnEntry?: boolean; requireNoteOnEntry?: boolean; entryQuestion?: string | null; entryArgs?: WorkArg[] }
/** A real stage change. `isTerminal` = a close-out (Closed / Cancelled). */
interface StatusTarget { id: string; label: string; color?: string; isTerminal?: boolean }
type Pending =
    | { dir: "next"; kind: "sub" | "status"; id: string; label: string; entryQuestion?: string | null; requireNote?: boolean }
    | { dir: "back"; statusId: string; workerId: string | null; label: string };
// The SEPARATE worker-context popup (technician fills key→value fields on hand-off).
// Independent of the log popup: shown whenever the work has entry fields, regardless
// of skipNoteOnEntry. If the log popup is also on, this leads into it (sequential).
type CtxPending = { id: string; label: string; entryArgs: WorkArg[]; skipNote: boolean; requireNote: boolean; entryQuestion: string | null };

interface Props {
    ticketId: number;
    statusId: string;
    workerId: string | null;
    isWarranty: boolean;
    started: boolean;
    /** Lock all nav buttons — shown when work is in progress. */
    locked?: boolean;
    /** Confirmation message configured on the CURRENT status — shown when leaving it
     *  for another stage (null = no prompt). */
    leavePrompt?: string | null;
    nextStatuses: StatusTarget[];
    backTarget: { statusId: string; workerId: string | null; label: string } | null;
    /** When set, FORWARD moves (change stage / close out) are blocked with this
     *  reason; Back and same-stage hand-offs stay allowed. Used e.g. to force a
     *  shipping slip before a device can advance past a send-to-service stage. */
    forwardBlockedReason?: string | null;
    onChanged: () => void;
}

export default function StatusNav({
    ticketId, statusId, workerId, isWarranty, started, locked = false, leavePrompt, nextStatuses, backTarget, forwardBlockedReason, onChanged,
}: Props) {
    const [nextSubs, setNextSubs] = useState<SubTarget[]>([]);
    const [pending, setPending] = useState<Pending | null>(null);
    const [ctxPending, setCtxPending] = useState<CtxPending | null>(null);
    const [privateNote, setPrivateNote] = useState("");
    const [publicNote, setPublicNote] = useState("");
    const [publicEnabled, setPublicEnabled] = useState(false);
    // Worker-context fields the technician types on hand-off (keyed by argKey).
    const [entryValues, setEntryValues] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    const router = useRouter();

    const load = useCallback(async () => {
        const fwd = new URLSearchParams({ statusId, isWarranty: String(isWarranty) });
        if (workerId) fwd.set("fromWorkerId", workerId); else fwd.set("entryOnly", "true");
        try {
            const r = await axios.get(`/api/workers/next?${fwd}`);
            setNextSubs((r.data as SubTarget[]).map((s) => ({ id: s.id, label: s.label, work: s.work ?? null, skipNoteOnEntry: !!s.skipNoteOnEntry, requireNoteOnEntry: !!s.requireNoteOnEntry, entryQuestion: s.entryQuestion ?? null, entryArgs: s.entryArgs ?? [] })));
        } catch { setNextSubs([]); }
    }, [statusId, workerId, isWarranty]);

    useEffect(() => { load(); }, [load]);

    const close = () => { setPending(null); setCtxPending(null); setPrivateNote(""); setPublicNote(""); setPublicEnabled(false); setEntryValues({}); };

    const submit = async () => {
        if (!pending) return;
        setBusy(true);
        let openTabs: string[] = [];
        let navigateTo: string | null = null;
        try {
            if (pending.dir === "back") {
                // True undo: restore exact previous (status, worker) pair.
                await axios.put(`/api/tickets/${ticketId}`, {
                    status: pending.statusId,
                    restoreWorkerId: pending.workerId,
                    logNote: privateNote.trim() || undefined,
                    visibility: "INTERNAL",
                });
            } else if (pending.kind === "sub") {
                // Any worker-context values collected in the (preceding) context popup
                // persist in entryValues → merged into Ticket.context by the worker route.
                const collected = Object.fromEntries(
                    Object.entries(entryValues).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v),
                );
                const res = await axios.patch(`/api/tickets/${ticketId}/worker`, {
                    workerId: pending.id,
                    note: privateNote.trim() || undefined,
                    visibility: "INTERNAL",
                    args: Object.keys(collected).length ? collected : undefined,
                });
                openTabs = (res.data?.openTabs ?? []) as string[];
                navigateTo = (res.data?.navigateTo ?? null) as string | null;
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
            // Pop any tabs server-side Actions deemed openable (still in the user's click).
            openTabs.forEach((u) => window.open(u, "_blank", "noopener,noreferrer"));
            // A navigate Action takes the user to an in-app page (or external URL).
            if (navigateTo) { navigateInApp(router, navigateTo); return; }
            onChanged();
        } catch (err: unknown) {
            toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Failed to move");
        } finally { setBusy(false); }
    };

    // Direct stage move with no dialog — used when the status being LEFT has no
    // leave prompt configured (frictionless move). Same PUT as submit()'s status path.
    const commitStatus = async (statusId: string, label: string) => {
        setBusy(true);
        try {
            await axios.put(`/api/tickets/${ticketId}`, { status: statusId, visibility: "INTERNAL" });
            toast.success(`Moved to ${label}`);
            onChanged();
        } catch (err: unknown) {
            toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Failed to move");
        } finally { setBusy(false); }
    };

    // A stage change either opens the leave-prompt dialog (status has a prompt) or
    // moves instantly (no prompt). The prompt lives on the status being LEFT.
    const moveStage = (t: StatusTarget) => {
        if (leavePrompt) setPending({ dir: "next", kind: "status", id: t.id, label: t.label });
        else commitStatus(t.id, t.label);
    };

    // Hand-off move. Frictionless when the target opts out of the note popup
    // (skipNoteOnEntry); otherwise open the dialog so the operator can write a note,
    // with the target's entryQuestion shown as guidance. The worker's transition note
    // (if any) auto-posts on the server either way.
    const commitSub = async (id: string, label: string, args?: Record<string, string>) => {
        setBusy(true);
        try {
            const res = await axios.patch(`/api/tickets/${ticketId}/worker`, {
                workerId: id,
                visibility: "INTERNAL",
                args: args && Object.keys(args).length ? args : undefined,
            });
            toast.success(`Moved to ${label}`);
            close();
            // Pop any tabs server-side Actions deemed openable (still in the user's click).
            ((res.data?.openTabs ?? []) as string[]).forEach((u) => window.open(u, "_blank", "noopener,noreferrer"));
            // A navigate Action takes the user to an in-app page (or external URL).
            const navTo = (res.data?.navigateTo ?? null) as string | null;
            if (navTo) { navigateInApp(router, navTo); return; }
            onChanged();
        } catch (err: unknown) {
            toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Failed to move");
        } finally { setBusy(false); }
    };
    // Hand-off opens TWO independent popups, each only if its toggle is on:
    //   • worker-context popup — when the work has entry fields (any skipNoteOnEntry).
    //   • log popup — when skipNoteOnEntry is off.
    // Both on → context first, then the log popup (sequential). Neither → instant move.
    const handOff = (t: SubTarget) => {
        const hasEntry = (t.entryArgs?.length ?? 0) > 0;
        if (hasEntry) {
            setCtxPending({ id: t.id, label: t.label, entryArgs: t.entryArgs ?? [], skipNote: !!t.skipNoteOnEntry, requireNote: !!t.requireNoteOnEntry, entryQuestion: t.entryQuestion ?? null });
        } else if (!t.skipNoteOnEntry) {
            setPending({ dir: "next", kind: "sub", id: t.id, label: t.label, entryQuestion: t.entryQuestion ?? null, requireNote: !!t.requireNoteOnEntry });
        } else {
            commitSub(t.id, t.label);
        }
    };
    // Worker-context popup confirm. If the log popup is also on → hand over to it
    // (entryValues persist into submit()); otherwise move now with the collected values.
    const ctxNext = async () => {
        if (!ctxPending) return;
        if (!ctxPending.skipNote) {
            setPending({ dir: "next", kind: "sub", id: ctxPending.id, label: ctxPending.label, entryQuestion: ctxPending.entryQuestion, requireNote: ctxPending.requireNote });
            setCtxPending(null);  // entryValues kept for submit()
        } else {
            const collected = Object.fromEntries(
                Object.entries(entryValues).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v),
            );
            await commitSub(ctxPending.id, ctxPending.label, collected);
        }
    };

    // Hand-off: stays in the stage, routes the work to another team (the Work badge).
    const subBtn = (t: SubTarget) => (
        <Button
            key={`sub-${t.id}`}
            onClick={() => handOff(t)}
            size="sm" variant="outline"
            className="w-full justify-start gap-2"
        >
            <Share2 size={13} className="shrink-0 text-muted-foreground" />
            <span className="truncate">{t.label}</span>
            {t.work && (
                <span className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${badgeColor(t.work.color).className}`} style={badgeColor(t.work.color).style}>{t.work.label}</span>
            )}
        </Button>
    );

    // Real stage change — advances the ticket to a new stage.
    const statusBtn = (t: StatusTarget) => (
        <Button
            key={`st-${t.id}`}
            onClick={() => moveStage(t)}
            disabled={busy || !!forwardBlockedReason}
            title={forwardBlockedReason ?? undefined}
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
            onClick={() => moveStage(t)}
            disabled={busy || !!forwardBlockedReason}
            title={forwardBlockedReason ?? undefined}
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
    // Required worker-context fields gate the context popup's confirm button.
    const ctxMissing = !!ctxPending && ctxPending.entryArgs.some((a) => a.required && !(entryValues[argKey(a)] ?? "").trim());

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
                    {forwardBlockedReason && (forwardStatuses.length > 0 || terminalStatuses.length > 0) && (
                        <p className="flex items-start gap-1.5 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-300">
                            <Flag size={13} className="mt-0.5 shrink-0" />
                            {forwardBlockedReason} — you can still go back.
                        </p>
                    )}
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
                            onClick={() => setPending({ dir: "back", statusId: backTarget.statusId, workerId: backTarget.workerId, label: backTarget.label })}
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
                            {leavePrompt && pending.dir === "next" && pending.kind === "status" && (
                                <div className="flex gap-2.5 rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5">
                                    <HelpCircle size={16} className="mt-0.5 shrink-0 text-primary" />
                                    <div className="space-y-0.5">
                                        <p className="text-sm font-semibold text-foreground">{leavePrompt}</p>
                                        <p className="text-[11px] leading-tight text-muted-foreground">
                                            Answer in the notes below before moving.
                                        </p>
                                    </div>
                                </div>
                            )}
                            {/* The target worker's entry question — guidance for what to write;
                                the answer goes in the private/public note below. */}
                            {pending.dir === "next" && pending.kind === "sub" && pending.entryQuestion && (
                                <div className="flex gap-2.5 rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5">
                                    <HelpCircle size={16} className="mt-0.5 shrink-0 text-primary" />
                                    <div className="space-y-0.5">
                                        <p className="text-sm font-semibold text-foreground">{pending.entryQuestion}</p>
                                        <p className="text-[11px] leading-tight text-muted-foreground">
                                            Answer in the note below.
                                        </p>
                                    </div>
                                </div>
                            )}
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
                        {pending.dir === "next" && pending.kind === "sub" && pending.requireNote && !privateNote.trim() && (
                            <p className="-mt-2 text-xs text-amber-700 dark:text-amber-400">A note is required for this worker before you can move.</p>
                        )}
                        <DialogFooter className="mt-2 border-t border-border pt-4">
                            <Button onClick={close} variant="outline" className="flex-1">Cancel</Button>
                            <Button
                                onClick={submit}
                                disabled={busy || (pending.dir === "next" && pending.kind === "sub" && !!pending.requireNote && !privateNote.trim())}
                                className="flex-1"
                            >
                                {busy ? "Saving…" : pending.dir === "back" ? "← Revert" : "Move →"}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}

            {/* SEPARATE worker-context popup — technician fills the work's context fields
                on hand-off. Independent of the log popup; leads into it when that's on. */}
            {ctxPending && (
                <Dialog open onOpenChange={(o) => { if (!o) close(); }}>
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle>Work context → {ctxPending.label}</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-3">
                            <p className="text-xs text-muted-foreground">Fill what the helper needs to do this work — shown on the Work Inbox card.</p>
                            <div className="space-y-2 rounded-md border border-border bg-muted/30 p-2.5">
                                {ctxPending.entryArgs.map((a) => (
                                    <div key={argKey(a)} className="space-y-1">
                                        <label className="text-xs font-medium text-foreground">{a.label}{a.required && <span className="text-red-500"> *</span>}</label>
                                        <Input
                                            value={entryValues[argKey(a)] ?? ""}
                                            onChange={(e) => setEntryValues((v) => ({ ...v, [argKey(a)]: e.target.value }))}
                                            placeholder={a.label}
                                            className="h-8"
                                        />
                                    </div>
                                ))}
                            </div>
                            {ctxMissing && (
                                <p className="text-xs text-amber-700 dark:text-amber-400">Fill the required field(s) marked * before continuing.</p>
                            )}
                        </div>
                        <DialogFooter className="mt-2 border-t border-border pt-4">
                            <Button onClick={close} variant="outline" className="flex-1">Cancel</Button>
                            <Button onClick={ctxNext} disabled={busy || ctxMissing} className="flex-1">
                                {busy ? "Saving…" : ctxPending.skipNote ? "Move →" : "Next →"}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}
        </div>
    );
}
