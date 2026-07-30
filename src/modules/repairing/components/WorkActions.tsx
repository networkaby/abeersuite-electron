"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Play, Check, X, CheckCircle, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { type WorkArg, isUserArg, argKey, argMatchesOutcome } from "@/modules/repairing/lib/ticketSources";
import { navigateInApp } from "@/modules/repairing/lib/clientNav";

interface RouteTarget { id: string; label: string }
// isStatus → the target is a STAGE jump (statusId), not a same-stage worker.
interface Pending { target: RouteTarget | null; kind: string; done: string; isStatus?: boolean }

interface Props {
    ticketId: number;
    /** The work being done (for the dialog title). */
    workLabel: string;
    /** Custom outcome-button labels from the Work (e.g. "Reachable" / "Unreachable").
     *  null → the buttons stay icon-only (generic). */
    successLabel?: string | null;
    failLabel?: string | null;
    /** Optional third-button caption. When set the work is 2-step: this button shows
     *  first (claims/locks the card), then the outcomes reveal. */
    startLabel?: string | null;
    /** Guidance shown at the top of the completion popup (what to enter / do). */
    prompt?: string | null;
    /** Per-outcome popup gate — true (or an outcome-scoped arg) opens the dialog;
     *  otherwise that outcome completes silently. */
    successPopup?: boolean;
    failPopup?: boolean;
    /** The work's arguments — user-given ones are collected in the completion dialog. */
    args?: WorkArg[];
    /** Where this worker routes on a successful outcome (null = none configured). */
    successTarget?: RouteTarget | null;
    /** Where it routes on an unsuccessful outcome. */
    failTarget?: RouteTarget | null;
    /** Success / unsuccess can instead JUMP to a stage. When set (and no worker
     *  target for that outcome), completing advances the ticket to this STATUS
     *  (applying its entry worker) rather than routing to a same-stage worker. */
    successStatusTarget?: RouteTarget | null;
    failStatusTarget?: RouteTarget | null;
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
 * board and the ticket page. The Work's *shape* drives the UI:
 *  - `startLabel` → 2-step: a Start button claims/locks first, then outcomes reveal.
 *  - `failLabel` blank → single neutral button (e.g. "Ok"); set → Success / ❌.
 *  - `successPopup`/`failPopup` (or an outcome-scoped user arg) → that outcome opens a
 *    popup to collect a note / args (with `prompt` at the top); else it completes silently.
 */
export default function WorkActions({
    ticketId, workLabel, successLabel, failLabel, startLabel, prompt, successPopup = false, failPopup = false,
    args = [], successTarget, failTarget, successStatusTarget, failStatusTarget, retryScheduled = false,
    isOwned, isOwnerMe, onChanged, size = "sm", showComplete = true,
}: Props) {
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const [pending, setPending] = useState<Pending | null>(null);
    const [argValues, setArgValues] = useState<Record<string, string>>({});

    const userArgs = args.filter(isUserArg);  // collected from the helper at completion
    // Only collect the inputs that apply to the outcome being pressed (on: success/fail/always).
    const pendingArgs = pending ? userArgs.filter((a) => argMatchesOutcome(a, pending.kind)) : [];
    // Required outcome fields gate the confirm button until filled.
    const missingRequired = pendingArgs.some((a) => a.required && !(argValues[argKey(a)] ?? "").trim());
    const refresh = () => {
        // Work moved → let the sidebar Work Flow badge recount now, not on its next poll.
        window.dispatchEvent(new CustomEvent("work-inbox:changed"));
        if (onChanged) onChanged(); else router.refresh();
    };
    const close = () => { setPending(null); setArgValues({}); };

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

    // One completion code path — shared by the silent click and the dialog confirm.
    // target=null → clear the worker (no-routing "done"). outcome tags it for the
    // Work Inbox "Finished" list; collected outcome args ride along when present.
    // Notes are NOT collected here — they belong to the technician's log popup (StatusNav).
    const post = async ({ target, kind, done, collected, isStatus }: {
        target: RouteTarget | null; kind: string; done: string;
        collected?: Record<string, string>; isStatus?: boolean;
    }) => {
        setBusy(true);
        try {
            const outcome = kind === "Success" ? "success" : kind === "Unsuccess" ? "unsuccess" : undefined;
            let openTabs: string[] = [];
            let navigateTo: string | null = null;
            if (target) {
                const res = await axios.patch(`/api/tickets/${ticketId}/worker`, {
                    // A stage jump sends statusId; a same-stage hand-off sends workerId.
                    ...(isStatus ? { statusId: target.id } : { workerId: target.id }),
                    visibility: "INTERNAL",
                    outcome,
                    args: collected && Object.keys(collected).length ? collected : undefined,
                });
                openTabs = (res.data?.openTabs ?? []) as string[];
                navigateTo = (res.data?.navigateTo ?? null) as string | null;
            } else {
                await axios.delete(`/api/tickets/${ticketId}/worker`);
            }
            toast.success(done);
            close();
            // Auto-Works (Actions) run server-side; pop any tabs they deemed openable here
            // (still inside the user's click, so the browser allows it).
            openTabs.forEach((u) => window.open(u, "_blank", "noopener,noreferrer"));
            // A navigate Action takes the user to an in-app page (router.push) or external URL.
            if (navigateTo) { navigateInApp(router, navigateTo); return; }
            refresh();
        } catch (err: unknown) {
            toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Failed to complete");
        } finally { setBusy(false); }
    };

    // The dialog's confirm — gathers the collected outcome args from state.
    const submit = () => {
        if (!pending) return;
        const collected = Object.fromEntries(
            pendingArgs.map((a) => [argKey(a), (argValues[argKey(a)] ?? "").trim()]).filter(([, v]) => v),
        );
        return post({ target: pending.target, kind: pending.kind, done: pending.done, collected, isStatus: pending.isStatus });
    };

    // Does this outcome open the popup? Yes when the work checked "popup" for it, OR it
    // has a question scoped to this outcome (never silently drop an input).
    const popupFor = (kind: string) => {
        const flag = kind === "Unsuccess" ? failPopup : successPopup;  // Success & Done use successPopup
        return flag || userArgs.some((a) => argMatchesOutcome(a, kind));
    };
    const onOutcome = (target: RouteTarget | null, kind: string, done: string, isStatus?: boolean) => {
        if (popupFor(kind)) setPending({ target, kind, done, isStatus });
        else post({ target, kind, done, isStatus });
    };

    // The effective route for each outcome: a same-stage worker takes precedence, else
    // a stage jump (status). One of the two is what the worker editor saved.
    const successRoute = successTarget ? { target: successTarget, isStatus: false } : successStatusTarget ? { target: successStatusTarget, isStatus: true } : null;
    const failRoute = failTarget ? { target: failTarget, isStatus: false } : failStatusTarget ? { target: failStatusTarget, isStatus: true } : null;
    const hasRouting = !!(successRoute || failRoute);
    const twoStep = !!(startLabel && startLabel.trim());
    const requireUnsuccess = !!(failLabel && failLabel.trim());
    // Two-step works reveal outcomes only after claiming; one-step works show them directly.
    const canComplete = showComplete && (twoStep ? isOwnerMe : true);

    return (
        <>
            {twoStep && !isOwned && (
                <Button onClick={start} disabled={busy} size={size}>
                    <Play size={13} /> {startLabel}
                </Button>
            )}
            {canComplete && (hasRouting ? (
                <>
                    {successRoute && (
                        <Button
                            onClick={() => onOutcome(successRoute.target, "Success", `${successLabel || "Success"} → ${successRoute.target.label}`, successRoute.isStatus)}
                            disabled={busy} size={size} variant="outline" title={`${successLabel || "Success"} → ${successRoute.target.label}`}
                            className="border-green-300 bg-green-50 text-green-700 hover:bg-green-100 dark:border-green-800 dark:bg-green-950 dark:text-green-300"
                        >
                            <Check size={20} className="text-green-500" />
                            {successLabel && <span>{successLabel}</span>}
                        </Button>
                    )}
                    {requireUnsuccess && failRoute && (
                        <Button
                            onClick={() => onOutcome(failRoute.target, "Unsuccess", retryScheduled && !failRoute.isStatus ? "Next attempt scheduled" : `${failLabel || "Unsuccess"} → ${failRoute.target.label}`, failRoute.isStatus)}
                            disabled={busy} size={size} variant="outline" title={retryScheduled && !failRoute.isStatus ? "Couldn't — schedule next attempt" : `${failLabel || "Unsuccess"} → ${failRoute.target.label}`}
                            className="border-red-300 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
                        >
                            <X size={50} className="text-red-500" />
                            {failLabel && <span>{failLabel}</span>}
                        </Button>
                    )}
                </>
            ) : (
                <Button onClick={() => onOutcome(null, "Done", successLabel || "Marked done")} disabled={busy} size={size} variant="outline">
                    <CheckCircle size={13} /> {successLabel || "Complete"}
                </Button>
            ))}

            {pending && (
                <Dialog open onOpenChange={(o) => { if (!o) close(); }}>
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle>{pending.target ? `${pending.kind} — ${workLabel}` : `Complete — ${workLabel}`}</DialogTitle>
                        </DialogHeader>

                        <div className="space-y-4">
                            {prompt && (
                                <div className="flex gap-2.5 rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5">
                                    <HelpCircle size={16} className="mt-0.5 shrink-0 text-primary" />
                                    <p className="text-sm font-semibold text-foreground">{prompt}</p>
                                </div>
                            )}
                            {pending.target && (
                                retryScheduled && !pending.isStatus && pending.kind === "Unsuccess" ? (
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
                                            <label className="text-xs font-medium text-foreground">{a.label}{a.required && <span className="text-red-500"> *</span>}</label>
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
                            {pendingArgs.length === 0 && (
                                <p className="text-xs text-muted-foreground">Confirm to record the outcome. Notes are added when moving the ticket.</p>
                            )}
                        </div>

                        {missingRequired && (
                            <p className="-mt-2 text-xs text-amber-700 dark:text-amber-400">Fill the required field(s) marked * before finishing.</p>
                        )}
                        <DialogFooter className="mt-2 border-t border-border pt-4">
                            <Button onClick={close} variant="outline" className="flex-1">Cancel</Button>
                            <Button onClick={submit} disabled={busy || missingRequired} className="flex-1">
                                {busy ? "Saving…" : retryScheduled && !pending.isStatus && pending.kind === "Unsuccess" ? "Schedule retry" : pending.target ? `Move → ${pending.target.label}` : "Mark done"}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}
        </>
    );
}
