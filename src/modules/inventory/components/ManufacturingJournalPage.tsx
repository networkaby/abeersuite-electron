"use client";

// Manufacturing Journal — POS-style scan-to-add voucher form.
//
// Sections:
//   1. Header — date, BOM picker + target output qty (when BOM picked),
//      narration, payment account picker (for Charges).
//   2. Scan input + section target toggle ("Scan into: Consume | Produce")
//      — each scan adds or +1s the row in the chosen section.
//   3. Consumption table — raw materials OUT.
//   4. Production table — finished goods IN.
//   5. Charges (GL) table — labour, electricity, etc. Each row debits an
//      EXPENSE Account; total credits paymentAccountId at post time.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { extractApiError } from "@/shared/lib/api";
import { http } from "@/shared/lib/http";
import { BranchRequired } from "@/shared/components/BranchRequired";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Trash2, Workflow, Plus, Minus } from "lucide-react";
import { useActiveBranchStore } from "@/store/activeBranchStore";
import { Button } from "@/components/ui/button";
import {
    Dialog, DialogContent, DialogDescription,
    DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fmt } from "@/utils/constants";
import { ProductScanInput, type ScannedProduct } from "@/modules/inventory/components/ProductScanInput";
import { BomPicker, type BomPickerPayload } from "@/modules/inventory/components/BomPicker";
import { GlAccountCombobox, type GlAccount } from "@/modules/accountancy/components/GlAccountCombobox";
import { scaleBomLines } from "@/modules/inventory/lib/bom";
import { LifecycleActions, type LifecycleVoucher } from "@/modules/accountancy/components/LifecycleActions";
import { VoucherTopBar } from "@/modules/accountancy/components/VoucherTopBar";
import { VoucherInlineActions } from "@/modules/accountancy/components/VoucherInlineActions";
import { useSession } from "next-auth/react";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { toIsoDate } from "@/shared/hooks/useTallyDate";

type LineForm = {
    productId: number;
    sku:       string;
    name:      string;
    unitCode:  string;
    quantity:  string;
    /** Per-unit rate in rupees — seeded from product.lastPurchasePaise on scan/pick
     *  so consumption + production carry the product's cost basis. The
     *  operator can override to model variance (e.g. a custom production
     *  cost). Amount = qty × rate. */
    rate:      string;
};
type ExpenseForm = { accountId: number; description: string; amount: string };

type ExistingVoucher = {
    id:               number;
    reference:        string;
    type:             string;
    date:             string;
    description:      string;
    status:           "DRAFT" | "POSTED" | "CANCELLED";
    deletedAt:        string | null;
    cancelledAt:      string | null;
    branchId:         string;
    paymentAccountId: number | null;
    bomId:            number | null;
    lines: {
        productId:   number;
        direction:   "CONSUME" | "PRODUCE" | null;
        quantity:    string | number;
        rate:        string | number;
        description: string | null;
        product:     { id: number; sku: string; name: string; unit: { code: string } };
    }[];
    charges: {
        accountId:   number;
        amount:      string | number;
        description: string | null;
    }[];
};

