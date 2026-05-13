"use client";

// ── ShiftCloseDialog ─────────────────────────────────────────────────────────
// Final shift close-out. Fetches the live shift detail (opening float, cash
// sales total, drops total, running expected balance), prompts the cashier
// for a physical count, surfaces variance, and posts the close on confirm.
//
// On success: the closing Contra (Till → Vault) is posted and (if variance
// ≠ 0) a small adjustment JE against Cash Short / Cash Over.

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, ArrowRightLeft, TrendingUp, TrendingDown, CheckCheck } from "lucide-react";
import {
    Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fmt } from "@/utils/constants";

type ShiftDetail = {
    id: number;
    openingFloatPaise: string;
    cashSalesPaise: string;
    dropsPaise: string;
    runningExpectedPaise: string;
    tillAccount: { name: string };
    branch: { name: string };
};

export function ShiftCloseDialog({
    open, onOpenChange, shiftId, onClosed,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    shiftId: number;
    onClosed: () => void;
}) {
    const [detail, setDetail] = useState<ShiftDetail | null>(null);
    const [loading, setLoading] = useState(false);
    const [declared, setDeclared] = useState("");
    const [notes, setNotes] = useState("");
    const [submitting, setSubmitting] = useState(false);

    // Load live shift detail every time the dialog opens — the running
    // expected balance updates as more sales come in.
    useEffect(() => {
        if (!open) return;
        setLoading(true);
        axios.get<ShiftDetail>(`/api/pos/shifts/${shiftId}`)
            .then((r) => {
                setDetail(r.data);
                // Pre-fill declared with the expected — common case is "drawer matches".
                setDeclared((Number(r.data.runningExpectedPaise) / 100).toFixed(2));
            })
            .catch(() => toast.error("Failed to load shift summary"))
            .finally(() => setLoading(false));
    }, [open, shiftId]);

    const expected = detail ? Number(detail.runningExpectedPaise) / 100 : 0;
    const declaredNum = parseFloat(declared) || 0;
    const variance = +(declaredNum - expected).toFixed(2);

    const submit = async () => {
        if (!detail) return;
        if (declaredNum < 0) { toast.error("Declared count can't be negative"); return; }
        setSubmitting(true);
        try {
            await axios.patch(`/api/pos/shifts/${shiftId}/close`, {
                declaredCashPaise: Math.round(declaredNum * 100),
                notes:             notes.trim() || undefined,
            });
            const varianceMsg = variance === 0 ? "matched" : variance > 0 ? `over by ₹${Math.abs(variance).toFixed(2)}` : `short by ₹${Math.abs(variance).toFixed(2)}`;
            toast.success(`Shift closed — drawer ${varianceMsg}`);
            onClosed();
            onOpenChange(false);
        } catch (e: unknown) {
            const msg = axios.isAxiosError(e) ? (e.response?.data as { error?: string })?.error : undefined;
            toast.error(msg ?? "Failed to close shift");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ArrowRightLeft size={18} className="text-primary" /> Close shift &amp; hand over
                    </DialogTitle>
                    <DialogDescription>
                        Count the physical cash in your drawer. The system posts a Contra to your branch&apos;s vault for the declared amount;
                        any variance hits Cash Short / Cash Over.
                    </DialogDescription>
                </DialogHeader>

                {loading || !detail ? (
                    <div className="flex justify-center py-8"><Loader2 className="animate-spin text-muted-foreground" size={24} /></div>
                ) : (
                    <div className="space-y-4 py-2">
                        {/* Expected breakdown */}
                        <div className="rounded-md border border-border bg-muted/40 p-3 text-sm space-y-1.5">
                            <Row label="Opening float"     value={fmt(Number(detail.openingFloatPaise) / 100)} />
                            <Row label="Cash sales (so far)" value={`+ ${fmt(Number(detail.cashSalesPaise) / 100)}`} />
                            <Row label="Cash dropped to safe" value={`− ${fmt(Number(detail.dropsPaise) / 100)}`} />
                            <div className="border-t border-border pt-1.5 flex justify-between font-semibold">
                                <span>Expected in drawer</span>
                                <span className="font-mono">₹{fmt(expected)}</span>
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="declared-amt">Counted physical cash (₹)</Label>
                            <Input
                                id="declared-amt"
                                type="text"
                                inputMode="decimal"
                                value={declared}
                                onChange={(e) => setDeclared(e.target.value.replace(/[^\d.]/g, ""))}
                                placeholder={expected.toFixed(2)}
                                autoFocus
                            />
                            {declared && (
                                <VarianceChip variance={variance} />
                            )}
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="close-notes">Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
                            <Textarea
                                id="close-notes"
                                rows={2}
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder="e.g. Customer dropped a ₹100 tip in the box"
                            />
                        </div>

                        <div className="rounded-md bg-primary/5 border border-primary/30 px-3 py-2 text-xs text-muted-foreground">
                            Posts: <span className="font-medium text-foreground">{detail.tillAccount.name}</span> → <span className="font-medium text-foreground">Cash – Vault – {detail.branch.name}</span> for ₹{fmt(declaredNum)}.
                        </div>
                    </div>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
                    <Button onClick={submit} disabled={submitting || loading} className="bg-green-600 hover:bg-green-700 text-white">
                        {submitting ? <Loader2 size={14} className="animate-spin" /> : <CheckCheck size={14} />}  Hand over &amp; close
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex justify-between text-muted-foreground">
            <span>{label}</span>
            <span className="font-mono text-foreground">₹{value}</span>
        </div>
    );
}

function VarianceChip({ variance }: { variance: number }) {
    if (variance === 0) {
        return <p className="text-xs text-green-700 dark:text-green-400">✓ Matches expected — no variance</p>;
    }
    const abs = Math.abs(variance);
    if (variance > 0) {
        return (
            <p className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                <TrendingUp size={12} /> Drawer over by ₹{fmt(abs)} → posts to Cash Over (income)
            </p>
        );
    }
    return (
        <p className="text-xs text-red-700 dark:text-red-400 flex items-center gap-1">
            <TrendingDown size={12} /> Drawer short by ₹{fmt(abs)} → posts to Cash Short (expense)
        </p>
    );
}
