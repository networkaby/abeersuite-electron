"use client";

// Tally-finish full-page Journal Voucher.
// Layout: sequential Dr/Cr line list, two amount columns (Debit | Credit),
// balance indicator + amount-in-words, sticky footer. Stock attachment per
// line under stock-eligible accounts (Sales / Purchase ledgers).
// Create-only.
//
// Backend: POST /api/accountancy/journal-vouchers — writes Voucher +
// JournalEntry + optional MANUFACTURING_JOURNAL InvVoucher in one
// transaction.

import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Plus, Trash2, CheckCircle2, X, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog, DialogContent, DialogDescription,
    DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { fmt } from "@/shared/lib/format/moneyInr";
import { JOURNAL_STATUS_COLORS } from "@/shared/lib/constants/badges";
import { parseAmount, isAmountChars } from "@/utils/numberInput";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { extractApiError } from "@/shared/lib/api";
import { consumeDuplicate } from "@/modules/accountancy/lib/duplicate";
import { GlAccountCombobox } from "@/modules/accountancy/components/GlAccountCombobox";
import { useGlAccounts } from "@/shared/hooks/useGlAccounts";
import { BalanceHint } from "@/modules/accountancy/components/BalanceHint";
import { LifecycleActions } from "@/modules/accountancy/components/LifecycleActions";
import { VoucherTopBar } from "@/modules/accountancy/components/VoucherTopBar";
import { VoucherActionBar } from "@/modules/accountancy/components/VoucherActionBar";
import { printVoucherAfterSave } from "@/shared/lib/print/silentThermalPrint";
import { printAfterSaveDefault, thermalDefault } from "@/shared/lib/print/voucherTemplateDefaults";
import { InvProductCombobox, type SelectedProduct } from "@/modules/inventory/components/InvProductCombobox";
import { isStockEligibleAccount } from "@/modules/accountancy/lib/stockEligibleAccount";
import { numberToIndianWords } from "@/shared/lib/format/numberWords";
import { round2 } from "@/shared/lib/format/moneyInr";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { toIsoDate } from "@/shared/hooks/useTallyDate";

// ── Loaded JE shape (edit mode) ─────────────────────────────────────────────

type LoadedJeLine = {
    accountId:   number;
    type:        "DEBIT" | "CREDIT";
    amount:      number | string;
    description: string | null;
};

type LoadedJe = {
    id:          number;
    reference:   string;
    date:        string;
    description: string | null;
    status:      "DRAFT" | "POSTED" | "CANCELLED";
    cancelledAt: string | null;
    deletedAt:   string | null;
    lines:       LoadedJeLine[];
};

// Normalized line for dirty-check comparison.
type SnapLine = { accountId: number; type: "DEBIT" | "CREDIT"; amount: number; description: string };
type Snapshot = { date: string; narration: string; lines: SnapLine[] };

function normalizeLines(lines: { accountId: number; type: "DEBIT" | "CREDIT"; amount: number; description?: string | null }[]): SnapLine[] {
    return lines
        .map((l) => ({
            accountId:   l.accountId,
            type:        l.type,
            amount:      round2(l.amount),
            description: (l.description ?? "").trim(),
        }))
        .sort((a, b) =>
            a.accountId - b.accountId
            || a.type.localeCompare(b.type)
            || a.amount - b.amount,
        );
}

function snapshotsEqual(a: Snapshot, b: Snapshot): boolean {
    if (a.date !== b.date) return false;
    if (a.narration !== b.narration) return false;
    if (a.lines.length !== b.lines.length) return false;
    for (let i = 0; i < a.lines.length; i++) {
        const x = a.lines[i], y = b.lines[i];
        if (x.accountId !== y.accountId) return false;
        if (x.type !== y.type) return false;
        if (Math.abs(x.amount - y.amount) > 0.005) return false;
        if (x.description !== y.description) return false;
    }
    return true;
}

type Side = "DEBIT" | "CREDIT";

