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
//
// Once a party is picked, its ledger balance shows under the name (Due / Advance),
// with what it becomes after the amount being typed — so the cashier knows whether
// this clears the dues, part-pays them or leaves an advance. Read fresh on every
// pick, never cached: this is the figure money is being taken against.

import { useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { openCashDrawer, printVoucherThermal } from "@/shared/lib/print/silentThermalPrint";
import { X } from "lucide-react";
import { useValueChange } from "@/shared/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    PartySearchAndCreate,
    type PartySearchAndCreateHandle,
    type PickedParty,
} from "@/shared/components/PartySearchAndCreate";
import { type TenderSplit, type TenderAccount } from "@/modules/pos/components/TenderSplitInput";
import { type PayState, movesCash } from "@/modules/pos/components/TenderEntry";
import { CheckoutDialog } from "@/modules/pos/components/CheckoutDialog";
import { PaymentLinkDialog } from "@/modules/pos/components/PaymentLinkDialog";
import { extractApiError } from "@/shared/lib/api";
import { formatInr } from "@/shared/lib/format";
import { cn } from "@/shared/lib/format/utils";
import { focusWhenReady } from "@/shared/lib/ui/focusWhenReady";

// Party balance, signed on the Dr side: > 0 the party owes us, < 0 an advance.
type Due = number | "loading" | "error";

function DueAmount({ due }: { due: number }) {
    if (Math.abs(due) < 0.005) return <span className="text-muted-foreground">No balance</span>;
    return (
        <span className={cn("font-medium", due > 0 ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400")}>
            {due > 0 ? "Due" : "Advance"} <span className="font-mono">{formatInr(Math.abs(due))}</span>
        </span>
    );
}

function PartyDueLine({ due, receiving }: { due: Due; receiving: number }) {
    if (due === "loading") return <p className="text-xs text-muted-foreground">Balance ···</p>;
    if (due === "error")   return <p className="text-xs text-muted-foreground">Balance unavailable</p>;
    return (
        <p className="text-xs">
            <DueAmount due={due} />
            {receiving > 0 && (
                <>
                    <span className="text-muted-foreground"> · After this receipt: </span>
                    <DueAmount due={due - receiving} />
                </>
            )}
        </p>
    );
}

export function PosReceiptDialog({
    open, onOpenChange, shiftId, paymentAccounts = [], onDone,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    shiftId: number;
    paymentAccounts?: TenderAccount[];
    onDone: () => void;
}) {
    const [party, setParty]   = useState<{ accountId: number; name: string; phone: string | null } | null>(null);
    const [pay, setPay]       = useState<PayState>({ cashTendered: 0, cashReturn: 0 });
    const [tenders, setTenders] = useState<TenderSplit[]>([]);
    const [note, setNote]     = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [shareOpen, setShareOpen]   = useState(false);
    const [shareVpa, setShareVpa]     = useState<string | null>(null);
    const [due, setDue]       = useState<Due>("loading");
    // Bumped on every pick, so a slow reply for an earlier party is dropped.
    const dueReq = useRef(0);
    const partyRef = useRef<PartySearchAndCreateHandle>(null);
    const cashTenderedRef = useRef<HTMLInputElement>(null);

    // Seed on open only — re-seeding mid-entry would wipe what the cashier typed.
    if (useValueChange(open, false) && open) {
        // Cash row is always present (TenderEntry); pre-show the accounts flagged
        // "default visible" as rows — same as the Sale/Order checkout does.
        setParty(null); setNote("");
        setPay({ cashTendered: 0, cashReturn: 0 });
        setTenders(
            paymentAccounts
                .filter((a) => a.defaultVisible)
                .map((a) => ({ id: crypto.randomUUID(), paymentAccountId: a.id, amount: 0, reference: "" })),
        );
    }

    const total = useMemo(() => {
        const cashNet = Math.max(0, pay.cashTendered - pay.cashReturn);
        return cashNet + tenders.reduce((s, t) => s + t.amount, 0);
    }, [pay, tenders]);

    const onPicked = (p: PickedParty) => {
        if (p.accountId == null) { toast.error(`${p.name} has no ledger account yet`); return; }
        setParty({ accountId: p.accountId, name: p.name, phone: p.phone });
        const req = ++dueReq.current;
        setDue("loading");
        axios.get<{ due: number }>(`/api/pos/party-balance/${p.accountId}`)
            .then(({ data }) => { if (req === dueReq.current) setDue(data.due); })
            .catch(() => { if (req === dueReq.current) setDue("error"); });
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
            if (printAfter) void printVoucherThermal("gl", data.voucherId, "RECEIPT", { openDrawer: movesCash(pay) });
            else if (movesCash(pay)) void openCashDrawer();
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
                            <div className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
                                <div className="min-w-0 space-y-0.5">
                                    <p className="truncate font-medium">{party.name}</p>
                                    <PartyDueLine due={due} receiving={total} />
                                </div>
                                <Button variant="ghost" size="sm" className="h-7 shrink-0 text-muted-foreground" onClick={() => { setParty(null); focusWhenReady(() => partyRef.current); }}>
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
                partyPhone={party?.phone ?? null}
                upiVpa={shareVpa}
                lockedProviderId="upi"
            />
        </>
    );
}
