"use client";

// ── ActiveShiftBar ───────────────────────────────────────────────────────────
// Top strip on PosScreen when the current user has an OPEN shift. Surfaces
// shift summary at a glance + buttons to drop cash mid-shift or close out.
// Polls the shift detail every 30 s so the "in drawer" hint stays fresh as
// sales come in (alternative: subscribe to a server-sent stream, deferred).

import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { Clock, Wallet, Lock, ArrowRightLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmt } from "@/utils/constants";
import { CashDropDialog } from "@/modules/pos/components/CashDropDialog";
import { ShiftCloseDialog } from "@/modules/pos/components/ShiftCloseDialog";

export type ActiveShift = {
    id: number;
    openedAt: string;
    tillAccount: { id: number; name: string };
    branch:      { id: string; name: string };
    openingFloatPaise: string;
};

type Summary = {
    cashSalesPaise: string;
    dropsPaise: string;
    runningExpectedPaise: string;
};

export function ActiveShiftBar({
    shift, onClosed,
}: {
    shift: ActiveShift;
    onClosed: () => void;
}) {
    const [summary, setSummary] = useState<Summary | null>(null);
    const [dropOpen, setDropOpen] = useState(false);
    const [closeOpen, setCloseOpen] = useState(false);

    const refresh = useCallback(() => {
        axios.get<Summary>(`/api/pos/shifts/${shift.id}`)
            .then((r) => setSummary({
                cashSalesPaise:        r.data.cashSalesPaise,
                dropsPaise:            r.data.dropsPaise,
                runningExpectedPaise:  r.data.runningExpectedPaise,
            }))
            .catch(() => { /* silent — bar is informational */ });
    }, [shift.id]);

    useEffect(() => {
        refresh();
        const interval = setInterval(refresh, 30_000);
        return () => clearInterval(interval);
    }, [refresh]);

    const openedTime = new Date(shift.openedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const expected   = summary ? Number(summary.runningExpectedPaise) / 100 : Number(shift.openingFloatPaise) / 100;
    const cashSales  = summary ? Number(summary.cashSalesPaise) / 100        : 0;
    const drops      = summary ? Number(summary.dropsPaise) / 100            : 0;

    return (
        <>
            <div className="flex items-center gap-3 flex-wrap border-b border-border bg-emerald-50 dark:bg-emerald-950/30 px-4 py-2 text-xs">
                <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-300">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    Shift #{shift.id} OPEN
                </span>
                <span className="text-muted-foreground">·</span>
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <Wallet size={12} /> {shift.tillAccount.name}
                </span>
                <span className="text-muted-foreground">·</span>
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <Clock size={12} /> Opened {openedTime}
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
