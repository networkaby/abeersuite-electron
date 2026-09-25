"use client";

// ── ShiftTakeoverDialog ──────────────────────────────────────────────────────
// Shown to the next cashier (B) when somebody else's drawer is on the counter:
// straight after sign-in on a counter PC, or after picking a busy counter in the
// open-shift dialog. Information only — nothing to type. B checks the drawer
// against what is shown and either accepts it or leaves.
//
//   • A handed over properly → A's count and denominations are shown; B starts
//     with A's count, and any gap against the books is A's.
//   • A just signed out      → nobody counted; B sees the books' figure and, on
//     accepting, starts with it. From then on the drawer is B's.
//
// Accept → POST /api/pos/shifts/[id]/takeover (closes A's shift, opens B's).
// Reject → sign out (counter PC) or back to the picker (opened from the picker).

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, CheckCheck, HandshakeIcon, Banknote, AlertTriangle, TrendingDown, TrendingUp, LogOut } from "lucide-react";
import {
    Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { fmt } from "@/shared/lib/format/moneyInr";
import { extractApiError } from "@/shared/lib/api";
import { resolveMachineIdentity } from "@/shared/lib/counter/identity";
import { applyCounterIdRanges } from "@/modules/pos/lib/counterIdRanges";
import type { HandoverDenominations } from "@/modules/pos/lib/handoverDenominations";
import {
    CashDrawerPositionCard, CashFlowCard, PaymentsCollectedCard, CollectionsCard,
    type ShiftSummary,
} from "@/modules/pos/components/ShiftSummaryCards";

/** What GET /api/pos/shifts/counter-takeover answers. */
export type CounterTakeover = {
    shift: {
        id:       number;
        status:   "OPEN" | "AWAITING_HANDOVER";
        openedAt: string;
        user:     { id: number; name: string };
        counter:  { id: number; name: string; tillAccount: { name: string } };
        branch:   { id: string; name: string };
    };
    handover: {
        declaredByAPaise: string | null;
        denominations:    HandoverDenominations | null;
        notes:            string | null;
        initiatedAt:      string;
    } | null;
    summary: ShiftSummary;
};

type TakeoverResult = { id: number; idRangeStart: number | null; openingFloatPaise: string };

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const rupees = (paise: string | number) => Number(paise) / 100;

export function ShiftTakeoverDialog({
    takeover, rejectLabel, onAccepted, onReject,
}: {
    takeover: CounterTakeover;
    // "Reject & sign out" on a counter PC; "Back" when opened from the picker.
    rejectLabel: string;
    onAccepted: () => void;
    onReject: () => void;
}) {
    const [submitting, setSubmitting] = useState(false);
    const { shift, handover, summary } = takeover;
    const from     = shift.user.name;
    const expected = rupees(summary.runningExpectedPaise);
    const counted  = handover?.declaredByAPaise != null ? rupees(handover.declaredByAPaise) : null;
    const startWith = counted ?? expected;

    const accept = async () => {
        setSubmitting(true);
        try {
            const { machineId } = await resolveMachineIdentity();
            const { data } = await axios.post<TakeoverResult>(`/api/pos/shifts/${shift.id}/takeover`, {
                deviceId: machineId ?? undefined,
            });
            await applyCounterIdRanges(data.idRangeStart);
            toast.success(`${shift.counter.name} is yours — shift #${data.id} opened with ₹${fmt(rupees(data.openingFloatPaise))}`);
            onAccepted();
        } catch (e: unknown) {
            toast.error(extractApiError(e, "Could not take the counter over"));
            setSubmitting(false);
        }
    };

    return (
        <Dialog open onOpenChange={() => { /* controlled — only Accept / Reject close it */ }}>
            <DialogContent
                className="flex flex-col w-[96vw] max-w-[96vw] sm:max-w-[1320px] max-h-[94vh]"
                onInteractOutside={(e) => e.preventDefault()}
                onEscapeKeyDown={(e) => e.preventDefault()}
                showCloseButton={false}
            >
                <DialogHeader className="pb-1 [zoom:1.2]">
                    <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 flex items-center justify-center shrink-0 shadow-sm border border-amber-300/40">
                            <HandshakeIcon size={18} />
                        </div>
                        <div>
                            <DialogTitle className="text-lg font-semibold tracking-tight">
                                Take over {shift.counter.name} from {from}
                            </DialogTitle>
                            <DialogDescription className="text-xs mt-0.5">
                                {handover
                                    ? `${from} counted the drawer and handed it over at ${clock(handover.initiatedAt)}.`
                                    : `${from} has had this counter since ${clock(shift.openedAt)} and signed out without counting.`}
                                {" "}Check the drawer against this before you accept.
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto py-1 pr-1 [zoom:1.2]">
                    <div className="grid gap-3 grid-cols-1 lg:grid-cols-3">
                        {/* ── Column 1: what A counted ── */}
                        <div className="space-y-2">
                            {handover?.denominations ? (
                                <CountedByA name={from} d={handover.denominations} total={counted ?? 0} />
                            ) : (
                                <div className="rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-900 dark:text-amber-200 space-y-1">
                                    <p className="font-medium flex items-center gap-1.5">
                                        <AlertTriangle size={13} className="shrink-0" />
                                        {handover ? `${from} did not count note by note` : `${from} did not count the drawer`}
                                    </p>
                                    <p className="text-amber-800/90 dark:text-amber-300/90">
                                        Count it yourself now. You start with ₹{fmt(startWith)}; whatever
                                        you find after accepting is yours.
                                    </p>
                                </div>
                            )}
                            {handover?.notes && (
                                <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                                    <span className="font-medium text-foreground">Note from {from}:</span> {handover.notes}
                                </div>
                            )}
                        </div>

                        {/* ── Column 2: the drawer by the books ── */}
                        <div className="space-y-2">
                            <div className="rounded-md border border-border bg-background p-3 space-y-1.5 shadow-sm">
                                <div className="flex justify-between items-baseline text-sm">
                                    <span className="text-muted-foreground">Expected cash (books)</span>
                                    <span className="font-mono font-bold">₹{fmt(expected)}</span>
                                </div>
                                {counted != null && (
                                    <div className="flex justify-between items-baseline text-sm">
                                        <span className="text-muted-foreground">Counted by {from}</span>
                                        <span className="font-mono font-bold">₹{fmt(counted)}</span>
                                    </div>
                                )}
                                {counted != null && <GapChip gap={+(counted - expected).toFixed(2)} name={from} />}
                                <div className="flex justify-between items-baseline border-t border-border pt-1.5 text-sm font-semibold">
                                    <span>You start with</span>
                                    <span className="font-mono">₹{fmt(startWith)}</span>
                                </div>
                            </div>
                            <CashDrawerPositionCard s={summary} />
                        </div>

                        {/* ── Column 3: how it moved and what came in ── */}
                        <div className="space-y-2">
                            <CashFlowCard s={summary} />
                            <PaymentsCollectedCard s={summary} />
                            <CollectionsCard s={summary} />
                        </div>
                    </div>
                </div>

                <DialogFooter className="pt-2 border-t border-border flex items-center gap-2 flex-wrap sm:justify-between [zoom:1.2]">
                    <p className="text-xs text-amber-800 dark:text-amber-300 font-medium">
                        Accepting makes this drawer your responsibility.
                    </p>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" onClick={onReject} disabled={submitting}>
                            <LogOut size={14} /> {rejectLabel}
                        </Button>
                        <Button onClick={accept} disabled={submitting} className="bg-green-600 hover:bg-green-700 text-white">
                            {submitting ? <Loader2 size={14} className="animate-spin" /> : <CheckCheck size={14} />}
                            Accept &amp; start shift
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/** A's note/coin tally, read-only. */
function CountedByA({ name, d, total }: { name: string; d: HandoverDenominations; total: number }) {
    return (
        <div className="rounded-md border border-emerald-300/60 bg-emerald-50/20 dark:border-emerald-500/30 dark:bg-emerald-950/20 p-2.5 shadow-sm">
            <p className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 uppercase tracking-wide flex items-center gap-1.5 mb-1.5">
                <Banknote size={14} className="text-emerald-600 dark:text-emerald-400" /> Counted by {name}
            </p>
            <div className="grid grid-cols-[1fr_4rem_6rem] gap-x-2 text-[11px] font-medium text-emerald-800/80 dark:text-emerald-300/80 bg-emerald-100/40 dark:bg-emerald-950/40 rounded px-1.5 py-0.5 mb-1">
                <span>Denomination</span>
                <span className="text-right">Count</span>
                <span className="text-right">Amount</span>
            </div>
            <div className="space-y-0.5 text-xs font-mono">
                {d.lines.map((l) => (
                    <div key={l.denom} className="grid grid-cols-[1fr_4rem_6rem] gap-x-2 px-1.5">
                        <span>₹{l.denom.toLocaleString("en-IN")}</span>
                        <span className="text-right">{l.count}</span>
                        <span className="text-right">₹{fmt(l.denom * l.count)}</span>
                    </div>
                ))}
                {d.otherPaise > 0 && (
                    <div className="grid grid-cols-[1fr_4rem_6rem] gap-x-2 px-1.5">
                        <span>Other</span>
                        <span />
                        <span className="text-right">₹{fmt(rupees(d.otherPaise))}</span>
                    </div>
                )}
                {d.lines.length === 0 && d.otherPaise === 0 && (
                    <p className="px-1.5 text-muted-foreground font-sans">Nothing counted — the drawer was empty.</p>
                )}
            </div>
            <div className="border-t border-emerald-200/60 dark:border-emerald-800/40 mt-1.5 pt-1.5 flex justify-between items-center bg-emerald-100/50 dark:bg-emerald-950/50 -mx-1 px-2.5 py-1 rounded font-semibold text-xs">
                <span className="text-emerald-900 dark:text-emerald-200">Counted total</span>
                <span className="font-mono text-sm font-bold text-emerald-700 dark:text-emerald-300">₹{fmt(total)}</span>
            </div>
        </div>
    );
}

/** A's count against the books — the gap posts to A's shift on accept. */
function GapChip({ gap, name }: { gap: number; name: string }) {
    if (Math.abs(gap) < 0.01) return <p className="text-xs text-green-700 dark:text-green-400">✓ {name}&apos;s count matches the books</p>;
    return gap < 0 ? (
        <p className="text-xs text-red-700 dark:text-red-400 flex items-center gap-1">
            <TrendingDown size={12} /> Short ₹{fmt(Math.abs(gap))} — posts to {name}&apos;s shift as Cash Short
        </p>
    ) : (
        <p className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
            <TrendingUp size={12} /> Over ₹{fmt(gap)} — posts to {name}&apos;s shift as Cash Over
        </p>
    );
}