interface GlAccount {
    id:            number;
    name:          string;
    balance:       number;
    normalBalance: "DEBIT" | "CREDIT" | null;
    group:         { id: number; name: string; type: "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE" | null } | null;
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
    side:       Side;
    accountId:  number;
    amount:     string;
    stockItems: StockItem[];
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

const listPath = "/office/accountancy/vouchers-registers/journal-entries";

/** `onClose` — hosted in a dialog (Quick Actions click): every close path calls it instead of navigating. */
export function JournalVoucherPage({ voucherId, onClose }: { voucherId?: number; onClose?: () => void } = {}) {
    const router = useRouter();
    const { data: session } = useSession();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const canCancel     = hasPermissionWithScope(permissions, "finance:voucher:cancel:journal");
    const canDelete     = hasPermissionWithScope(permissions, "finance:voucher:delete:journal");
    const canHardDelete = canDelete;
    // Posting is a separate permission. A create-but-not-post user keeps only Save
    // Draft — the Save (finalise) button is hidden.
    const canPost       = hasPermissionWithScope(permissions, "finance:voucher:post:journal");

    // Close / Cancel / Back — go back if there's tab history, otherwise fall
    // Close / back behaviour:
    //   • Same-tab navigation (e.g. Day Book → form): router.back() returns
    //     to the caller without disturbing any other view.
    //   • New-tab open (ButtonBar uses window.open("…", "_blank")):
    //     history.length === 1, so router.back() is a silent no-op.
    //     window.close() closes the script-opened tab in Chrome/Firefox.
    //   • Manually-typed URL: window.close() silently fails — acceptable.
    const closeForm = () => {
        if (onClose) { onClose(); return; }
        if (typeof window === "undefined") return;
        if (window.history.length > 1) {
            router.back();
        } else {
            window.close();
        }
    };

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
            // Another dialog owns Esc — but not the one this form itself lives in.
            const root = rootRef.current;
            const dialogs = Array.from(document.querySelectorAll('[data-state="open"][role="dialog"]'));
            if (dialogs.some((d) => !root || !d.contains(root))) return;
            if (isDirtyRef.current) { setCloseDialogOpen(true); return; }
            closeForm();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [router, onClose]);
    const rootRef = useRef<HTMLDivElement>(null);
    const isDirtyRef = useRef(false);
    const [closeDialogOpen, setCloseDialogOpen] = useState(false);
    const handleClose = () => {
        if (isDirtyRef.current) { setCloseDialogOpen(true); } else { closeForm(); }
    };

    const isEditing = voucherId != null && Number.isFinite(voucherId);
    const { accounts: sharedAccounts } = useGlAccounts({ onError: () => toast.error("Failed to load accounts") });
    const accounts = sharedAccounts as GlAccount[];
    const [nextRef, setNextRef]   = useState<string>("");
    const [saving, setSaving]     = useState(false);
    const [loading, setLoading]   = useState(isEditing);
    const [loadedJe, setLoadedJe] = useState<LoadedJe | null>(null);
    const [reloadCounter, setReloadCounter] = useState(0);
    const originalSnapshotRef     = useRef<Snapshot | null>(null);

    const [date, setDate]           = useState(() => toIsoDate(new Date()));
    const [narration, setNarration] = useState("");
    const [printAfterSave, setPrintAfterSave] = useState(() => printAfterSaveDefault("JOURNAL"));
    const [thermal, setThermal] = useState(() => thermalDefault("JOURNAL"));
    const [lines, setLines]         = useState<Line[]>([newLine("DEBIT"), newLine("CREDIT")]);

    useEffect(() => {
        if (!isEditing) {
            axios.get<{ reference: string }>(`/api/accountancy/vouchers/next-ref?type=JOURNAL`)
                .then((r) => setNextRef(r.data.reference))
                .catch(() => setNextRef(""));
        }
    }, [isEditing]);

