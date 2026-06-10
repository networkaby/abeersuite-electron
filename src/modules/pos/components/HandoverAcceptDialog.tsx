"use client";

// ── HandoverAcceptDialog ─────────────────────────────────────────────────────
// Shown to B when PosScreen detects a PENDING handover addressed to them.
// B physically counts the cash, enters the amount, sees any discrepancy vs
// what A declared, then accepts. On accept the server:
//   • Posts a variance JE if B's count ≠ books expectation (A's responsibility)
//   • Posts a Contra sweeping surplus to vault (keeping carry-over in counter)
//   • Closes A's shift + opens B's shift in one transaction.
// B starts billing immediately after.

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
    Loader2, CheckCheck, TrendingDown, TrendingUp, HandshakeIcon,
} from "lucide-react";
import {
    Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmt } from "@/utils/constants";
import { formatDate } from "@/shared/lib/format/formatDate";
import { extractApiError } from "@/shared/lib/api";

export type PendingHandover = {
    id: number;
    declaredByAPaise: string;
    carryOverPaise:   string;
    notes:            string | null;
    initiatedAt:      string;
    fromShift: {
        id:   number;
        user: { name: string };
        counter: {
            name: string;
            tillAccount: { name: string; balance: string };
        };
        branch: { name: string };
    };
};

type AcceptResult = {
    handoverAccepted:  boolean;
    openedShiftId:     number;
    openingFloatPaise: string;
};

export function HandoverAcceptDialog({
    open, handover, onAccepted, onDismiss,
}: {
    open: boolean;
    handover: PendingHandover;
    onAccepted: (shiftId: number, openingFloat: number) => void;
    onDismiss?: () => void;    // allow logging out without accepting
}) {
    const [counted, setCounted]       = useState("");
    const [submitting, setSubmitting] = useState(false);

    const declaredByA  = Number(handover.declaredByAPaise) / 100;
    const carryOver    = Number(handover.carryOverPaise) / 100;
    const countedNum   = parseFloat(counted) || 0;
    const discrepancy  = +(countedNum - declaredByA).toFixed(2);

    const accept = async () => {
        if (countedNum < 0) { toast.error("Count cannot be negative"); return; }
        setSubmitting(true);
        try {
            const { data } = await axios.post<AcceptResult>(
                `/api/pos/handovers/${handover.id}/accept`,
                { countedByBPaise: Math.round(countedNum * 100) },
            );
            toast.success(`Handover accepted — Shift #${data.openedShiftId} opened with ₹${fmt(Number(data.openingFloatPaise) / 100)}`);
            onAccepted(data.openedShiftId, Number(data.openingFloatPaise) / 100);
        } catch (e: unknown) {
            toast.error(extractApiError(e, "Failed to accept handover"));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={() => { /* controlled — don't dismiss on outside click */ }}>
            <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <HandshakeIcon size={18} className="text-primary" /> Cash handover from {handover.fromShift.user.name}
                    </DialogTitle>
                    <DialogDescription>
                        {handover.fromShift.user.name} handed over {handover.fromShift.counter.name} at {handover.fromShift.branch.name} on{" "}
                        {formatDate(handover.initiatedAt)}.
                        Count the physical cash and confirm to start your shift.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    {/* Summary */}
                    <div className="rounded-md border border-border bg-muted/40 p-3 text-sm space-y-1.5">
                        <div className="flex justify-between text-muted-foreground">
                            <span>{handover.fromShift.user.name} declared</span>
                            <span className="font-mono font-semibold text-foreground">₹{fmt(declaredByA)}</span>
                        </div>
                        <div className="flex justify-between text-muted-foreground">
                            <span>Counter account</span>
                            <span className="text-foreground">{handover.fromShift.counter.tillAccount.name}</span>
                        </div>
                        <div className="flex justify-between text-muted-foreground">
                            <span>Carry-over for your shift</span>
                            <span className="font-mono text-foreground">₹{fmt(carryOver)}</span>
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="b-count">Your physical count (₹)</Label>
                        <Input
                            id="b-count"
                            type="text"
                            inputMode="decimal"
                            value={counted}
                            onChange={(e) => setCounted(e.target.value.replace(/[^\d.]/g, ""))}
                            placeholder={declaredByA.toFixed(2)}
                            autoFocus
                        />
                        {counted && <DiscrepancyChip discrepancy={discrepancy} declaredByA={declaredByA} />}
                    </div>

                    {handover.notes && (
                        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                            <span className="font-medium">Note from {handover.fromShift.user.name}:</span> {handover.notes}
                        </div>
                    )}
                </div>

                <DialogFooter className="flex-col sm:flex-row gap-2">
                    {onDismiss && (
                        <Button variant="ghost" size="sm" onClick={onDismiss} disabled={submitting} className="text-muted-foreground text-xs">
                            Log out instead
                        </Button>
                    )}
                    <Button
                        onClick={accept}
                        disabled={submitting || !counted}
                        className="bg-green-600 hover:bg-green-700 text-white"
                    >
                        {submitting ? <Loader2 size={14} className="animate-spin" /> : <CheckCheck size={14} />}
                        Accept &amp; start shift
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function DiscrepancyChip({ discrepancy, declaredByA }: { discrepancy: number; declaredByA: number }) {
    if (Math.abs(discrepancy) < 0.01) {
        return <p className="text-xs text-green-700 dark:text-green-400">✓ Matches — no discrepancy</p>;
    }
    if (discrepancy < 0) {
        return (
            <p className="text-xs text-red-700 dark:text-red-400 flex items-center gap-1">
                <TrendingDown size={12} />
                ₹{fmt(Math.abs(discrepancy))} short of {declaredByA.toFixed(2)} declared — shortage stays on {"{"}prev cashier{"}"}.
                Posts as Cash Short expense.
            </p>
        );
    }
    return (
        <p className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
            <TrendingUp size={12} />
            ₹{fmt(discrepancy)} more than declared. Posts as Cash Over income.
        </p>
    );
}