const cell = "w-full rounded border border-input bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function ManufacturingJournalPage() {
    const router = useRouter();
    const sp = useSearchParams();
    const voucherIdParam = sp.get("voucherId");
    const editing = voucherIdParam != null;
    const activeBranchId = useActiveBranchStore((s) => s.activeBranchId);

    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(editing);
    const [voucherRef, setVoucherRef] = useState<string | null>(null);
    const [loadedVoucher, setLoadedVoucher] = useState<LifecycleVoucher | null>(null);
    const [accounts, setAccounts] = useState<GlAccount[]>([]);

    const { data: session } = useSession();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const canCancel     = hasPermissionWithScope(permissions, "inventory:voucher:cancel");
    const canDelete     = hasPermissionWithScope(permissions, "inventory:voucher:delete");
    const canHardDelete = hasPermissionWithScope(permissions, "inventory:voucher:hard-delete");

    // Close / Cancel — smart back-nav (matches TradingVoucherPage).
    const closeForm = useCallback(() => {
        if (typeof window === "undefined") return;
        if (window.history.length > 1) router.back();
        else window.close();
    }, [router]);
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
            if (document.querySelector('[data-state="open"][role="dialog"]')) return;
            if (isDirtyRef.current) { setCloseDialogOpen(true); } else { closeForm(); }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [closeForm]);
    const isDirtyRef = useRef(false);
    const [closeDialogOpen, setCloseDialogOpen] = useState(false);
    const handleClose = useCallback(() => {
        if (isDirtyRef.current) { setCloseDialogOpen(true); } else { closeForm(); }
    }, [closeForm]);
    const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);

    const [form, setForm] = useState({
        date:               toIsoDate(new Date()),
        description:        "Manufacturing run — consume raw materials, produce finished goods.",
        bomId:              null as number | null,
        bomOutputProductId: null as number | null,
        bomOutputQtyRef:    0,
        targetOutputQty:    "1",
        paymentAccountId:   null as number | null,
        consume:            [] as LineForm[],
        produce:            [] as LineForm[],
        charges:            [] as ExpenseForm[],
    });

    // Preload chart of accounts so the GlAccountCombobox is instant.
    useEffect(() => {
        axios.get<GlAccount[]>("/api/accountancy/gl-accounts")
            .then((r) => setAccounts(r.data))
            .catch(() => setAccounts([]));
    }, []);


    // Edit-mode prefill
    useEffect(() => {
        if (!editing) return;
        axios.get<ExistingVoucher>(`/api/inventory/vouchers/${voucherIdParam}`)
            .then((r) => {
                const v = r.data;
                setVoucherRef(v.reference);
                setLoadedVoucher({ status: v.status, deletedAt: v.deletedAt, cancelledAt: v.cancelledAt });
                if (v.branchId) setSelectedBranchId(v.branchId);
                const toForm = (l: ExistingVoucher["lines"][number]): LineForm => ({
                    productId: l.productId,
                    sku:       l.product.sku,
                    name:      l.product.name,
                    unitCode:  l.product.unit?.code ?? "",
                    quantity:  String(Number(l.quantity)),
                    rate:      String(Number(l.rate)),
                });
                const consume = v.lines.filter((l) => l.direction === "CONSUME").map(toForm);
                const produce = v.lines.filter((l) => l.direction === "PRODUCE").map(toForm);
                setForm((f) => ({
                    ...f,
                    date:             v.date.slice(0, 10),
                    description:      v.description,
                    bomId:            v.bomId,
                    paymentAccountId: v.paymentAccountId,
                    consume,
                    produce,
                    charges:          v.charges.map((e) => ({
                        accountId:   e.accountId,
                        amount:      String(Number(e.amount)),
                        description: e.description ?? "",
                    })),
                }));
            })
            .catch(() => toast.error("Failed to load voucher"))
            .finally(() => setLoading(false));
    }, [editing, voucherIdParam]);

    // ── Scan-to-add (routes into consume or produce per scanTarget) ─────────

    const handleScan = useCallback((target: "CONSUME" | "PRODUCE", p: ScannedProduct) => {
        setForm((f) => {
            const sectionKey = target === "CONSUME" ? "consume" : "produce";
            const rows = f[sectionKey];
            const existingIdx = rows.findIndex((l) => l.productId === p.id);
            if (existingIdx >= 0) {
                const next = [...rows];
                const curr = parseFloat(next[existingIdx]!.quantity) || 0;
                next[existingIdx] = { ...next[existingIdx]!, quantity: String(curr + 1) };
                return { ...f, [sectionKey]: next };
            }
            const defaultRate = p.lastPurchasePaise != null ? p.lastPurchasePaise / 100 : 0;
            return {
                ...f,
                [sectionKey]: [
                    ...rows,
                    {
                        productId: p.id,
                        sku:       p.sku,
                        name:      p.name,
                        unitCode:  p.unit?.code ?? "",
                        quantity:  "1",
                        rate:      String(defaultRate),
                    },
                ],
            };
        });
    }, []);

    // ── Row mutations ───────────────────────────────────────────────────────

    const sectionPatch = (which: "consume" | "produce", patcher: (rows: LineForm[]) => LineForm[]) =>
        setForm((f) => ({ ...f, [which]: patcher(f[which]) }));

    const updateQty = (which: "consume" | "produce", i: number, qty: string) =>
        sectionPatch(which, (rows) => rows.map((l, idx) => idx === i ? { ...l, quantity: qty } : l));
    const updateRate = (which: "consume" | "produce", i: number, rate: string) =>
        sectionPatch(which, (rows) => rows.map((l, idx) => idx === i ? { ...l, rate } : l));
    const bumpQty = (which: "consume" | "produce", i: number, delta: number) =>
        sectionPatch(which, (rows) => rows.map((l, idx) => {
            if (idx !== i) return l;
            const curr = parseFloat(l.quantity) || 0;
            return { ...l, quantity: String(Math.max(0, curr + delta)) };
        }));
    const removeLine = (which: "consume" | "produce", i: number) =>
        sectionPatch(which, (rows) => rows.filter((_, idx) => idx !== i));

    // ── Charges ─────────────────────────────────────────────────────────────

    const updateCharge = (i: number, patch: Partial<ExpenseForm>) =>
        setForm((f) => ({ ...f, charges: f.charges.map((l, idx) => idx === i ? { ...l, ...patch } : l) }));
    const addCharge    = () => setForm((f) => ({ ...f, charges: [...f.charges, { accountId: 0, amount: "0", description: "" }] }));
    const removeCharge = (i: number) => setForm((f) => ({ ...f, charges: f.charges.filter((_, idx) => idx !== i) }));

    // ── BOM picker ──────────────────────────────────────────────────────────

    const applyBom = (bom: BomPickerPayload) => {
        const target = Number(bom.outputQty);
        const scaled = scaleBomLines(
            bom.lines.map((l) => ({ productId: l.productId, qty: Number(l.qty) })),
            Number(bom.outputQty),
            target,
        );
        // Fetch product names for the scaled consumption lines + output product.
        const ids = Array.from(new Set([
            ...scaled.map((s) => s.productId),
            bom.outputProductId,
        ]));
        Promise.all(ids.map((id) =>
            axios.get<{ id: number; sku: string; name: string; lastPurchasePaise?: number | null; unit?: { code: string } }>(`/api/inventory/products/${id}`)
                .then((r) => r.data)
                .catch(() => null),
        )).then((results) => {
            const byId = new Map<number, { sku: string; name: string; unitCode: string; rate: number }>();
            for (const p of results) {
                if (p) byId.set(p.id, {
                    sku:      p.sku,
                    name:     p.name,
                    unitCode: p.unit?.code ?? "",
                    rate:     p.lastPurchasePaise != null ? p.lastPurchasePaise / 100 : 0,
                });
            }
            setForm((f) => ({
                ...f,
                bomId:              bom.id,
                bomOutputProductId: bom.outputProductId,
                bomOutputQtyRef:    Number(bom.outputQty),
                targetOutputQty:    String(target),
                consume: scaled.map((s) => {
                    const meta = byId.get(s.productId);
                    return {
                        productId: s.productId,
                        sku:       meta?.sku ?? "",
                        name:      meta?.name ?? `Product #${s.productId}`,
                        unitCode:  meta?.unitCode ?? "",
                        quantity:  String(s.qty),
                        rate:      String(meta?.rate ?? 0),
                    };
                }),
                produce: (() => {
                    const meta = byId.get(bom.outputProductId);
                    return [{
                        productId: bom.outputProductId,
                        sku:       meta?.sku ?? "",
                        name:      meta?.name ?? `Product #${bom.outputProductId}`,
                        unitCode:  meta?.unitCode ?? "",
                        quantity:  String(target),
                        rate:      String(meta?.rate ?? 0),
                    }];
                })(),
            }));
        });
    };

    const clearBom = () => {
        setForm((f) => ({ ...f, bomId: null, bomOutputProductId: null, bomOutputQtyRef: 0, targetOutputQty: "1" }));
    };

    const rescaleToTarget = (newTarget: string) => {
        setForm((f) => {
            if (!f.bomId || !(f.bomOutputQtyRef > 0)) {
                return { ...f, targetOutputQty: newTarget };
            }
            const oldTarget = parseFloat(f.targetOutputQty) || f.bomOutputQtyRef;
            const target    = parseFloat(newTarget);
            if (!Number.isFinite(target) || target <= 0 || !(oldTarget > 0)) {
                return { ...f, targetOutputQty: newTarget };
            }
            const factor = target / oldTarget;
            return {
                ...f,
                targetOutputQty: newTarget,
                produce: f.produce.map((p, i) =>
                    i === 0 && f.bomOutputProductId && p.productId === f.bomOutputProductId
                        ? { ...p, quantity: String(Number(target.toFixed(3))) }
                        : p,
                ),
                consume: f.consume.map((c) => ({
                    ...c,
                    quantity: String(Number(((parseFloat(c.quantity) || 0) * factor).toFixed(3))),
                })),
            };
        });
    };

    // ── Totals (qty × rate per line; produce − consume − charges = P/L) ─────

    const consumeTotal = useMemo(
        () => form.consume.reduce((s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.rate) || 0), 0),
        [form.consume],
    );
    const produceTotal = useMemo(
        () => form.produce.reduce((s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.rate) || 0), 0),
        [form.produce],
    );
    const chargesTotal = useMemo(
        () => form.charges.reduce((s, c) => s + (parseFloat(c.amount) || 0), 0),
        [form.charges],
    );
    const pnl = produceTotal - consumeTotal - chargesTotal;

    // ── Submit ──────────────────────────────────────────────────────────────

    const submit = async (postAfterSave: boolean) => {
        if (!form.description.trim()) { toast.error("Description required"); return; }

        const lines: { productId: number; quantity: number; rate: number; direction: "CONSUME" | "PRODUCE" }[] = [];
        for (const l of form.consume) {
            const qty = parseFloat(l.quantity);
            const rate = parseFloat(l.rate) || 0;
            if (l.productId > 0 && qty > 0) lines.push({ productId: l.productId, quantity: qty, rate, direction: "CONSUME" });
        }
        for (const l of form.produce) {
            const qty = parseFloat(l.quantity);
            const rate = parseFloat(l.rate) || 0;
            if (l.productId > 0 && qty > 0) lines.push({ productId: l.productId, quantity: qty, rate, direction: "PRODUCE" });
        }

        const charges = form.charges
            .map((c) => ({ accountId: c.accountId, amount: parseFloat(c.amount), description: c.description || undefined }))
            .filter((c) => c.accountId > 0 && Number.isFinite(c.amount) && c.amount > 0);

        if (lines.length === 0 && charges.length === 0) {
            toast.error("Add at least one consumption / production line OR a charges line");
            return;
        }
        if (charges.length > 0 && !form.paymentAccountId) {
            toast.error("Choose a payment account (Cash / Bank) when adding Charges");
            return;
        }

        const branchId = editing ? selectedBranchId : activeBranchId;
        setSaving(true);
        // Payment account becomes a single tender row (Layer 7g — replaces
        // the legacy `paymentAccountId` column). Total = sum of charge
        // amounts; this is what gets credited to the payment ledger.
        const totalCharges = charges.reduce((s, c) => s + c.amount, 0);
        try {
            const payload = {
                type:             "MANUFACTURING_JOURNAL" as const,
                branchId:         branchId ?? undefined,
                date:             form.date,
                description:      form.description.trim(),
                bomId:            form.bomId ?? undefined,
                lines,
                charges,
                tenders: form.paymentAccountId && totalCharges > 0
                    ? [{ accountId: form.paymentAccountId, amount: totalCharges }]
                    : [],
            };
            let voucherId: number;
            if (editing) {
                await http.patch(`/api/inventory/vouchers/${voucherIdParam}`, payload);
                voucherId = Number(voucherIdParam);
            } else {
                const created = await http.post<{ id: number }>("/api/inventory/vouchers", payload);
                voucherId = created.data.id;
            }
            if (postAfterSave) {
                await http.post(`/api/inventory/vouchers/${voucherId}/post`);
                toast.success("Manufacturing Journal posted");
            } else {
                toast.success("Manufacturing Journal saved as draft");
            }
            if (editing) {
                closeForm();
            } else {
                // Reset for the next run; keep date / BOM template — operator may
                // be running the same recipe again with fresh material counts.
                setForm((f) => ({ ...f, consume: [], produce: [], charges: [] }));
                isDirtyRef.current = false;
            }
        } catch (err: unknown) {
            toast.error(extractApiError(err, "Failed"));
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center py-20">
                <Loader2 className="animate-spin text-muted-foreground" size={28} />
            </div>
        );
    }

    const expenseAccounts = accounts.filter((a) => a.group?.type === "EXPENSE");
    const paymentAccounts = accounts.filter((a) => a.group?.type === "ASSET" || a.group?.type === "LIABILITY");

    return (
        <BranchRequired action="post this manufacturing journal">
        <div className="flex flex-col h-screen overflow-hidden bg-background" onChange={() => { isDirtyRef.current = true; }}>
            {/* Breadcrumb bar */}
            <VoucherTopBar
                title="Manufacturing Journal"
                onClose={handleClose}
                editingRef={editing && voucherRef ? voucherRef : undefined}
            />
            <div className="flex-1 overflow-y-auto">
            <div className="max-w-7xl mx-auto w-full space-y-5 p-6">

            <div className="rounded-lg border border-border bg-card p-5 shadow space-y-5">
                {/* Header */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                        <Label>Date</Label>
                        <TallyDateInput value={form.date} onValueChange={(iso) => setForm((f) => ({ ...f, date: iso }))} />
                    </div>
                    <div className="md:col-span-2">
                        <BomPicker
                            label="Recipe / BOM (optional)"
                            value={form.bomId}
                            onPick={applyBom}
                            onClear={clearBom}
                        />
                    </div>
                </div>

                {form.bomId && (() => {
                    const target = parseFloat(form.targetOutputQty) || 0;
                    const ref    = form.bomOutputQtyRef || 0;
                    const factor = ref > 0 ? target / ref : 0;
                    const factorLabel = factor > 0 ? `× ${Number(factor.toFixed(3))}` : "—";
                    return (
                        <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 flex items-center gap-4 flex-wrap text-sm">
                            <Workflow size={16} className="text-primary shrink-0" />
                            <div className="flex items-center gap-2">
                                <span className="text-muted-foreground">Output qty:</span>
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    value={form.targetOutputQty}
                                    onChange={(e) => rescaleToTarget(e.target.value)}
                                    className={`${cell} w-24 text-right`}
                                />
                            </div>
                            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-primary text-primary-foreground text-xs font-mono font-semibold">
                                <span>BOM multiple</span>
                                <span>{factorLabel}</span>
                            </div>
                            <span className="text-xs text-muted-foreground">
                                (BOM defines {ref} units per batch; consumption rescales proportionally)
                            </span>
                        </div>
                    );
                })()}

                {/* Tally-style two-column body: Source (Consume) | Destination (Produce).
                    Each side has its own scan/typeahead input — pick the side
                    by where you click, not by a toggle. */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <SectionTable
                        title="Source — Consumption (raw materials OUT)"
                        rows={form.consume}
                        onScan={(p) => handleScan("CONSUME", p)}
                        onBump={(i, d) => bumpQty("consume", i, d)}
                        onQty={(i, q) => updateQty("consume", i, q)}
                        onRate={(i, r) => updateRate("consume", i, r)}
                        onRemove={(i) => removeLine("consume", i)}
                        accent="amber"
                    />
                    <SectionTable
                        title="Destination — Production (finished goods IN)"
                        rows={form.produce}
                        onScan={(p) => handleScan("PRODUCE", p)}
                        onBump={(i, d) => bumpQty("produce", i, d)}
                        onQty={(i, q) => updateQty("produce", i, q)}
                        onRate={(i, r) => updateRate("produce", i, r)}
                        onRemove={(i) => removeLine("produce", i)}
                        accent="emerald"
                    />
                </div>

                {/* P/L summary — Production value − Consumption value − Charges */}
                <div className="rounded-lg border border-border bg-muted/40 p-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div>
                        <div className="text-[11px] text-muted-foreground">Consumption (cost OUT)</div>
                        <div className="font-mono font-semibold">₹ {fmt(consumeTotal)}</div>
                    </div>
                    <div>
                        <div className="text-[11px] text-muted-foreground">Charges (overhead)</div>
                        <div className="font-mono font-semibold">₹ {fmt(chargesTotal)}</div>
                    </div>
                    <div>
                        <div className="text-[11px] text-muted-foreground">Production (cost IN)</div>
                        <div className="font-mono font-semibold">₹ {fmt(produceTotal)}</div>
                    </div>
                    <div>
                        <div className="text-[11px] text-muted-foreground">Probable P / L</div>
                        <div className={`font-mono font-bold ${pnl > 0 ? "text-emerald-600" : pnl < 0 ? "text-rose-600" : "text-muted-foreground"}`}>
                            {pnl > 0 ? "+" : ""}₹ {fmt(pnl)}
                        </div>
                    </div>
                </div>

                {/* Charges */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold">Charges (GL — labour, electricity, etc.)</h3>
                        <Button type="button" variant="link" size="sm" className="h-auto p-0 text-sm" onClick={addCharge}>+ Add line</Button>
                    </div>
                    {form.charges.length > 0 && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>Payment account *</Label>
                                <GlAccountCombobox
                                    value={form.paymentAccountId}
                                    onChange={(acc) => setForm((f) => ({ ...f, paymentAccountId: acc?.id ?? null }))}
                                    accounts={paymentAccounts}
                                    placeholder="Cash / Bank / Sundry Creditors"
                                />
                                <p className="text-[11px] text-muted-foreground">All charges debits credit this account at post time.</p>
                            </div>
                        </div>
                    )}

                    {form.charges.length > 0 && (
                        <div className="overflow-x-auto rounded border border-border">
                            <table className="w-full text-sm">
                                <thead className="bg-muted text-xs text-muted-foreground">
                                    <tr>
                                        <th className="px-3 py-2 text-left font-medium">Expense account</th>
                                        <th className="px-3 py-2 text-left font-medium">Description</th>
                                        <th className="px-3 py-2 text-right font-medium w-32">Amount (₹)</th>
                                        <th className="px-3 py-2 w-8" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {form.charges.map((c, i) => (
                                        <tr key={i} className="border-t border-border align-top">
                                            <td className="px-3 py-2 min-w-[220px]">
                                                <GlAccountCombobox
                                                    value={c.accountId || null}
                                                    onChange={(acc) => updateCharge(i, { accountId: acc?.id ?? 0 })}
                                                    accounts={expenseAccounts}
                                                    placeholder="Labour / Power & Fuel / …"
                                                />
                                            </td>
                                            <td className="px-3 py-2">
                                                <input
                                                    value={c.description}
                                                    onChange={(e) => updateCharge(i, { description: e.target.value })}
                                                    placeholder="Optional"
                                                    className={cell}
                                                />
                                            </td>
                                            <td className="px-3 py-2">
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    value={c.amount}
                                                    onChange={(e) => updateCharge(i, { amount: e.target.value })}
                                                    className={`${cell} text-right`}
                                                />
                                            </td>
                                            <td className="px-3 py-2 text-center">
                                                <Button onClick={() => removeCharge(i)} variant="ghost" size="icon-xs" className="text-destructive hover:text-destructive/80">
                                                    <Trash2 size={14} />
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot className="border-t border-border bg-muted text-xs font-medium">
                                    <tr>
                                        <td colSpan={2} className="px-3 py-2 text-muted-foreground text-right">Total Charges</td>
                                        <td className="px-3 py-2 text-right font-mono">₹ {fmt(chargesTotal)}</td>
                                        <td />
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    )}
                </div>

                {/* Narration — actions moved to pinned footer below. */}
                <div className="pt-2 border-t border-border space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Narration</Label>
                    <Textarea
                        rows={2}
                        value={form.description}
                        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                        placeholder="Free-form notes — e.g. operator on duty, batch reference"
                    />
                </div>
            </div>
            </div>
            </div>
            <div className="border-t border-border bg-card px-6 py-3 shrink-0">
                <VoucherInlineActions
                    onCancel={handleClose}
                    onSave={() => submit(true)}
                    onSaveDraft={() => submit(false)}
                    showSaveDraft
                    saving={saving}
                    leftContent={editing && loadedVoucher ? (
                        <LifecycleActions
                            voucher={loadedVoucher}
                            apiBasePath={`/api/inventory/vouchers/${voucherIdParam}`}
                            listPath="/office/accountancy/vouchers-registers/manufacturing-journals"
                            label="Manufacturing Journal"
                            canCancel={canCancel}
                            canDelete={canDelete}
                            canHardDelete={canHardDelete}
                            onChanged={closeForm}
                        />
                    ) : undefined}
                />
            </div>
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
        </BranchRequired>
    );
}

// ── Shared section table for Consume + Produce ──────────────────────────────

function SectionTable({
    title, rows, onScan, onBump, onQty, onRate, onRemove, accent,
}: {
    title: string;
    rows: LineForm[];
    onScan: (p: ScannedProduct) => void;
    onBump: (i: number, d: number) => void;
    onQty: (i: number, q: string) => void;
    onRate: (i: number, r: string) => void;
    onRemove: (i: number) => void;
    accent: "amber" | "emerald";
}) {
    const valueTotal = rows.reduce((s, r) => s + (parseFloat(r.quantity) || 0) * (parseFloat(r.rate) || 0), 0);
    const qtyTotal = rows.reduce((s, r) => s + (parseFloat(r.quantity) || 0), 0);
    const headerClass = accent === "amber"
        ? "bg-amber-100/60 text-amber-900"
        : "bg-emerald-100/60 text-emerald-900";
    const scanPlaceholder = accent === "amber"
        ? "Scan / type raw material to consume…"
        : "Scan / type finished good to produce…";
    return (
        <div className="space-y-2">
            <div className={`flex items-center justify-between rounded px-3 py-1.5 ${headerClass}`}>
                <h3 className="text-sm font-semibold">{title}</h3>
                <span className="text-xs font-mono">
                    {rows.length} line{rows.length === 1 ? "" : "s"} · {qtyTotal} units · ₹ {fmt(valueTotal)}
                </span>
            </div>
            <ProductScanInput
                placeholder={scanPlaceholder}
                onScan={onScan}
                autoFocus={accent === "amber"}
            />
            <div className="overflow-x-auto rounded border border-border">
                <table className="w-full text-sm">
                    <thead className="bg-muted text-[11px] text-muted-foreground">
                        <tr>
                            <th className="px-2 py-2 text-left font-medium w-8">#</th>
                            <th className="px-2 py-2 text-left font-medium">Item</th>
                            <th className="px-2 py-2 text-center font-medium w-32">Qty</th>
                            <th className="px-2 py-2 text-right font-medium w-24">Rate</th>
                            <th className="px-2 py-2 text-right font-medium w-24">Amount</th>
                            <th className="px-2 py-2 w-8" />
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="px-4 py-6 text-center text-xs text-muted-foreground">
                                    Nothing here yet. Set the scan target above and scan / pick a product to add.
                                </td>
                            </tr>
                        ) : rows.map((line, i) => {
                            const qty  = parseFloat(line.quantity) || 0;
                            const rate = parseFloat(line.rate) || 0;
                            const amt  = qty * rate;
                            return (
                                <tr key={`${line.productId}-${i}`} className="border-t border-border align-middle">
                                    <td className="px-2 py-2 text-[11px] text-muted-foreground font-mono">{i + 1}</td>
                                    <td className="px-2 py-2">
                                        <div className="font-medium leading-tight">{line.name}</div>
                                        <div className="text-[11px] text-muted-foreground font-mono leading-tight">
                                            {line.sku}{line.unitCode ? ` · ${line.unitCode}` : ""}
                                        </div>
                                    </td>
                                    <td className="px-2 py-2">
                                        <div className="flex items-center justify-center gap-0.5">
                                            <Button type="button" variant="outline" size="icon-xs" onClick={() => onBump(i, -1)} aria-label="Minus one">
                                                <Minus size={12} />
                                            </Button>
                                            <input
                                                type="text"
                                                inputMode="decimal"
                                                value={line.quantity}
                                                onChange={(e) => onQty(i, e.target.value)}
                                                className="w-14 rounded border border-input bg-background px-1.5 py-1 text-xs text-right font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                            />
                                            <Button type="button" variant="outline" size="icon-xs" onClick={() => onBump(i, +1)} aria-label="Plus one">
                                                <Plus size={12} />
                                            </Button>
                                        </div>
                                    </td>
                                    <td className="px-2 py-2">
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            value={line.rate}
                                            onChange={(e) => onRate(i, e.target.value)}
                                            className="w-full rounded border border-input bg-background px-1.5 py-1 text-xs text-right font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                            title="Per-unit rate (seeded from cost price)"
                                        />
                                    </td>
                                    <td className="px-2 py-2 text-right font-mono text-xs">{fmt(amt)}</td>
                                    <td className="px-2 py-2 text-center">
                                        <Button onClick={() => onRemove(i)} variant="ghost" size="icon-xs" className="text-destructive hover:text-destructive/80">
                                            <Trash2 size={12} />
                                        </Button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                    {rows.length > 0 && (
                        <tfoot className="border-t border-border bg-muted text-xs font-medium">
                            <tr>
                                <td colSpan={4} className="px-2 py-2 text-right text-muted-foreground">Section total</td>
                                <td className="px-2 py-2 text-right font-mono">₹ {fmt(valueTotal)}</td>
                                <td />
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>
        </div>
    );
}
