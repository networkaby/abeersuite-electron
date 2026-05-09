"use client";

// Tally-style Journal Voucher dialog.
// Each Dr/Cr line is a ledger; under any line you can attach MULTIPLE inventory
// items (qty × rate). When stock items exist, the line amount is auto = Σ items.
// Posts to /api/finance/vouchers — pure GL (stock ledger NOT touched here; this
// is a learning prototype, mirrors Tally's "Journal voucher with inventory" view).

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, Plus, X, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { fmt } from "@/utils/constants";
import {
    InvProductCombobox, type SelectedProduct,
} from "@/modules/inventory/components/InvProductCombobox";
import { useJournalVoucherStore } from "@/store/journalVoucherStore";
import { isStockEligibleAccount } from "@/modules/accountancy/lib/stockEligibleAccount";

type VoucherType = "CONTRA" | "PAYMENT" | "RECEIPT" | "CREDIT_NOTE" | "DEBIT_NOTE";

const TYPE_LABEL: Record<VoucherType, string> = {
    CONTRA:      "Journal / Adjustment",
    PAYMENT:     "Payment",
    RECEIPT:     "Receipt",
    CREDIT_NOTE: "Credit Note",
    DEBIT_NOTE:  "Debit Note",
};

interface GlAccount {
    id: number;
    code: string | null;
    name: string;
    group: { type: "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE" | null } | null;
}

type StockItem = {
    id:          number;
    productId:   number | null;
    productName: string;
    unitCode:    string;
    qty:         string;
    rate:        string;
};

type Line = {
    id:         number;
    accountId:  number;
    amount:     string;        // typed amount (only when stockItems is empty)
    stockItems: StockItem[];   // multiple inventory rows under this ledger
};

let lineSeq = 0;
let stockSeq = 0;
const newLine = (): Line => ({ id: ++lineSeq, accountId: 0, amount: "", stockItems: [] });
const newStockItem = (): StockItem => ({
    id: ++stockSeq, productId: null, productName: "", unitCode: "", qty: "1", rate: "",
});

const stockItemAmount = (s: StockItem) =>
    (parseFloat(s.qty) || 0) * (parseFloat(s.rate) || 0);

const lineAmount = (l: Line) =>
    l.stockItems.length > 0
        ? l.stockItems.reduce((s, it) => s + stockItemAmount(it), 0)
        : (parseFloat(l.amount) || 0);

