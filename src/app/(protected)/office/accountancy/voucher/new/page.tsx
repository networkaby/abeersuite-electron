"use client";

// Prototype voucher entry — pure ledger Dr/Cr with optional inventory tag.
// Each line can be toggled to "stock" mode → product picker + qty + rate,
// amount auto-computed (rate defaults: cost on Dr, sale on Cr).
// Posts to /api/finance/vouchers (5 GL voucher types).
// Note: stock lines hit the GL only — InvStockLedger / InvProduct.stock cache
// are not yet updated by this prototype API path.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Trash2, Plus, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { fmt } from "@/utils/constants";
import {
    InvProductCombobox, type SelectedProduct,
} from "@/modules/inventory/components/InvProductCombobox";

type VoucherType = "CONTRA" | "PAYMENT" | "RECEIPT" | "CREDIT_NOTE" | "DEBIT_NOTE";

const TYPE_LABEL: Record<VoucherType, string> = {
    CONTRA:      "Contra",
    PAYMENT:     "Payment",
    RECEIPT:     "Receipt",
    CREDIT_NOTE: "Credit Note",
    DEBIT_NOTE:  "Debit Note",
};

interface GlAccount { id: number; code: string | null; name: string }

type Line = {
    id: number;
    accountId: number;
    amount: string;
    // Stock mode (optional)
    isStock: boolean;
    productId: number | null;
    productName: string;
    qty: string;
    rate: string;
};

let lineSeq = 0;
const newLine = (): Line => ({
    id:          ++lineSeq,
    accountId:   0,
    amount:      "",
    isStock:     false,
    productId:   null,
    productName: "",
    qty:         "",
    rate:        "",
});

const cell = "w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

// Effective amount of a line — qty × rate when stock-mode, else the typed amount.
const lineAmount = (l: Line): number =>
    l.isStock
        ? (parseFloat(l.qty) || 0) * (parseFloat(l.rate) || 0)
        : (parseFloat(l.amount) || 0);

