"use client";

// ── PosReceiptDialog ─────────────────────────────────────────────────────────
// The "Rcv" button — collect a payment from a party (customer) at the counter
// with NO order/bill behind it: they clear an outstanding credit or pay an
// advance. Renders the SAME checkout dialog as POS Sale / Save-Order, in
// `mode="receipt"`: this component owns the receipt state (party, tenders, note)
// and feeds CheckoutDialog the party picker (topSlot) + note (bottomSlot); the
// shared tender body (Cash + UPI/Card splits + per-account Share QR) and the CTAs
// come from CheckoutDialog. Posts a RECEIPT voucher (one Dr per tender / Cr party
// AR) — cash legs fall in the shift window for the close drawer; non-cash legs
// hit their own bank ledger.

import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    PartySearchAndCreate,
    type PartySearchAndCreateHandle,
    type PickedParty,
} from "@/shared/components/PartySearchAndCreate";
import { type TenderSplit, type TenderAccount } from "@/modules/pos/components/TenderSplitInput";
import { type PayState } from "@/modules/pos/components/TenderEntry";
import { CheckoutDialog } from "@/modules/pos/components/CheckoutDialog";
import { PaymentLinkDialog } from "@/modules/pos/components/PaymentLinkDialog";
import { extractApiError } from "@/shared/lib/api";
import { formatInr } from "@/shared/lib/format";

export function PosReceiptDialog({
    open, onOpenChange, shiftId, paymentAccounts = [], onDone,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    shiftId: number;
    paymentAccounts?: TenderAccount[];
    onDone: () => void;
}) {
    const [party, setParty]   = useState<{ accountId: number; name: string } | null>(null);
    const [pay, setPay]       = useState<PayState>({ cashTendered: 0, cashReturn: 0 });
    const [tenders, setTenders] = useState<TenderSplit[]>([]);
    const [note, setNote]     = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [shareOpen, setShareOpen]   = useState(false);
    const [shareVpa, setShareVpa]     = useState<string | null>(null);
    const partyRef = useRef<PartySearchAndCreateHandle>(null);
    const cashTenderedRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open) return;
        // Cash row is always present (TenderEntry); pre-show the accounts flagged
        // "default visible" as rows — same as the Sale/Order checkout does.
        setParty(null); setNote("");
        setPay({ cashTendered: 0, cashReturn: 0 });
        setTenders(
            paymentAccounts
                .filter((a) => a.defaultVisible)
                .map((a) => ({ id: crypto.randomUUID(), paymentAccountId: a.id, amount: 0, reference: "" })),
        );
        // Seed on open only — re-seeding mid-entry would wipe what the cashier typed.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const total = useMemo(() => {
        const cashNet = Math.max(0, pay.cashTendered - pay.cashReturn);
        return cashNet + tenders.reduce((s, t) => s + t.amount, 0);
    }, [pay, tenders]);

    const onPicked = (p: PickedParty) => {
        if (p.accountId == null) { toast.error(`${p.name} has no ledger account yet`); return; }
        setParty({ accountId: p.accountId, name: p.name });
    };

    const submit = async (printAfter = false) => {
        if (!party)     { toast.error("Pick the party paying"); return; }
        const cashNet = Math.max(0, pay.cashTendered - pay.cashReturn);
        const lines = [
            ...(cashNet > 0 ? [{ paymentAccountId: null, amountPaise: Math.round(cashNet * 100) }] : []),
            ...tenders.filter((t) => t.amount > 0).map((t) => ({ paymentAccountId: t.paymentAccountId, amountPaise: Math.round(t.amount * 100) })),
        ];
        if (lines.length === 0) { toast.error("Enter at least one amount"); return; }
        setSubmitting(true);
        try {
            const { data } = await axios.post<{ voucherId: number; voucherRef: string }>(`/api/pos/shifts/${shiftId}/receipts`, {
                accountId: party.accountId,
                tenders:   lines,
                note:      note.trim() || undefined,
            });
            toast.success(`Receipt ${data.voucherRef} · ${formatInr(total)} from ${party.name}`);
            if (printAfter) window.open(`/receipt/payment/${data.voucherId}`, "_blank", "noopener");
            onDone();
            onOpenChange(false);
        } catch (e: unknown) {
            toast.error(extractApiError(e, "Failed to record receipt"));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <>
            <CheckoutDialog
                mode="receipt"
                open={open}
                onOpenChange={onOpenChange}
                total={total}
                pay={pay}
                setPay={setPay}
                cashTenderedRef={cashTenderedRef}
                accounts={paymentAccounts}
                splits={tenders}
                setSplits={setTenders}
                submitting={submitting}
                confirmDisabled={!party || total <= 0}
                onConfirm={(printAfter) => void submit(printAfter)}
                onShare={(a) => { setShareVpa(a.vpa); setShareOpen(true); }}
                topSlot={
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
                }
                bottomSlot={
                    <div className="space-y-1.5 pt-1">
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
                }
            />

            <PaymentLinkDialog
                open={shareOpen}
                onOpenChange={setShareOpen}
                defaultAmount={total > 0 ? total : 0}
                partyName={party?.name}
                upiVpa={shareVpa}
                lockedProviderId="upi"
            />
        </>
    );
}
