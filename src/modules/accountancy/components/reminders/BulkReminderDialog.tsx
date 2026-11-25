"use client";

// "Send to all" — for an emergency or the run-up to year-end. Narrow the list,
// see how many customers and how much money it touches, type SEND, then watch
// it go out SEND_BATCH at a time. Closing the dialog stops after the batch in hand.

import { useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumericInput } from "@/shared/components/NumericInput";
import { extractApiError } from "@/shared/lib/api";
import { fmt } from "@/shared/lib/format/moneyInr";
import { EST_COST_PER_MESSAGE, SEND_BATCH, type ReminderSendInfo, type ReminderTone } from "@/shared/lib/whatsapp/dueReminderTypes";
import { TemplateStateNote, type ReminderParty } from "./SendReminderDialog";

type Progress = { sent: number; skipped: number; failed: number; unclear: number; total: number; done: boolean; noWa: number };

export function BulkReminderDialog({
    open, parties, info, onClose, onSent,
}: {
    open: boolean;
    parties: ReminderParty[];
    info: ReminderSendInfo | null;
    onClose: () => void;
    onSent: () => void;
}) {
    const [minAmount, setMinAmount] = useState("500");
    const [minDays, setMinDays] = useState("30");
    const [skipDays, setSkipDays] = useState("3");
    const [tone, setTone] = useState<ReminderTone>("FIRM");
    const [confirm, setConfirm] = useState("");
    const [progress, setProgress] = useState<Progress | null>(null);
    const stop = useRef(false);
    // "Reminded in the last N days" is measured from when the report was opened.
    const [now] = useState(() => Date.now());

    const picked = useMemo(() => {
        const skipMs = (Number(skipDays) || 0) * 86_400_000;
        return parties.filter((p) => {
            if (p.balance < (Number(minAmount) || 0) || p.oldestDays < (Number(minDays) || 0)) return false;
            const last = info?.lastReminded[p.accountId];
            return !(skipMs > 0 && last && now - new Date(last).getTime() < skipMs);
        });
    }, [parties, minAmount, minDays, skipDays, info, now]);
    const total = picked.reduce((s, p) => s + p.balance, 0);
    const running = progress != null && !progress.done;

    const close = () => {
        stop.current = true;
        if (progress) onSent();
        setProgress(null);
        setConfirm("");
        onClose();
    };

    const start = async () => {
        stop.current = false;
        const ids = picked.map((p) => p.accountId);
        const p: Progress = { sent: 0, skipped: 0, failed: 0, unclear: 0, noWa: 0, total: ids.length, done: false };
        setProgress({ ...p });
        for (let i = 0; i < ids.length && !stop.current; i += SEND_BATCH) {
            try {
                const { data } = await axios.post<{ results: { status: string; waStatus?: string }[] }>(
                    "/api/due-reminders/send",
                    { accountIds: ids.slice(i, i + SEND_BATCH), tone, mode: "ALL" },
                );
                for (const r of data.results) {
                    if (r.status !== "sent") p.skipped++;
                    else if (r.waStatus === "failed") p.failed++;
                    else if (r.waStatus === "unclear") p.unclear++;
                    else { p.sent++; if (r.waStatus !== "sent") p.noWa++; }
                }
            } catch (e) {
                toast.error(extractApiError(e, "Sending stopped"));
                p.failed += Math.min(SEND_BATCH, ids.length - i);
                break;
            }
            setProgress({ ...p });
        }
        setProgress({ ...p, done: true });
    };

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v) close(); }}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Send reminder to all</DialogTitle>
                    <DialogDescription>
                        For an emergency or before year-end. Customers on the Never remind list are always skipped.
                    </DialogDescription>
                </DialogHeader>

                {progress ? (
                    <div className="space-y-3 py-2">
                        <div className="h-3 overflow-hidden rounded-full bg-muted">
                            <div
                                className="h-full bg-primary transition-all"
                                style={{ width: `${progress.total ? ((progress.sent + progress.skipped + progress.failed + progress.unclear) / progress.total) * 100 : 100}%` }}
                            />
                        </div>
                        <p className="text-sm">
                            Sent <b>{progress.sent}</b> / {progress.total}
                            {progress.skipped > 0 && <span className="text-muted-foreground"> · {progress.skipped} skipped</span>}
                            {progress.failed > 0 && <span className="text-red-600"> · {progress.failed} failed</span>}
                            {progress.unclear > 0 && <span className="text-amber-600"> · {progress.unclear} not confirmed (check before resending)</span>}
                            {progress.done && <span className="text-emerald-600"> · Finished</span>}
                        </p>
                        {progress.noWa > 0 && (
                            <p className="text-xs text-muted-foreground">
                                {progress.noWa} got the app notification only (no mobile, or the template is not approved yet).
                            </p>
                        )}
                        <p className="text-xs text-muted-foreground">Every send is listed under Campaigns → Due Reminders → Recent reminders.</p>
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
                                <NumericInput value={skipDays} onValueChange={setSkipDays} min={0} max={30} />
                            </div>
                            <div className="space-y-1">
                                <Label>Message</Label>
                                <div className="flex gap-1 rounded-md border p-1">
                                    {(["SOFT", "FIRM"] as ReminderTone[]).map((t) => (
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

                        <TemplateStateNote state={info?.templates[tone].state} />

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
                    <Button variant="outline" onClick={close}>{running ? "Stop" : progress?.done ? "Close" : "Cancel"}</Button>
                    {!progress && (
                        <Button disabled={confirm.trim() !== "SEND" || picked.length === 0 || !info} onClick={start}>
                            <Send size={14} /> Send to {picked.length}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