const cell = "w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function JournalVoucherDialog() {
    const router = useRouter();
    const { open, setOpen } = useJournalVoucherStore();
    const [accounts, setAccounts] = useState<GlAccount[]>([]);
    const [saving, setSaving]     = useState(false);

    const [voucherType, setVoucherType] = useState<VoucherType>("CONTRA");
    const [date, setDate]               = useState(() => new Date().toISOString().slice(0, 10));
    const [narration, setNarration]     = useState("");
    const [drLines, setDrLines]         = useState<Line[]>([newLine()]);
    const [crLines, setCrLines]         = useState<Line[]>([newLine()]);

    useEffect(() => {
        if (!open) return;
        axios.get<GlAccount[]>("/api/finance/gl-accounts")
            .then((r) => setAccounts(r.data))
            .catch(() => toast.error("Failed to load accounts"));
    }, [open]);

    const reset = () => {
        setVoucherType("CONTRA");
        setDate(new Date().toISOString().slice(0, 10));
        setNarration("");
        setDrLines([newLine()]);
        setCrLines([newLine()]);
    };

    const totalDr  = drLines.reduce((s, l) => s + lineAmount(l), 0);
    const totalCr  = crLines.reduce((s, l) => s + lineAmount(l), 0);
    const balanced = Math.abs(totalDr - totalCr) < 0.005 && totalDr > 0;

    // Eligibility map — only INCOME / EXPENSE ledgers can carry inventory.
    // Built fresh whenever the account list changes.
    const eligibleByAccountId = new Map<number, boolean>();
    const accountById = new Map<number, GlAccount>();
    for (const a of accounts) {
        eligibleByAccountId.set(a.id, isStockEligibleAccount(a));
        accountById.set(a.id, a);
    }

    const setterFor = (side: "dr" | "cr") => side === "dr" ? setDrLines : setCrLines;
    const updateLine = (side: "dr" | "cr", id: number, patch: Partial<Line>) =>
        setterFor(side)((ls) => ls.map((l) => {
            if (l.id !== id) return l;
            const merged = { ...l, ...patch };
            // If the account just changed to a non-eligible ledger, drop any
            // inventory items on this line and reset the typed amount.
            if (
                patch.accountId !== undefined &&
                patch.accountId !== l.accountId &&
                merged.stockItems.length > 0 &&
                !eligibleByAccountId.get(merged.accountId)
            ) {
                const droppedFor = accountById.get(merged.accountId)?.name ?? "this ledger";
                toast.info(`Inventory items removed — ${droppedFor} doesn't accept inventory`);
                merged.stockItems = [];
                merged.amount     = "";
            }
            return merged;
        }));
    const addLine = (side: "dr" | "cr") =>
        setterFor(side)((ls) => [...ls, newLine()]);
    const removeLine = (side: "dr" | "cr", id: number) =>
        setterFor(side)((ls) => ls.filter((l) => l.id !== id));

    const addStockItem = (side: "dr" | "cr", lineId: number) =>
        setterFor(side)((ls) => ls.map((l) =>
            l.id === lineId
                ? { ...l, amount: "", stockItems: [...l.stockItems, newStockItem()] }
                : l,
        ));
    const updateStockItem = (side: "dr" | "cr", lineId: number, itemId: number, patch: Partial<StockItem>) =>
        setterFor(side)((ls) => ls.map((l) =>
            l.id === lineId
                ? { ...l, stockItems: l.stockItems.map((s) => s.id === itemId ? { ...s, ...patch } : s) }
                : l,
        ));
    const removeStockItem = (side: "dr" | "cr", lineId: number, itemId: number) =>
        setterFor(side)((ls) => ls.map((l) =>
            l.id === lineId
                ? { ...l, stockItems: l.stockItems.filter((s) => s.id !== itemId) }
                : l,
        ));

    const handleProductSelect = (
        side: "dr" | "cr", lineId: number, itemId: number, p: SelectedProduct | null,
    ) => {
        const defaultRate = p ? (side === "dr" ? p.costPrice : p.salePrice) : null;
        updateStockItem(side, lineId, itemId, {
            productId:   p?.id ?? null,
            productName: p?.name ?? "",
            unitCode:    p?.unitCode ?? "",
            rate:        defaultRate != null ? String(defaultRate) : "",
        });
    };

    const submit = async (postAfterSave: boolean) => {
        if (!balanced) { toast.error("Debits must equal credits"); return; }
        const all = [...drLines, ...crLines];
        if (all.some((l) => !l.accountId))                     { toast.error("Each line needs an account"); return; }
        if (all.some((l) => lineAmount(l) <= 0))               { toast.error("Each line needs a positive amount"); return; }
        if (all.some((l) => l.stockItems.some((s) => !s.productId))) {
            toast.error("Inventory items need a product"); return;
        }
        if (all.some((l) => l.stockItems.some((s) => (parseFloat(s.qty) || 0) <= 0))) {
            toast.error("Inventory items need a positive qty"); return;
        }

        setSaving(true);
        try {
            const buildLines = (lines: Line[], type: "DEBIT" | "CREDIT") =>
                lines.map((l) => {
                    const desc = l.stockItems.length > 0
                        ? l.stockItems
                            .map((s) => `${s.productName} × ${s.qty}${s.unitCode ? " " + s.unitCode : ""} @ ₹${s.rate}`)
                            .join(" | ")
                        : undefined;
                    const stockItems = l.stockItems.length > 0
                        ? l.stockItems.map((s) => ({
                            productId: s.productId!,
                            qty:       parseFloat(s.qty)  || 0,
                            rate:      parseFloat(s.rate) || 0,
                        }))
                        : undefined;
                    return {
                        accountId:   l.accountId,
                        type,
                        amount:      lineAmount(l),
                        description: desc,
                        stockItems,
                    };
                });

            const res = await axios.post<{ voucherId: number; reference: string; posted: boolean }>(
                "/api/finance/journal-vouchers",
                {
                    type:            voucherType,
                    date,
                    narration:       narration.trim() || undefined,
                    postImmediately: postAfterSave,
                    lines: [
                        ...buildLines(drLines, "DEBIT"),
                        ...buildLines(crLines, "CREDIT"),
                    ],
                },
            );

            const ref = res.data.reference;
            if (postAfterSave) toast.success(`${TYPE_LABEL[voucherType]} ${ref} saved & posted`);
            else               toast.success(`${TYPE_LABEL[voucherType]} ${ref} saved as draft`);
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

    const renderLines = (side: "dr" | "cr", lines: Line[]) => (
        <div className="space-y-2">
            {lines.map((line) => {
                const amt = lineAmount(line);
                const hasStock = line.stockItems.length > 0;
                const eligible = line.accountId
                    ? (eligibleByAccountId.get(line.accountId) ?? false)
                    : false;
                return (
                    <div key={line.id} className="space-y-1.5 rounded border border-border/60 bg-muted/20 p-2">
                        {/* Row 1: Account · Amount · Delete */}
                        <div className="grid grid-cols-[minmax(0,1fr)_120px_28px] gap-2 items-center">
                            <Select
                                value={line.accountId ? String(line.accountId) : ""}
                                onValueChange={(v) => updateLine(side, line.id, { accountId: Number(v) })}
                            >
                                <SelectTrigger className={cell}>
                                    <SelectValue placeholder="Select account" />
                                </SelectTrigger>
                                <SelectContent>
                                    {accounts.map((a) => (
                                        <SelectItem key={a.id} value={String(a.id)}>
                                            {a.code ? `${a.code} — ${a.name}` : a.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {hasStock ? (
                                <Input
                                    value={amt > 0 ? fmt(amt) : ""}
                                    readOnly
                                    className={`${cell} text-right tabular-nums bg-muted/40`}
                                    title="Σ inventory items"
                                />
                            ) : (
                                <Input
                                    type="number" min="0" step="0.01"
                                    value={line.amount}
                                    onChange={(e) => updateLine(side, line.id, { amount: e.target.value })}
                                    className={`${cell} text-right tabular-nums`}
                                    placeholder="0.00"
                                />
                            )}
                            <Button
                                variant="ghost" size="icon-xs"
                                className="text-destructive/60 hover:text-destructive"
                                onClick={() => removeLine(side, line.id)}
                                disabled={lines.length <= 1}
                            >
                                <Trash2 size={14} />
                            </Button>
                        </div>

                        {/* Inventory items under this ledger — only when ledger is INCOME/EXPENSE */}
                        {eligible && line.stockItems.map((item) => (
                            <div
                                key={item.id}
                                className="grid grid-cols-[minmax(0,1fr)_56px_72px_72px_22px] gap-1.5 items-center pl-3 ml-1 border-l-2 border-primary/30"
                            >
                                <InvProductCombobox
                                    value={item.productId}
                                    onChange={(p) => handleProductSelect(side, line.id, item.id, p)}
                                    placeholder="Search item…"
                                />
                                <Input
                                    type="number" min="0" step="0.001"
                                    value={item.qty}
                                    onChange={(e) => updateStockItem(side, line.id, item.id, { qty: e.target.value })}
                                    className={`${cell} text-right tabular-nums`}
                                    placeholder="qty"
                                />
                                <Input
                                    type="number" min="0" step="0.01"
                                    value={item.rate}
                                    onChange={(e) => updateStockItem(side, line.id, item.id, { rate: e.target.value })}
                                    className={`${cell} text-right tabular-nums`}
                                    placeholder="rate"
                                />
                                <span className="text-xs tabular-nums text-right text-muted-foreground pr-1">
                                    {fmt(stockItemAmount(item))}
                                </span>
                                <Button
                                    variant="ghost" size="icon-xs"
                                    className="text-destructive/40 hover:text-destructive"
                                    onClick={() => removeStockItem(side, line.id, item.id)}
                                >
                                    <X size={11} />
                                </Button>
                            </div>
                        ))}

                        {eligible && (
                            <div className="flex items-center justify-between gap-2 pl-3">
                                <Button
                                    variant="ghost" size="sm"
                                    onClick={() => addStockItem(side, line.id)}
                                    className="h-auto py-0.5 text-xs text-muted-foreground hover:text-foreground"
                                >
                                    <Package size={11} className="mr-1" />
                                    + Inventory item
                                </Button>
                                {hasStock && (
                                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                        {side === "dr" ? "@cost default" : "@sale default"}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
            <Button variant="ghost" size="sm" onClick={() => addLine(side)} className="h-auto py-1 text-xs">
                <Plus size={12} className="mr-1" /> Add ledger line
            </Button>
        </div>
    );

    return (
        <Dialog
            open={open}
            onOpenChange={(isOpen) => { if (!isOpen) { reset(); setOpen(false); } }}
        >
            <DialogContent className="max-w-5xl gap-0 p-0 sm:max-w-5xl">
                <DialogHeader className="border-b border-border px-5 py-4 pr-12">
                    <DialogTitle>New Journal Voucher</DialogTitle>
                    <DialogDescription>
                        Tally-style journal voucher. Inventory items under a <strong>Dr</strong> line move stock <strong>IN</strong>;
                        items under a <strong>Cr</strong> line move stock <strong>OUT</strong>. Stock ledger and product balances update on Save&nbsp;&amp;&nbsp;Post.
                    </DialogDescription>
                </DialogHeader>

                <div className="max-h-[80vh] overflow-y-auto px-5 py-4 space-y-4">
                    {/* Header row */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="space-y-1.5">
                            <Label>Voucher Type</Label>
                            <Select value={voucherType} onValueChange={(v) => setVoucherType(v as VoucherType)}>
                                <SelectTrigger className={cell}><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {(Object.keys(TYPE_LABEL) as VoucherType[]).map((t) => (
                                        <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Date</Label>
                            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Voucher No</Label>
                            <Input value="Auto on save" readOnly className="text-muted-foreground" />
                        </div>
                    </div>

                    {/* Two-column Dr / Cr */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                        <div className="rounded-lg border border-border p-3 space-y-2">
                            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Debit (Dr)</h2>
                            {renderLines("dr", drLines)}
                            <div className="flex justify-between items-center border-t border-border pt-2 text-sm font-medium">
                                <span className="text-muted-foreground">Total</span>
                                <span className="font-mono tabular-nums">₹ {fmt(totalDr)}</span>
                            </div>
                        </div>

                        <div className="rounded-lg border border-border p-3 space-y-2">
                            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Credit (Cr)</h2>
                            {renderLines("cr", crLines)}
                            <div className="flex justify-between items-center border-t border-border pt-2 text-sm font-medium">
                                <span className="text-muted-foreground">Total</span>
                                <span className="font-mono tabular-nums">₹ {fmt(totalCr)}</span>
                            </div>
                        </div>
                    </div>

                    {/* Balance indicator */}
                    <div className="text-center text-sm">
                        {totalDr === 0 && totalCr === 0 ? (
                            <span className="text-muted-foreground">Enter amounts on both sides…</span>
                        ) : balanced ? (
                            <span className="text-green-600 font-medium">✓ Balanced — ₹ {fmt(totalDr)}</span>
                        ) : (
                            <span className="text-destructive font-medium">
                                Not balanced — diff ₹ {fmt(Math.abs(totalDr - totalCr))}
                            </span>
                        )}
                    </div>

                    {/* Narration */}
                    <div className="space-y-1.5">
                        <Label>Narration</Label>
                        <Textarea
                            value={narration}
                            rows={2}
                            placeholder="e.g. Damaged goods written off against sales"
                            onChange={(e) => setNarration(e.target.value)}
                        />
                    </div>
                </div>

                <div className="flex justify-end gap-2 border-t border-border bg-muted/50 px-5 py-3">
                    <Button variant="outline" onClick={() => { reset(); setOpen(false); }}>Cancel</Button>
                    <Button variant="outline" onClick={() => submit(false)} disabled={saving || !balanced}>
                        {saving && <Loader2 size={14} className="animate-spin mr-1" />} Save Draft
                    </Button>
                    <Button onClick={() => submit(true)} disabled={saving || !balanced} className="bg-green-600 hover:bg-green-700 text-white border-green-600">
                        {saving && <Loader2 size={14} className="animate-spin mr-1" />} Save & Post
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
