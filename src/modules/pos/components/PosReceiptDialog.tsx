"use client";

// ── PosReceiptDialog ─────────────────────────────────────────────────────────
// Collect a cash payment from a party (customer) at the counter — they clear an
// outstanding credit or pay an advance. Posts a RECEIPT voucher
// (Dr counter till / Cr party AR). The till debit is in the shift window, so the
// shift-close expected drawer picks it up automatically (sumShiftCashSalesPaise).

import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, HandCoins, X } from "lucide-react";
import {
    Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
    PartySearchAndCreate,
    type PartySearchAndCreateHandle,
    type PickedParty,
} from "@/shared/components/PartySearchAndCreate";

// The counter's payment accounts (UPI/Card/…) the receipt can land in.
type ReceiptAccount = { id: number; label: string; channel: string };

export function PosReceiptDialog({
    open, onOpenChange, shiftId, counterName, paymentAccounts = [], onDone,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    shiftId: number;
    counterName?: string;
    paymentAccounts?: ReceiptAccount[];
    onDone: () => void;
}) {
    const [party, setParty]       = useState<{ accountId: number; name: string } | null>(null);
    const [amount, setAmount]     = useState("");
    const [note, setNote]         = useState("");
    // Where the money came in. null = Cash (the counter till); else a payment account id.
    const [tenderId, setTenderId] = useState<number | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const partyRef = useRef<PartySearchAndCreateHandle>(null);

    useEffect(() => {
        if (!open) return;
        setParty(null); setAmount(""); setNote(""); setTenderId(null);
    }, [open]);

    const tenderLabel = tenderId == null ? "Cash" : (paymentAccounts.find((a) => a.id === tenderId)?.label ?? "Payment");

    const onPicked = (p: PickedParty) => {
        if (p.accountId == null) { toast.error(`${p.name} has no ledger account yet`); return; }
        setParty({ accountId: p.accountId, name: p.name });
    };

    const submit = async () => {
        const rupees = parseFloat(amount) || 0;
        if (!party)        { toast.error("Pick the party paying"); return; }
        if (rupees <= 0)   { toast.error("Amount must be positive"); return; }
        setSubmitting(true);
        try {
            const { data } = await axios.post<{ voucherId: number; voucherRef: string }>(`/api/pos/shifts/${shiftId}/receipts`, {
                accountId:        party.accountId,
                amountPaise:      Math.round(rupees * 100),
                paymentAccountId: tenderId,
                note:             note.trim() || undefined,
            });
            toast.success(`Receipt ${data.voucherRef} · ₹${rupees.toFixed(2)} from ${party.name}`);
            // Open the printable receipt (auto-prints on load) in a new tab.
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
                        Collect a payment from a customer (clearing credit, advance, etc.). Posts a receipt voucher
                        (Dr {tenderId == null ? (counterName ?? "counter till") : tenderLabel} / Cr the party)
                        {tenderId == null ? " — the cash lands in this counter’s drawer." : " — booked to that account’s ledger."}
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

                    <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="rcv-amount">Amount received (₹)</Label>
                            <Input
                                id="rcv-amount"
                                type="text"
                                inputMode="decimal"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                                placeholder="500"
                            />
                        </div>
                        {/* Received in — Cash (till) by default, or a counter payment
                            account (UPI/Card/…) so the receipt debits the right ledger. */}
                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Received in</Label>
                            <Select
                                value={tenderId == null ? "cash" : String(tenderId)}
                                onValueChange={(v) => setTenderId(v === "cash" ? null : Number(v))}
                            >
                                <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="cash">Cash (drawer)</SelectItem>
                                    {paymentAccounts.map((a) => (
                                        <SelectItem key={a.id} value={String(a.id)}>{a.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
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
        </Dialog>
    );
}
