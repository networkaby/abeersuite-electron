"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { fmt } from "@/utils/constants";
import { parseAmount, isAmountChars } from "@/utils/numberInput";
import { BillAllocationDrawer, type AllocationDraft } from "./BillAllocationDrawer";
import { PartyCombobox, type SelectedParty } from "./PartyCombobox";
import { GlAccountCombobox, type GlAccount } from "./GlAccountCombobox";
import { VoucherDialogFooter } from "./VoucherDialogFooter";
import { formatBalanceWithSide } from "@/modules/accountancy/lib/balanceFormat";
import { useDebitNoteDialogStore } from "@/store/debitNoteDialogStore";

type LineInput = {
    id: number;
    accountId: number;
    side: "DEBIT" | "CREDIT";
    amount: string;
};

const cell = "w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
let lineSeq = 0;
const newLine = (side: "DEBIT" | "CREDIT"): LineInput => ({
    id: ++lineSeq,
    accountId: 0,
    side,
    amount: "",
});

export function DebitNoteDialog() {
    const router = useRouter();
    const { open, setOpen } = useDebitNoteDialogStore();
    const [accounts, setAccounts] = useState<GlAccount[]>([]);
    const [nextRef, setNextRef] = useState("");
    const [saving, setSaving] = useState(false);
    const [party, setParty] = useState<SelectedParty | null>(null);
    const [allocations, setAllocations] = useState<AllocationDraft[]>([]);
    const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [narration, setNarration] = useState("");
    const [autoFocusSideLineId, setAutoFocusSideLineId] = useState<number | null>(null);
    const [lines, setLines] = useState<LineInput[]>([newLine("DEBIT"), newLine("CREDIT")]);

    const partyAccountId = party?.accountId ?? 0;

    const totalDebits = lines.filter((l) => l.side === "DEBIT").reduce((s, l) => s + parseAmount(l.amount), 0);
    const totalCredits = lines.filter((l) => l.side === "CREDIT").reduce((s, l) => s + parseAmount(l.amount), 0);
    const balanced = Math.abs(totalDebits - totalCredits) < 0.005 && totalDebits > 0;

    // Auto-balance helper from journal-style UX.
    const diff = totalDebits - totalCredits;
    const balancingAmount = Math.abs(diff);
    const balancingLineId: number | null = (() => {
        if (Math.abs(diff) < 0.005) return null;
        const targetSide: "DEBIT" | "CREDIT" = diff > 0 ? "CREDIT" : "DEBIT";
        for (let i = lines.length - 1; i >= 0; i--) {
            const l = lines[i];
            if (l.side === targetSide && l.amount === "") return l.id;
        }
        return null;
    })();

    const reset = () => {
        setDate(new Date().toISOString().slice(0, 10));
        setNarration("");
        setParty(null);
        setAllocations([]);
        setAutoFocusSideLineId(null);
        setLines([newLine("DEBIT"), newLine("CREDIT")]);
    };

    // For debit note, the party account naturally sits on debit side.
    useEffect(() => {
        setAllocations([]);
        if (!party) return;
        setLines((current) => {
            const idx = current.findIndex((l) => l.side === "DEBIT");
            if (idx === -1) return current;
            if (current[idx].accountId && current[idx].accountId !== party.accountId) return current;
            return current.map((l, i) => (i === idx ? { ...l, accountId: party.accountId } : l));
        });
    }, [party]);

    useEffect(() => {
        if (!open) return;
        axios.get<GlAccount[]>("/api/accountancy/gl-accounts")
            .then((r) => setAccounts(r.data))
            .catch(() => toast.error("Failed to load accounts"));
        axios.get<{ reference: string }>("/api/accountancy/vouchers/next-ref?type=DEBIT_NOTE")
            .then((r) => setNextRef(r.data.reference))
            .catch(() => setNextRef(""));
    }, [open]);

    const lineAccountOptions: GlAccount[] = (() => {
        if (!party) return accounts;
        const pref = {
            id: party.accountId,
            code: party.partyType === "company" ? "CO" : "CU",
            name: party.name,
            balance: 0,
            normalBalance: "DEBIT" as const,
            group: null,
        };
        const byId = new Map<number, GlAccount>([[pref.id, pref]]);
        for (const a of accounts) byId.set(a.id, a);
        return Array.from(byId.values());
    })();
    const accountById = new Map<number, GlAccount>(lineAccountOptions.map((a) => [a.id, a]));

    const updateLine = (lineId: number, patch: Partial<LineInput>) =>
        setLines((ls) => ls.map((l) => (l.id === lineId ? { ...l, ...patch } : l)));
    const addLine = (side: "DEBIT" | "CREDIT" = "DEBIT") => {
        const line = newLine(side);
        setLines((ls) => [...ls, line]);
        setAutoFocusSideLineId(line.id);
    };
    const removeLine = (lineId: number) =>
        setLines((ls) => ls.filter((l) => l.id !== lineId));

    const submit = async (postAfterSave: boolean) => {
        if (!balanced) { toast.error("Debits must equal credits"); return; }
        if (lines.some((l) => !l.accountId)) { toast.error("Each line needs an account"); return; }
        if (lines.some((l) => parseAmount(l.amount) <= 0)) { toast.error("Each line needs a positive amount"); return; }

        setSaving(true);
        try {
            const created = await axios.post<{ id: number; reference: string }>("/api/accountancy/vouchers", {
                type: "DEBIT_NOTE",
                date,
                narration: narration || undefined,
                partyAccountId: partyAccountId || undefined,
                lines: lines.map((l) => ({
                    accountId: l.accountId,
                    type: l.side,
                    amount: parseAmount(l.amount),
                })),
            });

            for (const a of allocations) {
                await axios.post("/api/accountancy/allocations", {
                    targetType: a.targetType,
                    targetId: a.targetId,
                    sourceType: "VOUCHER",
                    sourceId: created.data.id,
                    amount: a.amount,
                    method: a.method,
                    reference: a.targetRef,
                });
            }

            if (postAfterSave) {
                await axios.post(`/api/accountancy/vouchers/${created.data.id}/post`);
                toast.success(`Debit note ${created.data.reference} saved & posted`);
            } else {
                toast.success(`Debit note ${created.data.reference} saved as draft`);
            }
            reset();
            setOpen(false);
            router.refresh();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Save failed";
            toast.error(msg ?? "Save failed");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(isOpen) => {
                if (!isOpen) {
                    reset();
                    setOpen(false);
                }
            }}
        >
            <DialogContent className="max-w-4xl gap-0 p-0 sm:max-w-4xl">
                <DialogHeader className="border-b border-border px-5 py-4 pr-12">
                    <DialogTitle>New Debit Note</DialogTitle>
                </DialogHeader>

                <ScrollArea className="h-[500px]">
                    <div className="space-y-4 px-5 py-4">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>Date</Label>
                                <Input
                                    type="date"
                                    autoFocus
                                    value={date}
                                    onChange={(e) => setDate(e.target.value)}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Voucher No</Label>
                                <Input
                                    value={nextRef || "Generating..."}
                                    readOnly
                                    tabIndex={-1}
                                    className="font-mono text-muted-foreground"
                                    title="Pre-generated next reference. Final reference is assigned at save."
                                />
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <Label>Supplier (creditor)</Label>
                            <PartyCombobox
                                value={party}
                                onChange={setParty}
                                placeholder="Search by name or phone — type to find or create..."
                            />
                        </div>

                        <div className="grid grid-cols-[60px_minmax(0,1fr)_120px_120px_28px] gap-2 px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            <span>Dr/Cr</span>
                            <span>Particulars</span>
                            <span className="text-right">Debit</span>
                            <span className="text-right">Credit</span>
                            <span />
                        </div>

                        <div className="space-y-2">
                            {lines.map((line) => {
                                const amount = parseAmount(line.amount);
                                const account = line.accountId ? accountById.get(line.accountId) : undefined;
                                const isBalancing = line.id === balancingLineId && balancingAmount > 0;
                                return (
                                    <div key={line.id} className="space-y-1.5 rounded border border-border/60 bg-muted/20 p-2">
                                        <div className="grid grid-cols-[60px_minmax(0,1fr)_120px_120px_28px] items-center gap-2">
                                            <Select
                                                value={line.side}
                                                onValueChange={(v) => updateLine(line.id, { side: v as "DEBIT" | "CREDIT" })}
                                            >
                                                <SelectTrigger
                                                    className={cell}
                                                    autoFocus={line.id === autoFocusSideLineId}
                                                    aria-label="Dr or Cr"
                                                >
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="DEBIT">Dr</SelectItem>
                                                    <SelectItem value="CREDIT">Cr</SelectItem>
                                                </SelectContent>
                                            </Select>

                                            <GlAccountCombobox
                                                value={line.accountId || null}
                                                onChange={(a) => updateLine(line.id, { accountId: a?.id ?? 0 })}
                                                accounts={lineAccountOptions}
                                                placeholder="Select account"
                                            />

                                            <Input
                                                type="text"
                                                inputMode="decimal"
                                                value={line.side === "DEBIT" ? line.amount : "—"}
                                                readOnly={line.side !== "DEBIT"}
                                                tabIndex={line.side === "DEBIT" ? undefined : -1}
                                                className={`${cell} text-right tabular-nums ${line.side === "DEBIT" ? "" : "cursor-default bg-muted/30 text-muted-foreground/40"}`}
                                                placeholder={line.side === "DEBIT" && isBalancing ? `${fmt(balancingAmount)} <-` : ""}
                                                onChange={(e) => {
                                                    const v = e.target.value;
                                                    if (line.side === "DEBIT" && isAmountChars(v)) updateLine(line.id, { amount: v });
                                                }}
                                                onFocus={() => {
                                                    if (line.side === "DEBIT" && isBalancing && line.amount === "") {
                                                        updateLine(line.id, { amount: balancingAmount.toFixed(2) });
                                                    }
                                                }}
                                            />

                                            <Input
                                                type="text"
                                                inputMode="decimal"
                                                value={line.side === "CREDIT" ? line.amount : "—"}
                                                readOnly={line.side !== "CREDIT"}
                                                tabIndex={line.side === "CREDIT" ? undefined : -1}
                                                className={`${cell} text-right tabular-nums ${line.side === "CREDIT" ? "" : "cursor-default bg-muted/30 text-muted-foreground/40"}`}
                                                placeholder={line.side === "CREDIT" && isBalancing ? `${fmt(balancingAmount)} <-` : ""}
                                                onChange={(e) => {
                                                    const v = e.target.value;
                                                    if (line.side === "CREDIT" && isAmountChars(v)) updateLine(line.id, { amount: v });
                                                }}
                                                onFocus={() => {
                                                    if (line.side === "CREDIT" && isBalancing && line.amount === "") {
                                                        updateLine(line.id, { amount: balancingAmount.toFixed(2) });
                                                    }
                                                }}
                                            />

                                            <Button
                                                variant="ghost"
                                                size="icon-xs"
                                                className="text-destructive/60 hover:text-destructive"
                                                onClick={() => removeLine(line.id)}
                                                disabled={lines.length <= 2}
                                                title="Remove line"
                                            >
                                                <Trash2 size={14} />
                                            </Button>
                                        </div>

                                        {account && (
                                            <div className="grid grid-cols-[60px_minmax(0,1fr)_120px_120px_28px] gap-2 text-[11px] text-muted-foreground">
                                                <span />
                                                <span className="pl-2 italic">
                                                    Cur Bal: <span className="font-mono">{formatBalanceWithSide(account)}</span>
                                                </span>
                                                <span className="text-right font-mono">{line.side === "DEBIT" ? fmt(amount) : ""}</span>
                                                <span className="text-right font-mono">{line.side === "CREDIT" ? fmt(amount) : ""}</span>
                                                <span />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            <Button variant="ghost" size="sm" onClick={() => addLine("DEBIT")} className="h-auto py-1 text-xs">
                                <Plus size={12} className="mr-1" /> Add line
                            </Button>
                        </div>

                        <div className="space-y-1.5">
                            <Label>Narration</Label>
                            <Textarea
                                value={narration}
                                rows={2}
                                placeholder="e.g. Purchase return - wrong model"
                                onChange={(e) => setNarration(e.target.value)}
                            />
                        </div>

                        {partyAccountId > 0 && (
                            <BillAllocationDrawer
                                accountId={partyAccountId}
                                voucherAmount={totalDebits}
                                allocations={allocations}
                                onChange={setAllocations}
                            />
                        )}
                    </div>
                    <ScrollBar orientation="vertical" />
                </ScrollArea>

                <VoucherDialogFooter
                    saving={saving}
                    canSubmit={balanced}
                    onCancel={() => { reset(); setOpen(false); }}
                    onSaveDraft={() => submit(false)}
                    onSavePost={() => submit(true)}
                />
            </DialogContent>
        </Dialog>
    );
}
