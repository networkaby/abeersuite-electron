"use client";
// Shared form for the unified accounting Voucher (Contra / Payment / Receipt /
// Credit Note / Debit Note). Posts to /api/accountancy/vouchers and routes back to
// the type-specific list page on success.

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { fmt } from "@/utils/constants";
import { BillAllocationDrawer, type AllocationDraft } from "./BillAllocationDrawer";
import { PartyCombobox, type SelectedParty } from "./PartyCombobox";

export type VoucherFormType = "CONTRA" | "PAYMENT" | "RECEIPT" | "CREDIT_NOTE" | "DEBIT_NOTE";

interface GlAccount { id: number; code: string; name: string; type: string }

// On which side of the journal does the party ledger sit for each voucher type?
// PAYMENT  — party is Debited (settling a creditor reduces liability)
// RECEIPT  — party is Credited (settlement reduces a debtor's balance)
// CREDIT_NOTE — party Credited (sales return reduces what customer owes)
// DEBIT_NOTE  — party Debited  (purchase return reduces what we owe)
// CONTRA   — no party (cash↔bank movement)
function partyLineSide(t: VoucherFormType): "DEBIT" | "CREDIT" | null {
    switch (t) {
        case "PAYMENT":
        case "DEBIT_NOTE":
            return "DEBIT";
        case "RECEIPT":
        case "CREDIT_NOTE":
            return "CREDIT";
        case "CONTRA":
            return null;
    }
}

type LineInput = {
    accountId:   number;
    type:        "DEBIT" | "CREDIT";
    amount:      string;
    description: string;
};

const cell = "w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const TITLES: Record<VoucherFormType, string> = {
    CONTRA:      "Contra Voucher",
    PAYMENT:     "Payment Voucher",
    RECEIPT:     "Receipt Voucher",
    CREDIT_NOTE: "Credit Note",
    DEBIT_NOTE:  "Debit Note",
};

const PARTY_LABEL: Record<VoucherFormType, string> = {
    CONTRA:      "Counterparty (optional)",
    PAYMENT:     "Pay to (party / supplier)",
    RECEIPT:     "Received from (party / customer)",
    CREDIT_NOTE: "Customer (debtor)",
    DEBIT_NOTE:  "Supplier (creditor)",
};

const NARRATION_PLACEHOLDER: Record<VoucherFormType, string> = {
    CONTRA:      "e.g. Cash deposit to bank",
    PAYMENT:     "e.g. Office rent for Mar 2026",
    RECEIPT:     "e.g. Cash received from customer #123",
    CREDIT_NOTE: "e.g. Sales return — defective unit",
    DEBIT_NOTE:  "e.g. Purchase return — wrong model",
};

