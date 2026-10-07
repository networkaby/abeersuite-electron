"use client";

// "Send to all" — for an emergency or the run-up to year-end. Narrow the list,
// see how many customers and how much money it touches, type SEND, then watch
// it go out in batches. UI-first phase: the progress is simulated, nothing sends.

import { useEffect, useMemo, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumericInput } from "@/shared/components/NumericInput";
import { fmt } from "@/shared/lib/format/moneyInr";
import { EST_COST_PER_MESSAGE, TONE_LABEL, type ReminderTone } from "./sampleData";
import type { ReminderParty } from "./SendReminderDialog";

type Progress = { sent: number; failed: number; total: number; done: boolean };

export function BulkReminderDialog({ open, parties, onClose }: { open: boolean; parties: ReminderParty[]; onClose: () => void }) {
    const [minAmount, setMinAmount] = useState("500");
    const [minDays, setMinDays] = useState("30");
    const [skipDays, setSkipDays] = useState("3");
    const [tone, setTone] = useState<ReminderTone>("FIRM");
    const [confirm, setConfirm] = useState("");
    const [progress, setProgress] = useState<Progress | null>(null);
    const timer = useRef<ReturnType<typeof setInterval> | null>(null);

    const picked = useMemo(
        () => parties.filter((p) => p.balance >= (Number(minAmount) || 0) && p.oldestDays >= (Number(minDays) || 0)),
        [parties, minAmount, minDays],
    );
    const total = picked.reduce((s, p) => s + p.balance, 0);

    useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

    const close = () => {
        if (timer.current) clearInterval(timer.current);
        setProgress(null);
        setConfirm("");
        onClose();
    };

    const start = () => {
        const n = picked.length;
        setProgress({ sent: 0, failed: 0, total: n, done: n === 0 });
        timer.current = setInterval(() => {
            setProgress((p) => {
                if (!p) return p;
                const step = Math.min(10, p.total - p.sent - p.failed);
                const failed = p.failed + (step > 0 && p.sent + p.failed > 0 && (p.sent + p.failed) % 40 === 0 ? 1 : 0);
                const sent = p.sent + step - (failed - p.failed);
                const done = sent + failed >= p.total;
                if (done && timer.current) clearInterval(timer.current);
                return { ...p, sent, failed, done };
            });
        }, 400);
    };

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v) close(); }}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Send reminder to all</DialogTitle>
                    <DialogDescription>
                        For an emergency or before year-end. Excluded customers are always skipped.
                    </DialogDescription>
                </DialogHeader>

                {progress ? (
                    <div className="space-y-3 py-2">
                        <div className="h-3 overflow-hidden rounded-full bg-muted">
                            <div
                                className="h-full bg-primary transition-all"
                                style={{ width: `${progress.total ? ((progress.sent + progress.failed) / progress.total) * 100 : 100}%` }}
                            />
                        </div>
                        <p className="text-sm">
                            Sent <b>{progress.sent}</b> / {progress.total}
                            {progress.failed > 0 && <span className="text-red-600"> · {progress.failed} failed</span>}
                            {progress.done && <span className="text-emerald-600"> · Finished</span>}
                        </p>
                        <p className="text-xs text-muted-foreground">Preview only — this progress is simulated, nothing was sent.</p>
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <Label>Balance at least (₹)</Label>
                                <NumericInput mode="decimal" value={minAmount} onValueChange={setMinAmount} min={0} />
                            </div>
                            <div className="space-y-1">
                                <Label>Oldest bill at least (days)</Label>
                                <NumericInput value={minDays} onValueChange={setMinDays} min={0} max={3650} />
                            </div>
                            <div className="space-y-1">
                                <Label>Skip if reminded in last (days)</Label>
                                <NumericInput value={skipDays} onValueChange={setSkipDays} min={0} max={365} />
                            </div>
                            <div className="space-y-1">
                                <Label>Message</Label>
                                <div className="flex gap-1 rounded-md border p-1">
                                    {(Object.keys(TONE_LABEL) as ReminderTone[]).map((t) => (
                                        <button
                                            key={t}
                                            type="button"
                                            onClick={() => setTone(t)}
                                            className={`flex-1 rounded px-2 py-0.5 text-xs font-medium ${
                                                tone === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                                            }`}
                                        >
                                            {t === "SOFT" ? "Soft" : "Firm"}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/30 p-3 text-center">
                            <div>
                                <div className="text-xs text-muted-foreground">Customers</div>
                                <div className="text-lg font-semibold">{picked.length}</div>
                            </div>
                            <div>
                                <div className="text-xs text-muted-foreground">Total due</div>
                                <div className="text-lg font-mono font-semibold">₹{fmt(total)}</div>
                            </div>
                            <div>
                                <div className="text-xs text-muted-foreground">Approx. cost</div>
                                <div className="text-lg font-mono font-semibold">₹{fmt(picked.length * EST_COST_PER_MESSAGE)}</div>
                            </div>
                        </div>

                        <div className="space-y-1">
                            <Label>Type <b>SEND</b> to confirm</Label>
                            <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="SEND" autoComplete="off" />
                        </div>
                    </>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={close}>{progress?.done ? "Close" : "Cancel"}</Button>
                    {!progress && (
                        <Button disabled={confirm.trim() !== "SEND" || picked.length === 0} onClick={start}>
                            <Send size={14} /> Send to {picked.length}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
