"use client";

// ── ActiveShiftBar ───────────────────────────────────────────────────────────
// Top strip on PosScreen.
//   OPEN              → normal green bar with drop + close buttons.
//   AWAITING_HANDOVER → amber bar; billing disabled; shows who B is + cancel.

import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { Clock, Monitor, Lock, ArrowRightLeft, RefreshCw, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmt } from "@/utils/constants";
import { CashDropDialog } from "@/modules/pos/components/CashDropDialog";
import { ShiftCloseDialog } from "@/modules/pos/components/ShiftCloseDialog";

export type ActiveShift = {
    id: number;
    status: "OPEN" | "AWAITING_HANDOVER";
    openedAt: string;
    counter: {
        id:   number;
        name: string;
        tillAccount: { id: number; name: string };
        // Per-method routing — null = method not accepted at this counter.
        // Set under /office/admin/counters. Labels override the built-in
        // method name ("UPI", "Card", etc.) on the POS checkout dialog.
        upiAccount:          { id: number; name: string } | null; upiLabel:          string | null;
        cardAccount:         { id: number; name: string } | null; cardLabel:         string | null;
        walletAccount:       { id: number; name: string } | null; walletLabel:       string | null;
        chequeAccount:       { id: number; name: string } | null; chequeLabel:       string | null;
        bankTransferAccount: { id: number; name: string } | null; bankTransferLabel: string | null;
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
    cashSalesPaise: string;
    dropsPaise: string;
    runningExpectedPaise: string;
};

export function ActiveShiftBar({
    shift, onClosed, onHandoverCancelled,
}: {
    shift: ActiveShift;
    onClosed: () => void;
    onHandoverCancelled?: () => void;
}) {
    const [summary, setSummary]   = useState<Summary | null>(null);
    const [dropOpen, setDropOpen] = useState(false);
    const [closeOpen, setCloseOpen] = useState(false);
    const [cancelling, setCancelling] = useState(false);

    const refresh = useCallback(() => {
        axios.get<Summary>(`/api/pos/shifts/${shift.id}`)
            .then((r) => setSummary({
                cashSalesPaise:       r.data.cashSalesPaise,
                dropsPaise:           r.data.dropsPaise,
                runningExpectedPaise: r.data.runningExpectedPaise,
            }))
            .catch(() => { /* silent */ });
    }, [shift.id]);

    useEffect(() => {
        refresh();
        const interval = setInterval(refresh, 30_000);
        return () => clearInterval(interval);
    }, [refresh]);

    const cancelHandover = async () => {
        if (!confirm("Cancel the pending handover? This returns the shift to OPEN.")) return;
        setCancelling(true);
        try {
            await axios.delete(`/api/pos/shifts/${shift.id}/handover`);
            onHandoverCancelled?.();
        } catch (e: unknown) {
            const msg = axios.isAxiosError(e) ? (e.response?.data as { error?: string })?.error : undefined;
            import("sonner").then(({ toast }) => toast.error(msg ?? "Failed to cancel handover"));
        } finally {
            setCancelling(false);
        }
    };

    const openedTime = new Date(shift.openedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const expected   = summary ? Number(summary.runningExpectedPaise) / 100 : Number(shift.openingFloatPaise) / 100;
    const cashSales  = summary ? Number(summary.cashSalesPaise) / 100        : 0;
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
                <span>Sales <span className="font-mono font-semibold">₹{fmt(cashSales)}</span></span>
                <span className="text-muted-foreground">·</span>
                <span>Drops <span className="font-mono font-semibold">₹{fmt(drops)}</span></span>
                <span className="text-muted-foreground">·</span>
                <span className="font-medium">In drawer ≈ <span className="font-mono">₹{fmt(expected)}</span></span>

                <div className="ml-auto flex items-center gap-1.5">
                    <Button size="sm" variant="ghost" onClick={refresh} className="h-7 px-2 text-xs">
                        <RefreshCw size={11} />
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDropOpen(true)}>
                        <Lock size={12} /> Drop to safe
                    </Button>
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