export default function NewVoucherPrototypePage() {
    const router = useRouter();
    const [accounts, setAccounts] = useState<GlAccount[]>([]);
    const [saving, setSaving] = useState(false);

    const [voucherType, setVoucherType] = useState<VoucherType>("PAYMENT");
    const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [narration, setNarration] = useState("");
    const [drLines, setDrLines] = useState<Line[]>([newLine()]);
    const [crLines, setCrLines] = useState<Line[]>([newLine()]);

    useEffect(() => {
        axios.get<GlAccount[]>("/api/finance/gl-accounts")
            .then((r) => setAccounts(r.data))
            .catch(() => toast.error("Failed to load accounts"));
    }, []);

    const totalDr  = drLines.reduce((s, l) => s + lineAmount(l), 0);
    const totalCr  = crLines.reduce((s, l) => s + lineAmount(l), 0);
    const balanced = Math.abs(totalDr - totalCr) < 0.005 && totalDr > 0;

    const setterFor = (side: "dr" | "cr") => side === "dr" ? setDrLines : setCrLines;

    const updateLine = (side: "dr" | "cr", id: number, patch: Partial<Line>) =>
        setterFor(side)((ls) => ls.map((l) => l.id === id ? { ...l, ...patch } : l));
    const addLine    = (side: "dr" | "cr") =>
        setterFor(side)((ls) => [...ls, newLine()]);
    const removeLine = (side: "dr" | "cr", id: number) =>
        setterFor(side)((ls) => ls.filter((l) => l.id !== id));

    const toggleStock = (side: "dr" | "cr", id: number) =>
        setterFor(side)((ls) => ls.map((l) => l.id === id
            ? { ...l, isStock: !l.isStock, qty: !l.isStock ? (l.qty || "1") : l.qty }
            : l,
        ));

    const handleProductSelect = (side: "dr" | "cr", id: number, p: SelectedProduct | null) => {
        const defaultRate = p
            ? (side === "dr" ? p.costPrice : p.salePrice)
            : null;
        updateLine(side, id, {
            productId:   p?.id   ?? null,
            productName: p?.name ?? "",
            rate:        defaultRate != null ? String(defaultRate) : "",
        });
    };

    const submit = async (postAfterSave: boolean) => {
        if (!balanced) { toast.error("Debits must equal credits"); return; }
        const all = [...drLines, ...crLines];
        if (all.some((l) => !l.accountId))                   { toast.error("Each line needs an account"); return; }
        if (all.some((l) => lineAmount(l) <= 0))             { toast.error("Each line needs a positive amount"); return; }
        if (all.some((l) => l.isStock && !l.productId))      { toast.error("Stock lines need a product"); return; }

        setSaving(true);
        try {
            const buildLines = (lines: Line[], type: "DEBIT" | "CREDIT") =>
                lines.map((l) => ({
                    accountId:   l.accountId,
                    type,
                    amount:      lineAmount(l),
                    description: l.isStock && l.productName
                        ? `${l.productName} × ${l.qty} @ ₹${l.rate}`
                        : undefined,
                }));

            const created = await axios.post<{ id: number }>("/api/finance/vouchers", {
                type:      voucherType,
                date,
                narration: narration.trim() || undefined,
                lines: [
                    ...buildLines(drLines, "DEBIT"),
                    ...buildLines(crLines, "CREDIT"),
                ],
            });

            if (postAfterSave) {
                await axios.post(`/api/finance/vouchers/${created.data.id}/post`);
                toast.success(`${TYPE_LABEL[voucherType]} saved & posted`);
            } else {
                toast.success(`${TYPE_LABEL[voucherType]} saved as draft`);
            }
            router.push("/office/accountancy/");
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
                return (
                    <div key={line.id} className="space-y-1">
                        {/* Row 1: Account · Stock toggle · Amount · Delete */}
                        <div className="grid grid-cols-[minmax(0,1fr)_36px_140px_32px] gap-2 items-center">
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
                            <Button
                                type="button"
                                variant={line.isStock ? "default" : "outline"}
                                size="icon-xs"
                                onClick={() => toggleStock(side, line.id)}
                                title={line.isStock ? "Disable stock mode" : "Tie this line to a stock item"}
                            >
                                <Package size={14} />
                            </Button>
                            {line.isStock ? (
                                <Input
                                    value={amt > 0 ? fmt(amt) : ""}
                                    readOnly
                                    className={`${cell} text-right tabular-nums bg-muted/40`}
                                    placeholder="qty × rate"
                                    title="Auto-calculated"
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

                        {/* Row 2 (only when stock-mode): Product · Qty · Rate */}
                        {line.isStock && (
                            <div className="grid grid-cols-[minmax(0,1fr)_70px_100px_60px] gap-2 items-center pl-3 ml-1 border-l-2 border-primary/30">
                                <InvProductCombobox
                                    value={line.productId}
                                    onChange={(p) => handleProductSelect(side, line.id, p)}
                                    placeholder="Search stock item…"
                                />
                                <Input
                                    type="number" min="0" step="0.001"
                                    value={line.qty}
                                    onChange={(e) => updateLine(side, line.id, { qty: e.target.value })}
                                    className={`${cell} text-right tabular-nums`}
                                    placeholder="qty"
                                />
                                <Input
                                    type="number" min="0" step="0.01"
                                    value={line.rate}
                                    onChange={(e) => updateLine(side, line.id, { rate: e.target.value })}
                                    className={`${cell} text-right tabular-nums`}
                                    placeholder="rate"
                                />
                                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                    {side === "dr" ? "@cost" : "@sale"}
                                </span>
                            </div>
                        )}
                    </div>
                );
            })}
            <Button variant="ghost" size="sm" onClick={() => addLine(side)} className="h-auto py-1 text-xs">
                <Plus size={12} className="mr-1" /> Add line
            </Button>
        </div>
    );

    return (
        <div className="max-w-5xl mx-auto space-y-5">
            <div>
                <h1 className="text-xl font-bold">New Voucher (prototype)</h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                    Pure ledger Dr/Cr entry. Toggle <Package size={12} className="inline mx-0.5" /> on any line to
                    tag it with a stock item — amount auto-fills from product cost (Dr) or sale (Cr) price.
                </p>
            </div>

            <div className="rounded-lg border border-border bg-card p-5 shadow space-y-4">
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
                        <Input value="Auto — assigned on save" readOnly className="text-muted-foreground" />
                    </div>
                </div>

                {/* Two-column Dr / Cr */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                    {/* DEBIT */}
                    <div className="rounded-lg border border-border p-3 space-y-3">
                        <div className="flex items-baseline justify-between">
                            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Debit (Dr)</h2>
                            <span className="text-xs text-muted-foreground">Account · 📦 · Amount</span>
                        </div>
                        {renderLines("dr", drLines)}
                        <div className="flex justify-between items-center border-t border-border pt-2 text-sm font-medium">
                            <span className="text-muted-foreground">Total</span>
                            <span className="font-mono tabular-nums">₹ {fmt(totalDr)}</span>
                        </div>
                    </div>

                    {/* CREDIT */}
                    <div className="rounded-lg border border-border p-3 space-y-3">
                        <div className="flex items-baseline justify-between">
                            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Credit (Cr)</h2>
                            <span className="text-xs text-muted-foreground">Account · 📦 · Amount</span>
                        </div>
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
                        <span className="text-green-600 font-medium">✓ Balanced — Dr = Cr = ₹ {fmt(totalDr)}</span>
                    ) : (
                        <span className="text-destructive font-medium">
                            Not balanced — difference ₹ {fmt(Math.abs(totalDr - totalCr))}
                        </span>
                    )}
                </div>

                {/* Narration */}
                <div className="space-y-1.5">
                    <Label>Narration</Label>
                    <Textarea
                        value={narration}
                        rows={2}
                        placeholder="Optional description"
                        onChange={(e) => setNarration(e.target.value)}
                    />
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" onClick={() => router.push("/office/accountancy/")}>Cancel</Button>
                    <Button variant="outline" onClick={() => submit(false)} disabled={saving || !balanced}>
                        {saving && <Loader2 size={14} className="animate-spin mr-1" />} Save Draft
                    </Button>
                    <Button onClick={() => submit(true)} disabled={saving || !balanced} className="bg-green-600 hover:bg-green-700 text-white border-green-600">
                        {saving && <Loader2 size={14} className="animate-spin mr-1" />} Save & Post
                    </Button>
                </div>
            </div>
        </div>
    );
}
