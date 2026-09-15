"use client";

// ── ActiveShiftBar ───────────────────────────────────────────────────────────
// Top strip on PosScreen.
//   OPEN              → normal green bar with drop + close buttons.
//   AWAITING_HANDOVER → amber bar; billing disabled; shows who B is + cancel.

import { useState, useCallback, type ReactNode } from "react";
import axios from "axios";
import { Clock, Monitor, Lock, ArrowRightLeft, RefreshCw, Users, X, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmt } from "@/utils/constants";
import { CashDropDialog } from "@/modules/pos/components/CashDropDialog";
import { ShiftCloseDialog } from "@/modules/pos/components/ShiftCloseDialog";
import { extractApiError } from "@/shared/lib/api";
import { usePosAccess } from "@/modules/pos/hooks/usePosAccess";
import { usePolling } from "@/shared/hooks/usePolling";
import { POS_LIVE_POLL_MS } from "@/shared/lib/constants/polling";
import CounterStatusBadge from "@/shared/components/CounterStatusBadge";
import SyncStatusBadge from "@/shared/components/SyncStatusBadge";
import { confirmAction } from "@/shared/lib/ui/confirmStore";

export type ActiveShift = {
    id: number;
    status: "OPEN" | "AWAITING_HANDOVER";
    openedAt: string;
    counter: {
        id:   number;
        name: string;
        // EPBX/intercom extension(s) of the phone(s) at this counter, comma-separated
        // when there are several — drives the call
        // follow-up popup (CallFollowUpPopup) matching calls to this shift.
        epbxExtension: string | null;
        tillAccount: { id: number; name: string };
        // The counter's payment accounts (UPI/Card/gateway…), set under
        // /office/admin/counters. Each drives a checkout payment row: `accountId`
        // is the ledger debited, `vpa` (UPI/gateway) feeds the Share QR.
        paymentAccounts: {
            id: number;
            channel: "UPI" | "CARD" | "CHEQUE" | "WALLET" | "BANK_TRANSFER" | "GATEWAY";
            label: string;
            accountId: number;
            account: { id: number; name: string } | null;
            vpa: string | null;
            defaultVisible: boolean;
        }[];
    };
    branch: { id: string; name: string };
    openingFloatPaise: string;
    // Populated when status = AWAITING_HANDOVER
    handover?: {
        id: number;
        declaredByAPaise: string;
        carryOverPaise:   string;
        toUser: { id: number; name: string };
    } | null;
};

type Summary = {
    tillMovementPaise: string;
    dropsPaise: string;
    runningExpectedPaise: string;
};

