"use client";

// One customer's due reminder: pick the tone, see exactly what the customer
// gets, press Send. App notification + WhatsApp, logged under Settings → Due
// Reminders.

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { AlertTriangle, ExternalLink, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { extractApiError } from "@/shared/lib/api";
import { fmt, formatAmount } from "@/shared/lib/format/moneyInr";
import { formatDateCompact } from "@/shared/lib/format/formatDate";
import { fillBody } from "@/shared/lib/whatsapp/billTemplates";
import { WA_UNCLEAR_TEXT } from "@/shared/lib/whatsapp/waSendOutcome";
import { TONE_LABEL, waStatusText, type ReminderSendInfo, type ReminderTone } from "@/shared/lib/whatsapp/dueReminderTypes";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";

export type ReminderParty = {
    accountId: number;
    name: string;
    balance: number;
    /** Oldest unpaid bill — what the firm wording quotes. */
    oldestBillDate: string | null;
    oldestDays: number;
};
const day = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });

/** The WhatsApp bubble — the template's own wording, filled for this party. */
export function ReminderPreview({ body, party }: { body: string; party: ReminderParty }) {
    const text = fillBody(body, {
        customer: party.name,
        amount: formatAmount(party.balance),
        date: party.oldestBillDate ? day.format(new Date(party.oldestBillDate)) : "—",
        shop: COMPANY_DETAILS.brandName,
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

/** Amber line under a template that cannot go on WhatsApp yet. */
export function TemplateStateNote({ state }: { state: string | undefined }) {
    if (!state || state === "ready") return null;
    return (
        <div className="flex items-center gap-2 rounded-md bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <AlertTriangle size={14} />
            {state === "off" ? "This template is switched off" : "This template is not approved by Meta yet"} on WhatsApp Templates —
            only the app notification will go.
        </div>
    );
}

export function SendReminderDialog({
    party, info, onClose, onSent,
}: {
    party: ReminderParty | null;
    info: ReminderSendInfo | null;
    onClose: () => void;
    onSent: () => void;
}) {
    const [tone, setTone] = useState<ReminderTone>("SOFT");
    const [sending, setSending] = useState(false);
    const last = party && info?.lastReminded[party.accountId];

    const send = async () => {
        if (!party) return;
        setSending(true);
        try {
            const { data } = await axios.post<{ results: { status: string; reason?: string; waStatus?: string }[] }>(
                "/api/due-reminders/send",
                { accountIds: [party.accountId], tone, mode: "MANUAL" },
            );
            const r = data.results[0];
            if (r?.status === "sent") {
                if (r.waStatus === "unclear") toast.warning(`${party.name}: ${WA_UNCLEAR_TEXT}`, { duration: 8000 });
                else toast.success(`Reminder sent to ${party.name} — WhatsApp: ${waStatusText(r.waStatus ?? "")}`);
                onSent();
                onClose();
            } else {
                toast.error(`Not sent: ${r?.reason ?? "unknown reason"}`);
            }
        } catch (e) {
            toast.error(extractApiError(e, "Could not send the reminder"));
        } finally {
            setSending(false);
        }
    };

    return (
        <Dialog open={party != null} onOpenChange={(v) => { if (!v && !sending) onClose(); }}>
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

                        {info ? (
                            <>
                                <ReminderPreview body={info.templates[tone].body} party={party} />
                                <TemplateStateNote state={info.templates[tone].state} />
                            </>
                        ) : (
                            <div className="flex justify-center py-6"><Loader2 className="animate-spin text-muted-foreground" size={20} /></div>
                        )}

                        {last && (
                            <div className="flex items-center gap-2 rounded-md bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                                <AlertTriangle size={14} /> Last reminded {new Date(last).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}. You can still send again.
                            </div>
                        )}

                        <DialogFooter>
                            <Button variant="outline" onClick={onClose} disabled={sending}>Cancel</Button>
                            <Button onClick={send} disabled={sending || !info}>
                                {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send
                            </Button>
                        </DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