export function VoucherForm({ type, redirectTo }: { type: VoucherFormType; redirectTo: string }) {
    const router = useRouter();
    const [accounts, setAccounts] = useState<GlAccount[]>([]);
    const [saving, setSaving] = useState(false);
    const [party, setParty] = useState<SelectedParty | null>(null);

    const [form, setForm] = useState({
        date:           new Date().toISOString().slice(0, 10),
        narration:      "",
        lines: [
            { accountId: 0, type: "DEBIT" as const, amount: "", description: "" },
            { accountId: 0, type: "CREDIT" as const, amount: "", description: "" },
        ] as LineInput[],
    });
    const [allocations, setAllocations] = useState<AllocationDraft[]>([]);

    const partyAccountId = party?.accountId ?? 0;
    const partySide = partyLineSide(type);

    // When a party is picked, auto-fill the matching line with their ledger so
    // the user doesn't have to find their account in the line dropdown — same
    // flow as Tally's "Account: <party>" autofill.
    useEffect(() => {
        setAllocations([]); // referencing the old account
        if (!party || !partySide) return;
        setForm((f) => {
            const idx = f.lines.findIndex((l) => l.type === partySide);
            if (idx === -1) return f;
            // Avoid clobbering a different account the user may already have set.
            if (f.lines[idx].accountId && f.lines[idx].accountId !== party.accountId) return f;
            return {
                ...f,
                lines: f.lines.map((l, i) =>
                    i === idx ? { ...l, accountId: party.accountId } : l,
                ),
            };
        });
    }, [party, partySide]);

    useEffect(() => {
        axios.get<GlAccount[]>("/api/accountancy/gl-accounts")
            .then((r) => setAccounts(r.data))
            .catch(() => toast.error("Failed to load accounts"));
    }, []);

    // Line-account dropdown options — GL accounts plus the selected party
    // ledger (so its line shows the party name instead of "Select account").
    const lineAccountOptions: GlAccount[] = party
        ? [
            { id: party.accountId, code: party.partyType === "company" ? "CO" : "CU", name: party.name, type: "PARTY" },
            ...accounts,
        ]
        : accounts;

    const updateLine = (i: number, patch: Partial<LineInput>) =>
        setForm((f) => ({ ...f, lines: f.lines.map((l, idx) => idx === i ? { ...l, ...patch } : l) }));
    const addLine    = () => setForm((f) => ({ ...f, lines: [...f.lines, { accountId: 0, type: "DEBIT", amount: "", description: "" }] }));
    const removeLine = (i: number) => setForm((f) => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }));

    const totalDebits  = form.lines.filter((l) => l.type === "DEBIT").reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
    const totalCredits = form.lines.filter((l) => l.type === "CREDIT").reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
    const balanced     = Math.abs(totalDebits - totalCredits) < 0.005 && totalDebits > 0;

    const submit = async (postAfterSave: boolean) => {
        if (!balanced) { toast.error("Debits must equal credits"); return; }
        if (form.lines.some((l) => !l.accountId)) { toast.error("Each line needs an account"); return; }

        setSaving(true);
        try {
            const created = await axios.post<{ id: number }>("/api/accountancy/vouchers", {
                type,
                date:           form.date,
                narration:      form.narration || undefined,
                partyAccountId: partyAccountId || undefined,
                lines:          form.lines.map((l) => ({
                    accountId:   l.accountId,
                    type:        l.type,
                    amount:      parseFloat(l.amount),
                    description: l.description || undefined,
                })),
            });

            // Persist any bill-wise allocations the user added
            for (const a of allocations) {
                await axios.post("/api/accountancy/allocations", {
                    targetType: a.targetType,
                    targetId:   a.targetId,
                    sourceType: "VOUCHER",
                    sourceId:   created.data.id,
                    amount:     a.amount,
                    method:     a.method,
                    reference:  a.targetRef,
                });
            }

            if (postAfterSave) {
                await axios.post(`/api/accountancy/vouchers/${created.data.id}/post`);
                toast.success(`${TITLES[type]} saved & posted`);
            } else {
                toast.success(`${TITLES[type]} saved as draft`);
            }
            router.push(redirectTo);
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed";
            toast.error(msg ?? "Failed");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="max-w-4xl mx-auto space-y-5">
            <div>
                <h1 className="text-xl font-bold">New {TITLES[type]}</h1>
                <p className="text-sm text-muted-foreground mt-0.5">Reference number is auto-assigned on save.</p>
            </div>

            <div className="rounded-lg border border-border bg-card p-5 shadow space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                        <Label>Date</Label>
                        <Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                        <Label>{PARTY_LABEL[type]}</Label>
                        <PartyCombobox
                            value={party}
                            onChange={setParty}
                            placeholder="Search by name or phone — type to find or create…"
                        />
                    </div>
                </div>

                <div className="space-y-1.5">
                    <Label>Narration</Label>
                    <Textarea
                        value={form.narration}
                        rows={2}
                        placeholder={NARRATION_PLACEHOLDER[type]}
                        onChange={(e) => setForm((f) => ({ ...f, narration: e.target.value }))}
                    />
                </div>

                <div className="overflow-hidden rounded-lg border border-border">
                    <table className="w-full text-sm">
                        <thead className="bg-muted text-xs text-muted-foreground border-b border-border">
                            <tr>
                                <th className="px-3 py-2 text-left font-medium">Account</th>
                                <th className="px-3 py-2 text-left font-medium w-28">Dr / Cr</th>
                                <th className="px-3 py-2 text-right font-medium w-32">Amount</th>
                                <th className="px-3 py-2 text-left font-medium">Note</th>
                                <th className="px-3 py-2 w-8" />
                            </tr>
                        </thead>
                        <tbody>
                            {form.lines.map((line, i) => (
                                <tr key={i} className="border-t border-border">
                                    <td className="px-3 py-2 min-w-[200px]">
                                        <Select
                                            value={String(line.accountId)}
                                            onValueChange={(v) => updateLine(i, { accountId: Number(v) })}
                                        >
                                            <SelectTrigger className={cell}><SelectValue placeholder="Select account" /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="0">Select account</SelectItem>
                                                {lineAccountOptions.map((a) => (
                                                    <SelectItem key={a.id} value={String(a.id)}>
                                                        {a.type === "PARTY" ? `★ ${a.name}` : `${a.code} — ${a.name}`}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </td>
                                    <td className="px-3 py-2">
                                        <Select
                                            value={line.type}
                                            onValueChange={(v) => updateLine(i, { type: v as "DEBIT" | "CREDIT" })}
                                        >
                                            <SelectTrigger className={cell}><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="DEBIT">Debit</SelectItem>
                                                <SelectItem value="CREDIT">Credit</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </td>
                                    <td className="px-3 py-2">
                                        <Input
                                            type="number" min="0" step="0.01"
                                            value={line.amount}
                                            onChange={(e) => updateLine(i, { amount: e.target.value })}
                                            className={`${cell} text-right`}
                                            placeholder="0.00"
                                        />
                                    </td>
                                    <td className="px-3 py-2">
                                        <Input
                                            value={line.description}
                                            onChange={(e) => updateLine(i, { description: e.target.value })}
                                            className={cell}
                                            placeholder="Optional"
                                        />
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                        {form.lines.length > 2 && (
                                            <Button onClick={() => removeLine(i)} variant="ghost" size="icon-xs" className="text-destructive hover:text-destructive/80">
                                                <Trash2 size={14} />
                                            </Button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot className="border-t border-border bg-muted text-xs font-medium">
                            <tr>
                                <td colSpan={2} className="px-3 py-2 text-muted-foreground">Totals</td>
                                <td className="px-3 py-2 text-right">
                                    <div className={balanced ? "text-green-600" : "text-destructive"}>
                                        DR {fmt(totalDebits)} / CR {fmt(totalCredits)}
                                    </div>
                                    {!balanced && totalDebits > 0 && <div className="text-destructive">Not balanced</div>}
                                </td>
                                <td colSpan={2} />
                            </tr>
                        </tfoot>
                    </table>
                </div>

                <div className="flex items-center justify-between">
                    <Button onClick={addLine} variant="link" size="sm" className="h-auto p-0 text-sm">+ Add line</Button>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => router.push(redirectTo)}>Cancel</Button>
                        <Button onClick={() => submit(false)} variant="outline" disabled={saving || !balanced}>
                            {saving && <Loader2 size={14} className="animate-spin" />} Save Draft
                        </Button>
                        <Button onClick={() => submit(true)} disabled={saving || !balanced} className="bg-green-600 hover:bg-green-700 text-white border-green-600">
                            {saving && <Loader2 size={14} className="animate-spin" />} Save & Post
                        </Button>
                    </div>
                </div>
            </div>

            {/* Bill-wise allocation — visible only when a party account is selected. */}
            {partyAccountId > 0 && (
                <BillAllocationDrawer
                    accountId={partyAccountId}
                    voucherAmount={totalDebits}
                    allocations={allocations}
                    onChange={setAllocations}
                />
            )}
        </div>
    );
}
