"use client";

// Tally-style Journal Voucher dialog — line-below-line layout.
// Always submits as a Journal voucher (underlying type=CONTRA → CV-XXXX ref).
// Each line: [Dr/Cr] [Account] [Amount]. Inventory items can attach under any
// line whose account is INCOME or EXPENSE. The LAST empty amount input shows
// the balancing diff as its placeholder (and auto-fills on focus) so the user
// rarely has to type the second amount — Tally's "auto-balance" behavior.

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Trash2, Plus, X, Package } from "lucide-react";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { fmt } from "@/utils/constants";
import { parseAmount, isAmountChars } from "@/utils/numberInput";
import {
    InvProductCombobox, type SelectedProduct,
} from "@/modules/inventory/components/InvProductCombobox";
import { GlAccountCombobox } from "@/modules/accountancy/components/GlAccountCombobox";
import { VoucherDialogFooter } from "@/modules/accountancy/components/VoucherDialogFooter";
import { formatBalanceWithSide } from "@/modules/accountancy/lib/balanceFormat";
import { useJournalVoucherStore } from "@/store/journalVoucherStore";
import { isStockEligibleAccount } from "@/modules/accountancy/lib/stockEligibleAccount";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

// Voucher.type stored on the row. The reference number follows the JOURNAL
// VoucherSeries (Settings → Year Ending), producing "JOURNAL/26-27/0001"-style refs.
const UNDERLYING_TYPE = "JOURNAL" as const;
const SERIES_KIND = "JOURNAL" as const;

type Side = "DEBIT" | "CREDIT";

interface GlAccount {
    id: number;
    code: string | null;
    name: string;
    /** Effective closing balance (running + opening, sign-corrected). */
    balance: number;
    normalBalance: "DEBIT" | "CREDIT" | null;
    group: { id: number; name: string; type: "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE" | null } | null;
}

type StockItem = {
    id: number;
    productId: number | null;
    productName: string;
    unitCode: string;
    qty: string;
    rate: string;
};

type Line = {
    id: number;
    side: Side;
    accountId: number;
    amount: string;        // typed amount (only when stockItems is empty)
    stockItems: StockItem[];   // multiple inventory rows under this ledger
};

let lineSeq = 0;
let stockSeq = 0;
const newLine = (side: Side): Line => ({
    id: ++lineSeq, side, accountId: 0, amount: "", stockItems: [],
});
const newStockItem = (): StockItem => ({
    id: ++stockSeq, productId: null, productName: "", unitCode: "", qty: "1", rate: "",
});

const stockItemAmount = (s: StockItem) =>
    (parseFloat(s.qty) || 0) * (parseFloat(s.rate) || 0);

const lineAmount = (l: Line) =>
    l.stockItems.length > 0
        ? l.stockItems.reduce((s, it) => s + stockItemAmount(it), 0)
        : parseAmount(l.amount);

const cell = "w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

// One amount cell — Debit OR Credit. Active when isOwnSide === true; otherwise
// shows a dim "—" and is readonly. Stock-driven amounts (qty × rate) display
// the computed total read-only with a subtle bg.
function AmountCell({
    line, isOwnSide, hasStock, amt, isBalancing, balancingAmount, onChange, onAutoFill,
}: {
    line: Line;
    isOwnSide: boolean;
    hasStock: boolean;
    amt: number;
    isBalancing: boolean;
    balancingAmount: number;
    onChange: (v: string) => void;
    onAutoFill: () => void;
}) {
    if (!isOwnSide) {
        return (
            <Input
                value="—"
                readOnly
                tabIndex={-1}
                className={`${cell} text-right tabular-nums text-muted-foreground/40 bg-muted/30 cursor-default`}
            />
        );
    }
    if (hasStock) {
        return (
            <Input
                value={amt > 0 ? fmt(amt) : ""}
                readOnly
                className={`${cell} text-right tabular-nums bg-muted/40`}
                title="Σ inventory items"
            />
        );
    }
    return (
        <Input
            type="text"
            inputMode="decimal"
            value={line.amount}
            onChange={(e) => {
                const v = e.target.value;
                if (isAmountChars(v)) onChange(v);
            }}
            onFocus={() => {
                // Tally-style auto-fill: focusing the balancing row's empty
                // amount snaps in the diff so the user can just hit Enter.
                if (isBalancing && line.amount === "") onAutoFill();
            }}
            className={`${cell} text-right tabular-nums`}
            placeholder={isBalancing ? `${fmt(balancingAmount)} ←` : ""}
        />
    );
}