export function ActiveShiftBar({
    shift, onClosed, onHandoverCancelled, rightSlot,
}: {
    shift: ActiveShift;
    onClosed: () => void;
    onHandoverCancelled?: () => void;
    // Optional extra control rendered in the bar's right cluster (before the
    // shift action buttons). Used on /vouchers/pos to host the "New Sale" CTA
    // in the bar's empty space. Not shown in the awaiting-handover state.
    rightSlot?: ReactNode;
}) {
    const { canDrop } = usePosAccess();
    const [summary, setSummary]   = useState<Summary | null>(null);
    const [dropOpen, setDropOpen] = useState(false);
    const [closeOpen, setCloseOpen] = useState(false);
    const [cancelling, setCancelling] = useState(false);

    const refresh = useCallback(() => {
        axios.get<Summary>(`/api/pos/shifts/${shift.id}`)
            .then((r) => setSummary({
                tillMovementPaise:    r.data.tillMovementPaise,
                dropsPaise:           r.data.dropsPaise,
                runningExpectedPaise: r.data.runningExpectedPaise,
            }))
            .catch(() => { /* silent */ });
    }, [shift.id]);

    // Fastest interval in the app — this is live till money someone may be looking
    // at. It just stops while the tab is hidden, and refreshes on return.
    usePolling(refresh, POS_LIVE_POLL_MS);

    const cancelHandover = async () => {
        if (!(await confirmAction({ title: "Cancel the pending handover?", body: "This returns the shift to OPEN.", confirmLabel: "Cancel handover" }))) return;
        setCancelling(true);
        try {
            await axios.delete(`/api/pos/shifts/${shift.id}/handover`);
            onHandoverCancelled?.();
        } catch (e: unknown) {
            import("sonner").then(({ toast }) => toast.error(extractApiError(e, "Failed to cancel handover")));
        } finally {
            setCancelling(false);
        }
    };

    const openedTime = new Date(shift.openedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const expected   = summary ? Number(summary.runningExpectedPaise) / 100 : Number(shift.openingFloatPaise) / 100;
    const movement   = summary ? Number(summary.tillMovementPaise) / 100     : 0;
    const drops      = summary ? Number(summary.dropsPaise) / 100            : 0;

    // ── AWAITING_HANDOVER state ───────────────────────────────────────────
    if (shift.status === "AWAITING_HANDOVER") {
        return (
            <div className="flex items-center gap-3 flex-wrap border-b border-amber-300/40 bg-amber-50 dark:bg-amber-950/30 px-4 py-2 text-xs">
                <span className="inline-flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-300">
                    <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                    Shift #{shift.id} — Awaiting handover
                </span>
                <span className="text-muted-foreground">·</span>
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <Monitor size={12} /> {shift.counter.name}
                </span>
                {shift.handover && (
                    <>
                        <span className="text-muted-foreground">·</span>
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <Users size={12} /> Waiting for <span className="font-medium text-foreground ml-0.5">{shift.handover.toUser.name}</span>
                        </span>
                    </>
                )}
                <div className="ml-auto flex items-center gap-2 text-amber-700 dark:text-amber-300">
                    <span className="text-xs">Billing disabled. Log out &amp; hand terminal over.</span>
                    <Button size="sm" variant="outline" className="h-7 text-xs border-amber-300/60" onClick={cancelHandover} disabled={cancelling}>
                        {cancelling ? <RefreshCw size={11} className="animate-spin" /> : <X size={11} />} Cancel handover
                    </Button>
                </div>
            </div>
        );
    }

    // ── OPEN state ───────────────────────────────────────────────────────
    return (
        <>
            <div className="flex items-center gap-3 flex-wrap border-b border-border bg-emerald-50 dark:bg-emerald-950/30 px-4 py-2 text-xs">
                <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-300">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    Shift #{shift.id} OPEN
                </span>
                <span className="text-muted-foreground">·</span>
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <Monitor size={12} /> {shift.counter.name}
                </span>
                <span className="text-muted-foreground">·</span>
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <Clock size={12} /> {openedTime}
                </span>
                <span className="text-muted-foreground">·</span>
                <span title="Net movement on the till ledger since open">Till <span className="font-mono font-semibold">{movement < 0 ? "−" : "+"}₹{fmt(Math.abs(movement))}</span></span>
                <span className="text-muted-foreground">·</span>
                <span>Drops <span className="font-mono font-semibold">₹{fmt(drops)}</span></span>
                <span className="text-muted-foreground">·</span>
                <span className="font-medium">In drawer ≈ <span className="font-mono">₹{fmt(expected)}</span></span>

                <div className="ml-auto flex items-center gap-1.5">
                    {/* Renders nothing unless this machine is a counter with something
                        worth reporting — see CounterStatusBadge / SyncStatusBadge. */}
                    <CounterStatusBadge />
                    <SyncStatusBadge />
                    {rightSlot}
                    <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                        <a href="/office" target="_blank" rel="noopener noreferrer" title="Open the office in a new tab">
                            <ExternalLink size={12} /> Office
                        </a>
                    </Button>
                    <Button size="sm" variant="ghost" onClick={refresh} className="h-7 px-2 text-xs">
                        <RefreshCw size={11} />
                    </Button>
                    {canDrop && (
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDropOpen(true)}>
                            <Lock size={12} /> Drop to safe
                        </Button>
                    )}
                    <Button size="sm" className="h-7 text-xs bg-amber-600 hover:bg-amber-700 text-white" onClick={() => setCloseOpen(true)}>
                        <ArrowRightLeft size={12} /> Close shift
                    </Button>
                </div>
            </div>

            <CashDropDialog
                open={dropOpen}
                onOpenChange={setDropOpen}
                shiftId={shift.id}
                onDropped={refresh}
            />
            <ShiftCloseDialog
                open={closeOpen}
                onOpenChange={setCloseOpen}
                shiftId={shift.id}
                onClosed={onClosed}
            />
        </>
    );
}