    // ── Duplicate hydration ────────────────────────────────────────────────
    // ⋮ → Duplicate on a JE stashes a payload + navigates here; we consume +
    // clear on mount so a refresh starts blank.  Reference is allocated only
    // when the user explicitly Saves.
    useEffect(() => {
        if (isEditing) return;
        const dup = consumeDuplicate("JOURNAL");
        if (!dup) return;
        setDate(dup.date);
        setNarration(dup.narration ?? "");
        const srcLines = dup.lines as { accountId?: number | null; type?: "DEBIT" | "CREDIT"; amount?: number | string }[];
        if (srcLines.length > 0) {
            setLines(srcLines.map((l) => ({
                id:         ++lineSeq,
                side:       (l.type ?? "DEBIT") as Side,
                accountId:  l.accountId ?? 0,
                amount:     l.amount != null ? String(Number(l.amount)) : "",
                stockItems: [] as StockItem[],
            })));
        }
        toast.success("Duplicated — review and Save to create a new journal entry");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Prefill in edit mode ────────────────────────────────────────────────
    useEffect(() => {
        if (!isEditing || voucherId == null) return;
        let cancelled = false;
        setLoading(true);
        axios.get<LoadedJe>(`/api/accountancy/journal-entries/${voucherId}`)
            .then((r) => {
                if (cancelled) return;
                const v = r.data;
                setLoadedJe(v);
                setDate(v.date.slice(0, 10));
                setNarration(v.description ?? "");

                // Map lines — stock-item reconstruction from descriptions is
                // out of scope (v1); editing a stock-tagged JE strips the
                // inventory links but keeps the GL amounts intact.
                setLines(
                    v.lines.length > 0
                        ? v.lines.map((l) => ({
                            id:         ++lineSeq,
                            side:       l.type,
                            accountId:  l.accountId,
                            amount:     String(Number(l.amount)),
                            stockItems: [],
                        }))
                        : [newLine("DEBIT"), newLine("CREDIT")],
                );

                originalSnapshotRef.current = {
                    date:      v.date.slice(0, 10),
                    narration: (v.description ?? "").trim(),
                    lines:     normalizeLines(v.lines.map((l) => ({
                        accountId:   l.accountId,
                        type:        l.type,
                        amount:      Number(l.amount),
                        description: l.description,
                    }))),
                };
            })
            .catch(() => toast.error("Failed to load journal entry"))
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [isEditing, voucherId, reloadCounter]);

    const accountById = new Map<number, GlAccount>(accounts.map((a) => [a.id, a]));
    const eligibleByAccountId = new Map<number, boolean>(
        accounts.map((a) => [a.id, isStockEligibleAccount(a)]),
    );

    const totalDr  = lines.filter((l) => l.side === "DEBIT").reduce((s, l) => s + lineAmount(l), 0);
    const totalCr  = lines.filter((l) => l.side === "CREDIT").reduce((s, l) => s + lineAmount(l), 0);
    const diff     = totalDr - totalCr;
    const balanced = Math.abs(diff) < 0.005 && totalDr > 0;

    // Tally auto-balance: focusing the LAST empty line on the deficit side
    // snaps in the diff so the user can hit Enter to accept.
    const balancingLineId: number | null = (() => {
        if (Math.abs(diff) < 0.005) return null;
        const targetSide: Side = diff > 0 ? "CREDIT" : "DEBIT";
        for (let i = lines.length - 1; i >= 0; i--) {
            const l = lines[i];
            if (l.side === targetSide && l.amount === "" && l.stockItems.length === 0) return l.id;
        }
        return null;
    })();
    const balancingAmount = Math.abs(diff);

    const updateLine = (id: number, patch: Partial<Line>) =>
        setLines((ls) => ls.map((l) => {
            if (l.id !== id) return l;
            const merged = { ...l, ...patch };
            // Drop inventory items if the new account isn't stock-eligible.
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
    const addLine    = (side: Side = "DEBIT") => setLines((ls) => [...ls, newLine(side)]);
    const removeLine = (id: number) => setLines((ls) => ls.filter((l) => l.id !== id));

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

    const handleProductSelect = (line: Line, itemId: number, p: SelectedProduct | null) => {
        const defaultRate = p ? (line.side === "DEBIT" ? p.costPrice : p.salePrice) : null;
        updateStockItem(line.id, itemId, {
            productId:   p?.id ?? null,
            productName: p?.name ?? "",
            unitCode:    p?.unitCode ?? "",
            rate:        defaultRate != null ? String(defaultRate) : "",
        });
    };

    const openReceipt = (id: number) =>
        void printVoucherAfterSave("je", id, { thermal });

    const submit = async (postAfterSave: boolean, print = false) => {
        if (lines.some((l) => !l.accountId)) { toast.error("Each line needs an account"); return; }
        if (lines.some((l) => lineAmount(l) <= 0)) { toast.error("Each line needs a positive amount"); return; }
        if (!balanced) { toast.error("Debits must equal credits"); return; }
        if (lines.some((l) => l.stockItems.some((s) => !s.productId))) {
            toast.error("Inventory items need a product"); return;
        }
        if (lines.some((l) => l.stockItems.some((s) => (parseFloat(s.qty) || 0) <= 0))) {
            toast.error("Inventory items need a positive qty"); return;
        }

        const payloadLines = lines.map((l) => {
            const desc = l.stockItems.length > 0
                ? l.stockItems
                    .map((s) => `${s.productName} × ${s.qty}${s.unitCode ? " " + s.unitCode : ""} @ ₹${s.rate}`)
                    .join(" | ")
                : undefined;
            const stockItems = l.stockItems.length > 0
                ? l.stockItems.map((s) => ({
                    productId: s.productId!,
                    qty:       parseFloat(s.qty) || 0,
                    rate:      parseFloat(s.rate) || 0,
                }))
                : undefined;
            return {
                accountId:   l.accountId,
                type:        l.side,
                amount:      lineAmount(l),
                description: desc,
                stockItems,
            };
        });

        // ── Edit mode: dirty-check then PATCH the JE ────────────────────────
        if (isEditing && voucherId != null) {
            const current: Snapshot = {
                date,
                narration: narration.trim(),
                lines:     normalizeLines(payloadLines),
            };
            const original = originalSnapshotRef.current;
            if (original && snapshotsEqual(original, current)) {
                toast("No changes to save");
                closeForm();
                return;
            }

            setSaving(true);
            try {
                // JE PATCH endpoint doesn't accept stockItems — strip them.
                const apiLines = payloadLines.map((l) => ({
                    accountId:   l.accountId,
                    type:        l.type,
                    amount:      l.amount,
                    description: l.description,
                }));
                await axios.patch(`/api/accountancy/journal-entries/${voucherId}`, {
                    date,
                    description: narration.trim() || undefined,
                    lines:       apiLines,
                });
                toast.success(`Journal voucher ${loadedJe?.reference ?? ""} updated`);
                if (print) openReceipt(voucherId);
                closeForm();
            } catch (err: unknown) {
                toast.error(extractApiError(err, "Save failed"));
            } finally {
                setSaving(false);
            }
            return;
        }

        // ── Create mode: POST as today ─────────────────────────────────────
        setSaving(true);
        try {
            const res = await axios.post<{ voucherId: number; reference: string; posted: boolean }>(
                "/api/accountancy/journal-vouchers",
                {
                    type:            "JOURNAL",
                    date,
                    narration:       narration.trim() || undefined,
                    postImmediately: postAfterSave,
                    lines:           payloadLines,
                },
            );
            // A draft has no number until it posts — show UV-<id> meanwhile.
            const shownNo = res.data.reference ?? `UV-${res.data.voucherId}`;
            if (postAfterSave) toast.success(`Journal voucher ${shownNo} saved & posted`);
            else               toast.success(`Journal voucher ${shownNo} saved as draft`);
            if (print) openReceipt(res.data.voucherId);
            router.push(listPath);
        } catch (err: unknown) {
            toast.error(extractApiError(err, "Save failed"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div ref={rootRef} className="flex flex-col flex-1 min-h-0 bg-background" onChange={() => { isDirtyRef.current = true; }}>
            {/* Breadcrumb bar */}
            <VoucherTopBar
                title="Journal Voucher"
                onClose={handleClose}
                statusBadge={isEditing && loadedJe
                    ? { label: loadedJe.status, colorClass: JOURNAL_STATUS_COLORS[loadedJe.status] }
                    : undefined}
                rightContent={
                    <div className="flex items-center gap-4 text-xs">
                        <div className="flex items-center gap-2">
                            <label className="text-muted-foreground uppercase tracking-wide">No.</label>
                            <span className="font-mono tabular-nums px-2 py-1 rounded bg-muted/40 border border-border min-w-[140px] text-center">
                                {isEditing
                                    ? (loadedJe?.reference ?? (loading ? "Loading…" : "—"))
                                    : (nextRef || "Generating…")}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <label className="text-muted-foreground uppercase tracking-wide">Date</label>
                            <TallyDateInput
                                value={date}
                                onValueChange={setDate}
                                className="h-8 w-40 text-xs"
                            />
                        </div>
                    </div>
                }
            />

            {/* Body — Tally-classic JV: sequential lines, Dr/Cr column toggle. */}
            <div className="flex-1 overflow-y-auto px-8 py-6">
                <div className="max-w-4xl mx-auto space-y-6">

                    {/* Header row labels */}
                    <div className="grid grid-cols-[60px_minmax(0,1fr)_140px_140px_28px] gap-2 px-2 text-[10px] uppercase tracking-wide text-muted-foreground/70 font-medium">
                        <span>Dr/Cr</span>
                        <span>Particulars</span>
                        <span className="text-right">Debit</span>
                        <span className="text-right">Credit</span>
                        <span />
                    </div>

                    {/* Line list */}
                    <div className="space-y-2">
                        {lines.map((line) => {
                            const amt       = lineAmount(line);
                            const hasStock  = line.stockItems.length > 0;
                            const acct      = line.accountId ? accountById.get(line.accountId) : undefined;
                            const eligible  = line.accountId ? (eligibleByAccountId.get(line.accountId) ?? false) : false;
                            const isBalancing = !hasStock && line.id === balancingLineId && balancingAmount > 0;
                            return (
                                <div key={line.id} className="rounded border border-border/60 bg-muted/10 p-2 space-y-1.5">
                                    <div className="grid grid-cols-[60px_minmax(0,1fr)_140px_140px_28px] gap-2 items-start">
                                        <Select
                                            value={line.side}
                                            onValueChange={(v) => updateLine(line.id, { side: v as Side })}
                                        >
                                            <SelectTrigger className="h-9 text-xs">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="DEBIT">Dr</SelectItem>
                                                <SelectItem value="CREDIT">Cr</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <div>
                                            <GlAccountCombobox
                                                value={line.accountId || null}
                                                onChange={(a) => updateLine(line.id, { accountId: a?.id ?? 0 })}
                                                accounts={accounts}
                                                placeholder="Select account"
                                                // Every ledger incl. parties: the list waits for a character.
                                                minChars={1}
                                            />
                                            <BalanceHint account={acct} />
                                        </div>
                                        {/* Debit column */}
                                        <AmountCell
                                            value={line.amount}
                                            isOwnSide={line.side === "DEBIT"}
                                            hasStock={hasStock}
                                            amt={amt}
                                            isBalancing={isBalancing}
                                            balancingAmount={balancingAmount}
                                            onChange={(v) => updateLine(line.id, { amount: v })}
                                            onAutoFill={() => updateLine(line.id, { amount: balancingAmount.toFixed(2) })}
                                        />
                                        {/* Credit column */}
                                        <AmountCell
                                            value={line.amount}
                                            isOwnSide={line.side === "CREDIT"}
                                            hasStock={hasStock}
                                            amt={amt}
                                            isBalancing={isBalancing}
                                            balancingAmount={balancingAmount}
                                            onChange={(v) => updateLine(line.id, { amount: v })}
                                            onAutoFill={() => updateLine(line.id, { amount: balancingAmount.toFixed(2) })}
                                        />
                                        <div className="pt-1.5 text-center">
                                            <Button
                                                variant="ghost"
                                                size="icon-xs"
                                                onClick={() => removeLine(line.id)}
                                                className="text-destructive/40 hover:text-destructive"
                                                disabled={lines.length <= 2}
                                                title="Delete row"
                                            >
                                                <Trash2 size={13} />
                                            </Button>
                                        </div>
                                    </div>

                                    {/* Stock attachment (only when account is stock-eligible) */}
                                    {eligible && (
                                        <div className="ml-[68px] pl-3 border-l-2 border-border/50 space-y-1.5">
                                            {line.stockItems.map((s) => (
                                                <div key={s.id} className="grid grid-cols-[minmax(0,2fr)_80px_100px_100px_28px] gap-1.5 items-center text-xs">
                                                    <InvProductCombobox
                                                        value={s.productId}
                                                        onChange={(p) => handleProductSelect(line, s.id, p)}
                                                    />
                                                    <Input
                                                        type="text"
                                                        inputMode="decimal"
                                                        value={s.qty}
                                                        onChange={(e) => updateStockItem(line.id, s.id, { qty: e.target.value })}
                                                        placeholder="Qty"
                                                        className="h-7 text-right tabular-nums"
                                                    />
                                                    <Input
                                                        type="text"
                                                        inputMode="decimal"
                                                        value={s.rate}
                                                        onChange={(e) => updateStockItem(line.id, s.id, { rate: e.target.value })}
                                                        placeholder="Rate"
                                                        className="h-7 text-right tabular-nums"
                                                    />
                                                    <span className="text-right font-mono tabular-nums">
                                                        {stockItemAmount(s) > 0 ? fmt(stockItemAmount(s)) : "—"}
                                                    </span>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon-xs"
                                                        onClick={() => removeStockItem(line.id, s.id)}
                                                        className="text-destructive/40 hover:text-destructive"
                                                    >
                                                        <X size={11} />
                                                    </Button>
                                                </div>
                                            ))}
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => addStockItem(line.id)}
                                                className="h-auto py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                                            >
                                                <Package size={11} className="mr-1" /> Attach inventory item
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* Add line buttons */}
                    <div className="flex gap-2 px-1">
                        <Button variant="ghost" size="sm" onClick={() => addLine("DEBIT")} className="h-auto py-1 text-xs text-primary">
                            <Plus size={12} className="mr-1" /> Add Dr line
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => addLine("CREDIT")} className="h-auto py-1 text-xs text-primary">
                            <Plus size={12} className="mr-1" /> Add Cr line
                        </Button>
                    </div>

                    {/* Totals strip */}
                    <div className="rounded-md border border-border bg-muted/30 px-4 py-3">
                        <div className="flex items-center justify-end gap-6 text-sm">
                            <span className="text-muted-foreground">Dr</span>
                            <span className="font-mono tabular-nums">₹ {fmt(totalDr)}</span>
                            <span className="text-muted-foreground">·</span>
                            <span className="text-muted-foreground">Cr</span>
                            <span className="font-mono tabular-nums">₹ {fmt(totalCr)}</span>
                            <span className="text-muted-foreground">·</span>
                            {balanced ? (
                                <span className="flex items-center gap-1 text-green-600 font-medium">
                                    <CheckCircle2 size={14} /> Balanced
                                </span>
                            ) : (
                                <span className="flex items-center gap-1 text-amber-600">
                                    <X size={14} /> Diff ₹ {fmt(Math.abs(diff))}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Narration + amount-in-words */}
                    <div className="space-y-1">
                        <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Narration</label>
                        <Input
                            value={narration}
                            onChange={(e) => setNarration(e.target.value)}
                            placeholder="e.g. Recording prepaid rent + insurance"
                            className="h-9"
                        />
                        {totalDr > 0 && (
                            <p className="text-[11px] text-muted-foreground italic pt-1">
                                Amount: <span className="not-italic">{numberToIndianWords(totalDr)}</span>
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {/* Sticky action bar */}
            <VoucherActionBar
                onCancel={closeForm}
                onSave={() => submit(true, printAfterSave)}
                saveLabel={isEditing ? "Save Changes" : "Save"}
                saveDisabled={saving || !balanced || loading || (isEditing && (loadedJe?.status === "CANCELLED" || !!loadedJe?.deletedAt))}
                onSaveDraft={() => submit(false, printAfterSave)}
                showSaveDraft={!isEditing}
                showPrintToggle
                printAfterSave={printAfterSave}
                onPrintAfterSaveChange={setPrintAfterSave}
                showThermalToggle
                thermal={thermal}
                onThermalChange={setThermal}
                showSave={isEditing || canPost}
                saveDraftDisabled={saving || !balanced}
                saving={saving}
                leftContent={isEditing && loadedJe ? (
                    <div className="mr-auto flex items-center gap-3">
                        <LifecycleActions
                            voucher={loadedJe}
                            apiBasePath={`/api/accountancy/journal-entries/${voucherId}`}
                            listPath={listPath}
                            label="Journal Voucher"
                            canCancel={canCancel}
                            canDelete={canDelete}
                            canHardDelete={canHardDelete}
                            onChanged={() => setReloadCounter((c) => c + 1)}
                        />
                        {loadedJe.status === "POSTED" && !loadedJe.deletedAt && !loadedJe.cancelledAt && (
                            <span className="text-[11px] text-amber-600 italic">
                                Will reverse + re-post on save (reference preserved)
                            </span>
                        )}
                    </div>
                ) : undefined}
            />
            <Dialog open={closeDialogOpen} onOpenChange={setCloseDialogOpen}>
                <DialogContent showCloseButton={false}>
                    <DialogHeader>
                        <DialogTitle>Unsaved changes</DialogTitle>
                        <DialogDescription>You have unsaved changes that will be lost if you leave now.</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCloseDialogOpen(false)}>Stay</Button>
                        <Button variant="outline" onClick={async () => { setCloseDialogOpen(false); isDirtyRef.current = false; await submit(false); }}>Save Draft</Button>
                        <Button variant="destructive" onClick={() => { isDirtyRef.current = false; setCloseDialogOpen(false); closeForm(); }}>Discard &amp; Close</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

// Tally-style amount cell: active on its own side, dim "—" on the other.
function AmountCell({
    value, isOwnSide, hasStock, amt, isBalancing, balancingAmount, onChange, onAutoFill,
}: {
    value:           string;
    isOwnSide:       boolean;
    hasStock:        boolean;
    amt:             number;
    isBalancing:     boolean;
    balancingAmount: number;
    onChange:        (v: string) => void;
    onAutoFill:      () => void;
}) {
    if (!isOwnSide) {
        return (
            <Input
                value="—"
                readOnly
                tabIndex={-1}
                className="h-9 text-right tabular-nums text-muted-foreground/65 bg-muted/30 cursor-default"
            />
        );
    }
    if (hasStock) {
        return (
            <Input
                value={amt > 0 ? fmt(amt) : ""}
                readOnly
                className="h-9 text-right tabular-nums bg-muted/40 font-mono"
                title="Σ inventory items"
            />
        );
    }
    return (
        <Input
            type="text"
            inputMode="decimal"
            value={value}
            onChange={(e) => {
                if (isAmountChars(e.target.value)) onChange(e.target.value);
            }}
            onFocus={() => {
                if (isBalancing && value === "") onAutoFill();
            }}
            className="h-9 text-right tabular-nums font-mono"
            placeholder={isBalancing ? `${fmt(balancingAmount)} ←` : "0.00"}
        />
    );
}
