"use client";

// ── PosReceiptDialog ─────────────────────────────────────────────────────────
// Collect a payment from a party (customer) at the counter — they clear an
// outstanding credit or pay an advance. Reuses the checkout multi-tender picker
// (TenderSplitInput): receive across Cash + UPI/Card accounts, each tender posting
// to its own ledger, with the per-account Share QR. Posts a RECEIPT voucher
// (one Dr per tender / Cr party AR). Cash legs fall in the shift window so the
// shift-close drawer picks them up; non-cash legs hit their bank ledger instead.

import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, HandCoins, X, Plus } from "lucide-react";
import {
    Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    PartySearchAndCreate,
    type PartySearchAndCreateHandle,
    type PickedParty,
} from "@/shared/components/PartySearchAndCreate";
import {
    TenderSplitInput, seedTenderSplit, type TenderSplit, type TenderAccount,
} from "@/modules/pos/components/TenderSplitInput";
import { PaymentLinkDialog } from "@/modules/pos/components/PaymentLinkDialog";

const fmtINR = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function PosReceiptDialog({
    open, onOpenChange, shiftId, counterName, paymentAccounts = [], onDone,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    shiftId: number;
    counterName?: string;
    paymentAccounts?: TenderAccount[];
    onDone: () => void;
}) {
    const [party, setParty]   = useState<{ accountId: number; name: string } | null>(null);
    const [tenders, setTenders] = useState<TenderSplit[]>([]);
    const [note, setNote]     = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [shareOpen, setShareOpen]   = useState(false);
    const [shareVpa, setShareVpa]     = useState<string | null>(null);
    const partyRef = useRef<PartySearchAndCreateHandle>(null);

    useEffect(() => {
        if (!open) return;
        // Start with one Cash row; the cashier changes the account or adds more.
        setParty(null); setNote("");
        setTenders([{ id: crypto.randomUUID(), paymentAccountId: null, amount: 0, reference: "" }]);
    }, [open]);

    const total = useMemo(() => tenders.reduce((s, t) => s + t.amount, 0), [tenders]);

    const onPicked = (p: PickedParty) => {
        if (p.accountId == null) { toast.error(`${p.name} has no ledger account yet`); return; }
        setParty({ accountId: p.accountId, name: p.name });
    };

    const submit = async () => {
        if (!party)     { toast.error("Pick the party paying"); return; }
        const lines = tenders.filter((t) => t.amount > 0).map((t) => ({ paymentAccountId: t.paymentAccountId, amountPaise: Math.round(t.amount * 100) }));
        if (lines.length === 0) { toast.error("Enter at least one amount"); return; }
        setSubmitting(true);
        try {
            const { data } = await axios.post<{ voucherId: number; voucherRef: string }>(`/api/pos/shifts/${shiftId}/receipts`, {
                accountId: party.accountId,
                tenders:   lines,
                note:      note.trim() || undefined,
            });
            toast.success(`Receipt ${data.voucherRef} · ${fmtINR(total)} from ${party.name}`);
            window.open(`/receipt/payment/${data.voucherId}`, "_blank", "noopener");
            onDone();
            onOpenChange(false);
        } catch (e: unknown) {
            const msg = axios.isAxiosError(e) ? (e.response?.data as { error?: string })?.error : undefined;
            toast.error(msg ?? "Failed to record receipt");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <HandCoins size={18} className="text-primary" /> Receive from party
                    </DialogTitle>
                    <DialogDescription>
                        Collect a payment from a customer (clearing credit, advance, etc.) across Cash and/or
                        UPI/Card — each tender posts to its own ledger ({counterName ?? "this counter"}&apos;s till
                        for cash, the account&apos;s bank for the rest). Share a UPI QR to collect remotely.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    <div className="space-y-1.5">
                        <Label>Party</Label>
                        {party ? (
                            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                                <span className="font-medium">{party.name}</span>
                                <Button variant="ghost" size="sm" className="h-7 text-muted-foreground" onClick={() => { setParty(null); setTimeout(() => partyRef.current?.focus(), 0); }}>
                                    <X size={13} /> Change
                                </Button>
                            </div>
                        ) : (
                            <PartySearchAndCreate
                                ref={partyRef}
                                onPicked={onPicked}
                                partyGroup="Sundry Debtors"
                                placeholder="Search customer by name or phone…"
                            />
                        )}
                    </div>

                    {/* Received in — multi-tender, reused from checkout. */}
                    <div className="space-y-2">
                        <Label>Received in</Label>
                        <TenderSplitInput
                            accounts={paymentAccounts}
                            value={tenders}
                            onChange={setTenders}
                            includeCash
                            onShare={(a) => { setShareVpa(a.vpa); setShareOpen(true); }}
                        />
                        <div className="flex items-center justify-between">
                            <Button variant="outline" size="sm" onClick={() => setTenders((prev) => [...prev, seedTenderSplit(paymentAccounts, 0, true)])}>
                                <Plus size={14} /> Add payment line
                            </Button>
                            <span className="text-sm font-semibold">Total {fmtINR(total)}</span>
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="rcv-note">Note <span className="text-muted-foreground text-xs">(optional)</span></Label>
                        <Input
                            id="rcv-note"
                            type="text"
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="e.g. against bill / advance"
                            maxLength={200}
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
                    <Button onClick={submit} disabled={submitting}>
                        {submitting && <Loader2 size={14} className="animate-spin" />} Record receipt
                    </Button>
                </DialogFooter>
            </DialogContent>

            <PaymentLinkDialog
                open={shareOpen}
                onOpenChange={setShareOpen}
                defaultAmount={total > 0 ? total : 0}
                partyName={party?.name}
                upiVpa={shareVpa}
                lockedProviderId="upi"
            />
        </Dialog>
    );
}
