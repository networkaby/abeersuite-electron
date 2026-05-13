"use client";

// ── CashDropDialog ───────────────────────────────────────────────────────────
// Mid-shift cash drop — logs cash physically moved from the cashier's drawer
// into the safe. No GL movement (the closing Contra at end-of-shift handles
// that). Drop entries surface on the shift detail / report for audit.

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Lock } from "lucide-react";
import {
    Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function CashDropDialog({
    open, onOpenChange, shiftId, onDropped,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    shiftId: number;
    onDropped: () => void;
}) {
    const [amount, setAmount] = useState("");
    const [notes, setNotes] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const submit = async () => {
        const rupees = parseFloat(amount) || 0;
        if (rupees <= 0) { toast.error("Drop amount must be positive"); return; }
        setSubmitting(true);
        try {
            await axios.post(`/api/pos/shifts/${shiftId}/drops`, {
                amountPaise: Math.round(rupees * 100),
                notes:       notes.trim() || undefined,
            });
            toast.success(`Drop logged: ₹${rupees.toFixed(2)}`);
            setAmount("");
            setNotes("");
            onDropped();
            onOpenChange(false);
        } catch (e: unknown) {
            const msg = axios.isAxiosError(e) ? (e.response?.data as { error?: string })?.error : undefined;
            toast.error(msg ?? "Failed to log drop");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Lock size={18} className="text-primary" /> Drop cash to safe
                    </DialogTitle>
                    <DialogDescription>
                        Record cash physically moved from your drawer to the safe. This is a log only — your till balance
                        stays the same in the books; the closing Contra at end of shift settles everything to the manager.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    <div className="space-y-1.5">
                        <Label htmlFor="drop-amount">Amount dropped (₹)</Label>
                        <Input
                            id="drop-amount"
                            type="text"
                            inputMode="decimal"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                            placeholder="5000"
                            autoFocus
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="drop-notes">Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
                        <Textarea
                            id="drop-notes"
                            rows={2}
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="e.g. ₹5000 in 500s — drop at 2:30pm"
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
                    <Button onClick={submit} disabled={submitting}>
                        {submitting && <Loader2 size={14} className="animate-spin" />} Log drop
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