export function JournalVoucherDialog() {
    const router = useRouter();
    const { open, setOpen } = useJournalVoucherStore();
    const [accounts, setAccounts] = useState<GlAccount[]>([]);
    const [saving, setSaving] = useState(false);
    const [nextRef, setNextRef] = useState<string>("");

    const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [narration, setNarration] = useState("");
    const [autoFocusSideLineId, setAutoFocusSideLineId] = useState<number | null>(null);
    // Single sequential list of lines — Dr/Cr is per-line via dropdown.
    const [lines, setLines] = useState<Line[]>([newLine("DEBIT"), newLine("CREDIT")]);

    useEffect(() => {
        if (!open) return;
        // includeParties=true → Sundry Debtors / Creditors ledgers appear in
        // the line account picker, so a JV can debit / credit a party directly.
        axios.get<GlAccount[]>("/api/accountancy/gl-accounts?includeParties=true")
            .then((r) => setAccounts(r.data))
            .catch(() => toast.error("Failed to load accounts"));
        // Preview the voucher number — see /api/accountancy/vouchers/next-ref.
        // Uses the JOURNAL VoucherSeries so the format matches Year Ending settings.
        axios.get<{ reference: string }>(`/api/accountancy/vouchers/next-ref?type=${SERIES_KIND}`)
            .then((r) => setNextRef(r.data.reference))
            .catch(() => setNextRef(""));
    }, [open]);

    const reset = () => {
        setDate(new Date().toISOString().slice(0, 10));
        setNarration("");
        setAutoFocusSideLineId(null);
        setLines([newLine("DEBIT"), newLine("CREDIT")]);
    };

    const totalDr = lines.filter((l) => l.side === "DEBIT").reduce((s, l) => s + lineAmount(l), 0);
    const totalCr = lines.filter((l) => l.side === "CREDIT").reduce((s, l) => s + lineAmount(l), 0);
    const balanced = Math.abs(totalDr - totalCr) < 0.005 && totalDr > 0;

    const accountById = new Map<number, GlAccount>(accounts.map((a) => [a.id, a]));
    const eligibleByAccountId = new Map<number, boolean>(
        accounts.map((a) => [a.id, isStockEligibleAccount(a)]),
    );

    // Detect Sundry Debtors / Creditors so we can hint about bill-wise allocation
    // (TODO: wire up BillAllocationDrawer — see docs/modules/accountancy.md).
    const isPartyAccount = (accountId: number): boolean => {
        const g = accountById.get(accountId)?.group?.name ?? "";
        return g === ACCOUNT_GROUPS.SUNDRY_DEBTORS || g === ACCOUNT_GROUPS.SUNDRY_CREDITORS;
    };

    // Auto-balance: which empty line should soak up the diff between the two sides?
    // We pick the LAST line whose typed amount is empty AND whose direction would
    // reduce the diff. Suggestion shown as the input placeholder; on focus we
    // fill it as the actual value so the user can hit Tab to accept.
    const diff = totalDr - totalCr;     // > 0 → Cr needs more; < 0 → Dr needs more
    const balancingLineId: number | null = (() => {
        if (Math.abs(diff) < 0.005) return null;
        const targetSide: Side = diff > 0 ? "CREDIT" : "DEBIT";
        // Walk backward to find the LAST empty line on the target side.
        for (let i = lines.length - 1; i >= 0; i--) {
            const l = lines[i];
            if (l.side === targetSide && l.amount === "" && l.stockItems.length === 0) {
                return l.id;
            }
        }
        return null;
    })();
    const balancingAmount = Math.abs(diff);

    const updateLine = (id: number, patch: Partial<Line>) =>
        setLines((ls) => ls.map((l) => {
            if (l.id !== id) return l;
            const merged = { ...l, ...patch };
            // Drop any inventory items if the new account is non-eligible.
            if (
                patch.accountId !== undefined &&
                patch.accountId !== l.accountId &&
                merged.stockItems.length > 0 &&
                !eligibleByAccountId.get(merged.accountId)
            ) {
                const droppedFor = accountById.get(merged.accountId)?.name ?? "this ledger";
                toast.info(`Inventory items removed — ${droppedFor} doesn't accept inventory`);
                merged.stockItems = [];
                merged.amount = "";
            }
            return merged;
        }));
    const addLine = (side: Side = "DEBIT") => {
        const line = newLine(side);
        setLines((ls) => [...ls, line]);
        setAutoFocusSideLineId(line.id);
    };
    const removeLine = (id: number) =>
        setLines((ls) => ls.filter((l) => l.id !== id));

    const addStockItem = (lineId: number) =>
        setLines((ls) => ls.map((l) =>
            l.id === lineId
                ? { ...l, amount: "", stockItems: [...l.stockItems, newStockItem()] }
                : l,
        ));
    const updateStockItem = (lineId: number, itemId: number, patch: Partial<StockItem>) =>
        setLines((ls) => ls.map((l) =>
            l.id === lineId
                ? { ...l, stockItems: l.stockItems.map((s) => s.id === itemId ? { ...s, ...patch } : s) }
                : l,
        ));
    const removeStockItem = (lineId: number, itemId: number) =>
        setLines((ls) => ls.map((l) =>
            l.id === lineId
                ? { ...l, stockItems: l.stockItems.filter((s) => s.id !== itemId) }
                : l,
        ));

    const handleProductSelect = (
        line: Line, itemId: number, p: SelectedProduct | null,
    ) => {
        const defaultRate = p ? (line.side === "DEBIT" ? p.costPrice : p.salePrice) : null;
        updateStockItem(line.id, itemId, {
            productId: p?.id ?? null,
            productName: p?.name ?? "",
            unitCode: p?.unitCode ?? "",
            rate: defaultRate != null ? String(defaultRate) : "",
        });
    };

    // Validate on submit — no inline "0.00" placeholder noise.
    const submit = async (postAfterSave: boolean) => {
        if (lines.some((l) => !l.accountId)) { toast.error("Each line needs an account"); return; }
        if (lines.some((l) => lineAmount(l) <= 0)) { toast.error("Each line needs a positive amount"); return; }
        if (!balanced) { toast.error("Debits must equal credits"); return; }
        if (lines.some((l) => l.stockItems.some((s) => !s.productId))) {
            toast.error("Inventory items need a product"); return;
        }
        if (lines.some((l) => l.stockItems.some((s) => (parseFloat(s.qty) || 0) <= 0))) {
            toast.error("Inventory items need a positive qty"); return;
        }

        setSaving(true);
        try {
            const payloadLines = lines.map((l) => {
                const desc = l.stockItems.length > 0
                    ? l.stockItems
                        .map((s) => `${s.productName} × ${s.qty}${s.unitCode ? " " + s.unitCode : ""} @ ₹${s.rate}`)
                        .join(" | ")
                    : undefined;
                const stockItems = l.stockItems.length > 0
                    ? l.stockItems.map((s) => ({
                        productId: s.productId!,
                        qty: parseFloat(s.qty) || 0,
                        rate: parseFloat(s.rate) || 0,
                    }))
                    : undefined;
                return {
                    accountId: l.accountId,
                    type: l.side,
                    amount: lineAmount(l),
                    description: desc,
                    stockItems,
                };
            });

            const res = await axios.post<{ voucherId: number; reference: string; posted: boolean }>(
                "/api/accountancy/journal-vouchers",
                {
                    type: UNDERLYING_TYPE,
                    date,
                    narration: narration.trim() || undefined,
                    postImmediately: postAfterSave,
                    lines: payloadLines,
                },
            );

            const ref = res.data.reference;
            if (postAfterSave) toast.success(`Journal voucher ${ref} saved & posted`);
            else toast.success(`Journal voucher ${ref} saved as draft`);
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
            onOpenChange={(isOpen) => { if (!isOpen) { reset(); setOpen(false); } }}
        >
            <DialogContent
                className="max-w-3xl gap-0 p-0 sm:max-w-3xl"
                // Don't dismiss on click-outside — voucher entry is too easy to
                // lose to a stray click. User must explicitly hit Cancel / Close.
                onPointerDownOutside={(e) => e.preventDefault()}
                onInteractOutside={(e) => e.preventDefault()}
            >
                <DialogHeader className="border-b border-border px-5 py-4 pr-12">
                    <DialogTitle>New Journal Voucher</DialogTitle>
                </DialogHeader>
                <ScrollArea className="h-[500px]">
                    <div className="max-h-[80vh]  px-5 py-4 space-y-4">
                        {/* Header row — voucher number now pre-generated */}
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
                                    value={nextRef || "Generating…"}
                                    readOnly
                                    tabIndex={-1}
                                    className="text-muted-foreground font-mono"
                                    title="Pre-generated next reference. Final reference is assigned at save (may shift by ±1 under concurrent saves)."
                                />
                            </div>
                        </div>

                        {/* Header row labels — Tally-style two amount columns. */}
                        <div className="grid grid-cols-[60px_minmax(0,1fr)_120px_120px_28px] gap-2 px-2 text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                            <span>Dr/Cr</span>
                            <span>Particulars</span>
                            <span className="text-right">Debit</span>
                            <span className="text-right">Credit</span>
                            <span />
                        </div>

                        {/* Sequential line list */}
                        <div className="space-y-2">
                            {lines.map((line) => {
                                const amt = lineAmount(line);
                                const hasStock = line.stockItems.length > 0;
                                const acct = line.accountId ? accountById.get(line.accountId) : undefined;
                                const eligible = line.accountId ? (eligibleByAccountId.get(line.accountId) ?? false) : false;
                                const isParty = line.accountId ? isPartyAccount(line.accountId) : false;
                                const isBalancing = !hasStock && line.id === balancingLineId && balancingAmount > 0;
                                return (
                                    <div key={line.id} className="rounded border border-border/60 bg-muted/20 p-2 space-y-1.5">
                                        {/* Row 1: Dr/Cr · Account · Debit · Credit · Delete */}
                                        <div className="grid grid-cols-[60px_minmax(0,1fr)_120px_120px_28px] gap-2 items-center">
                                            <Select
                                                value={line.side}
                                                onValueChange={(v) => updateLine(line.id, { side: v as Side })}
                                            >
                                                <SelectTrigger
                                                    className={cell}
                                                    aria-label="Dr or Cr"
                                                    autoFocus={line.id === autoFocusSideLineId}
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
                                                accounts={accounts}
                                                placeholder="Select account"
                                            />
                                            {/* Debit cell — active when side === DEBIT */}
                                            <AmountCell
                                                line={line}
                                                isOwnSide={line.side === "DEBIT"}
                                                hasStock={hasStock}
                                                amt={amt}
                                                isBalancing={isBalancing}
                                                balancingAmount={balancingAmount}
                                                onChange={(v) => updateLine(line.id, { amount: v })}
                                                onAutoFill={() => updateLine(line.id, { amount: balancingAmount.toFixed(2) })}
                                            />
                                            {/* Credit cell — active when side === CREDIT */}
                                            <AmountCell
                                                line={line}
                                                isOwnSide={line.side === "CREDIT"}
                                                hasStock={hasStock}
                                                amt={amt}
                                                isBalancing={isBalancing}
                                                balancingAmount={balancingAmount}
                                                onChange={(v) => updateLine(line.id, { amount: v })}
                                                onAutoFill={() => updateLine(line.id, { amount: balancingAmount.toFixed(2) })}
                                            />
                                            <Button
                                                variant="ghost" size="icon-xs"
                                                className="text-destructive/60 hover:text-destructive"
                                                onClick={() => removeLine(line.id)}
                                                disabled={lines.length <= 2}
                                                title="Remove line"
                                            >
                                                <Trash2 size={14} />
                                            </Button>
                                        </div>

                                        {/* Row 1.5: Cur Bal hint under the picked account */}
                                        {acct && (
                                            <div className="grid grid-cols-[60px_minmax(0,1fr)_120px_120px_28px] gap-2 text-[11px] text-muted-foreground">
                                                <span />
                                                <span className="pl-2 italic">
                                                    Cur Bal: <span className="font-mono">{formatBalanceWithSide(acct)}</span>
                                                    {isParty && (
                                                        <span className="ml-2 text-amber-600 dark:text-amber-400" title="Bill-wise allocation not yet wired in this dialog — see TODO">
                                                            · party ledger (bill-wise pending)
                                                        </span>
                                                    )}
                                                </span>
                                                <span />
                                                <span />
                                                <span />
                                            </div>
                                        )}

                                        {/* Inventory items under this ledger — only when ledger is INCOME/EXPENSE */}
                                        {eligible && line.stockItems.map((item) => (
                                            <div
                                                key={item.id}
                                                className="grid grid-cols-[60px_minmax(0,1fr)_56px_72px_56px_22px] gap-1.5 items-center pl-2"
                                            >
                                                <span className="text-[10px] text-muted-foreground text-right pr-1">item</span>
                                                <InvProductCombobox
                                                    value={item.productId}
                                                    onChange={(p) => handleProductSelect(line, item.id, p)}
                                                    placeholder="Search item…"
                                                />
                                                <Input
                                                    type="number" min="0" step="0.001"
                                                    value={item.qty}
                                                    onChange={(e) => updateStockItem(line.id, item.id, { qty: e.target.value })}
                                                    className={`${cell} text-right tabular-nums`}
                                                    placeholder="qty"
                                                />
                                                <Input
                                                    type="number" min="0" step="0.01"
                                                    value={item.rate}
                                                    onChange={(e) => updateStockItem(line.id, item.id, { rate: e.target.value })}
                                                    className={`${cell} text-right tabular-nums`}
                                                    placeholder="rate"
                                                />
                                                <span className="text-xs tabular-nums text-right text-muted-foreground pr-1">
                                                    {fmt(stockItemAmount(item))}
                                                </span>
                                                <Button
                                                    variant="ghost" size="icon-xs"
                                                    className="text-destructive/40 hover:text-destructive"
                                                    onClick={() => removeStockItem(line.id, item.id)}
                                                >
                                                    <X size={11} />
                                                </Button>
                                            </div>
                                        ))}

                                        {eligible && (
                                            <div className="flex items-center justify-between gap-2 pl-14">
                                                <Button
                                                    variant="ghost" size="sm"
                                                    onClick={() => addStockItem(line.id)}
                                                    className="h-auto py-0.5 text-xs text-muted-foreground hover:text-foreground"
                                                >
                                                    <Package size={11} className="mr-1" />
                                                    + Inventory item
                                                </Button>
                                                {hasStock && (
                                                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                                        {line.side === "DEBIT" ? "@cost default" : "@sale default"}
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            <Button variant="ghost" size="sm" onClick={() => addLine("DEBIT")} className="h-auto py-1 text-xs">
                                <Plus size={12} className="mr-1" /> Add line
                            </Button>
                        </div>

                        {/* Narration — no totals/diff bar (the auto-balance handles it). */}
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


                    <ScrollBar orientation="vertical" />
                </ScrollArea>
                <VoucherDialogFooter
                    saving={saving}
                    onCancel={() => { reset(); setOpen(false); }}
                    onSaveDraft={() => submit(false)}
                    onSavePost={() => submit(true)}
                />
            </DialogContent>
        </Dialog>
    );
}
