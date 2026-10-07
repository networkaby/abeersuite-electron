"use client";

// One customer's due reminder: pick the tone, see exactly what the customer
// gets, press Send. UI-first phase — Send only says it is not wired yet.

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ExternalLink, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fmt } from "@/shared/lib/format/moneyInr";
import { formatDateCompact } from "@/shared/lib/format/formatDate";
import { TONE_LABEL, sampleReminderText, type ReminderTone } from "./sampleData";

export type ReminderParty = {
    accountId: number;
    name: string;
    balance: number;
    /** Oldest unpaid bill — what the firm wording quotes. */
    oldestBillDate: string | null;
    oldestDays: number;
};

export function ReminderPreview({ tone, party }: { tone: ReminderTone; party: ReminderParty }) {
    const text = sampleReminderText(tone, {
        customer: party.name,
        amount: fmt(party.balance),
        since: party.oldestBillDate ? formatDateCompact(party.oldestBillDate) : "—",
        shop: "our shop",
    });
    return (
        <div className="rounded-lg bg-[#e5ddd5] p-3 dark:bg-[#0b141a]">
            <div className="max-w-[90%] rounded-lg rounded-tl-none bg-white p-2.5 text-sm shadow-sm dark:bg-[#202c33] dark:text-[#e9edef]">
                <p className="whitespace-pre-wrap">{text}</p>
                <div className="mt-2 flex items-center justify-center gap-1.5 border-t pt-2 text-sm font-medium text-sky-600 dark:text-sky-400">
                    <ExternalLink size={14} /> Pay now
                </div>
            </div>
        </div>
    );
}

export function SendReminderDialog({ party, onClose }: { party: ReminderParty | null; onClose: () => void }) {
    const [tone, setTone] = useState<ReminderTone>("SOFT");
    // Stand-in for "a reminder already went to this customer today".
    const remindedToday = party != null && party.accountId % 5 === 0;

    return (
        <Dialog open={party != null} onOpenChange={(v) => { if (!v) onClose(); }}>
            <DialogContent className="sm:max-w-md">
                {party && (
                    <>
                        <DialogHeader>
                            <DialogTitle>Send due reminder</DialogTitle>
                            <DialogDescription>
                                WhatsApp and customer-app message to <b>{party.name}</b>.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="grid grid-cols-2 gap-2 text-sm">
                            <div className="rounded-md border px-3 py-2">
                                <div className="text-xs text-muted-foreground">Balance due</div>
                                <div className="font-mono font-semibold">₹{fmt(party.balance)}</div>
                            </div>
                            <div className="rounded-md border px-3 py-2">
                                <div className="text-xs text-muted-foreground">Oldest bill</div>
                                <div className="font-medium">
                                    {party.oldestBillDate ? formatDateCompact(party.oldestBillDate) : "—"}
                                    <span className="ml-1 text-xs text-muted-foreground">({party.oldestDays} days)</span>
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-1 rounded-md border p-1">
                            {(Object.keys(TONE_LABEL) as ReminderTone[]).map((t) => (
                                <button
                                    key={t}
                                    type="button"
                                    onClick={() => setTone(t)}
                                    className={`flex-1 rounded px-3 py-1 text-sm font-medium transition-colors ${
                                        tone === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                                    }`}
                                >
                                    {TONE_LABEL[t]}
                                </button>
                            ))}
                        </div>

                        <ReminderPreview tone={tone} party={party} />

                        {remindedToday && (
                            <div className="flex items-center gap-2 rounded-md bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                                <AlertTriangle size={14} /> Already reminded today at 10:00 am. You can still send again.
                            </div>
                        )}

                        <DialogFooter>
                            <Button variant="outline" onClick={onClose}>Cancel</Button>
                            <Button onClick={() => { toast.info("Preview only — sending is not wired yet."); onClose(); }}>
                                <Send size={14} /> Send
                            </Button>
                        </DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
