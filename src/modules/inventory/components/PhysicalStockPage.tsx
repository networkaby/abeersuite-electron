"use client";

// Physical Stock voucher form — POS-style scan-to-add.
//
// Semantics:
//   • Counted qty is the OPENING quantity for the voucher's date.
//   • Multiple Physical Stock vouchers on the same date COMBINE (sum) per
//     product. The first PS voucher of the date sets the absolute opening
//     (delta against pre-date running); each subsequent PS voucher on the
//     same date ADDS its counted qty on top. Cancelling a voucher reverses
//     just its own contribution.
//   • At post time, the system inserts one InvStockLedger row stamped at
//     start-of-`voucher.date` for each product line.
//
// UX:
//   • Big scan input at the top. Each scan/Enter looks up the code, then
//     either ADDS a new row (qty 1) or INCREMENTS the existing row's qty
//     by 1 if the product is already in the list. Operators can also tap
//     the +1/-1 buttons or edit qty manually.
//   • Each row shows: product label (sku + name), unit, live current
//     cached stock, counted qty (the running tally for this voucher), and
//     variance (counted − current).

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Trash2, Building2, ClipboardCheck, Plus, Minus } from "lucide-react";
import { useActiveBranchStore } from "@/store/activeBranchStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ProductScanInput, type ScannedProduct } from "@/modules/inventory/components/ProductScanInput";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

type Branch = { id: string; name: string; isActive?: boolean };
type SessionUser = { branchIds?: string[]; permissions?: string[] } | null;

type LineForm = {
    productId:    number;
    sku:          string;
    name:         string;
    unitCode:     string;
    quantity:     string;
    currentStock: number | null;
};

type ExistingVoucher = {
    id:           number;
    type:         string;
    reference:    string;
    date:         string;
    description:  string;
    status:       "DRAFT" | "POSTED" | "CANCELLED";
    branchId:     string;
    branch?:      { id: string; name: string };
    lines: {
        productId:   number;
        quantity:    string | number;
        description: string | null;
        product:     { id: number; sku: string; name: string; unit: { code: string } };
    }[];
};

export function PhysicalStockPage() {
    const router = useRouter();
    const sp = useSearchParams();
    const voucherIdParam = sp.get("voucherId");
    const editing = voucherIdParam != null;
    const activeBranchId = useActiveBranchStore((s) => s.activeBranchId);

    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(editing);
    const [voucherRef, setVoucherRef] = useState<string | null>(null);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [selectedBranchId, setSelectedBranchId] = useState<string | null>(activeBranchId);

    const [form, setForm] = useState({
        date:        new Date().toISOString().slice(0, 10),
        description: "Physical stock count — counted qty is the opening for this date.",
        lines:       [] as LineForm[],
    });

    // Load branches the operator has access to (admin → all active; otherwise
    // just their assigned branches). Same RBAC filter as BranchSwitcher.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const sess = await fetch("/api/auth/session").then((r) => r.json()).catch(() => null) as { user?: SessionUser } | null;
            const user = sess?.user;
            if (!user || cancelled) return;
            const perms = user.permissions ?? [];
            const userBranchIds = user.branchIds ?? [];
            const isAdmin = perms.includes(PERMISSIONS.ADMIN_BYPASS);
            try {
                const res = await axios.get<Branch[]>("/api/branches");
                if (cancelled) return;
                const active = res.data.filter((b) => b.isActive !== false);
                const visible = isAdmin ? active : active.filter((b) => userBranchIds.includes(b.id));
                setBranches(visible);
                // Default selection: keep the active branch if it's in the
                // visible list, otherwise fall back to the first allowed.
                setSelectedBranchId((prev) => {
                    if (prev && visible.some((b) => b.id === prev)) return prev;
                    return visible[0]?.id ?? null;
                });
            } catch {
                /* no-op — picker stays empty, submit will fail with a clear message */
            }
        })();
        return () => { cancelled = true; };
    }, [activeBranchId]);

    // Edit-mode prefill
    useEffect(() => {
        if (!editing) return;
        axios.get<ExistingVoucher>(`/api/inventory/vouchers/${voucherIdParam}`)
            .then((r) => {
                const v = r.data;
                setVoucherRef(v.reference);
                if (v.branchId) setSelectedBranchId(v.branchId);
                setForm({
                    date: v.date.slice(0, 10),
                    description: v.description,
                    lines: v.lines.map((l) => ({
                        productId:    l.productId,
                        sku:          l.product.sku,
                        name:         l.product.name,
                        unitCode:     l.product.unit?.code ?? "",
                        quantity:     String(Number(l.quantity)),
                        currentStock: null,
                    })),
                });
            })
            .catch(() => toast.error("Failed to load voucher"))
            .finally(() => setLoading(false));
    }, [editing, voucherIdParam]);

    // Fetch live current stock for lines that don't have it yet (edit mode).
    useEffect(() => {
        const pending = form.lines.filter((l) => l.currentStock == null && l.productId > 0);
        if (pending.length === 0) return;
        for (const l of pending) {
            axios.get<{ stock: number | null }>(`/api/inventory/products/${l.productId}`)
                .then((r) => setForm((f) => ({
                    ...f,
                    lines: f.lines.map((row) => row.productId === l.productId ? { ...row, currentStock: r.data.stock ?? 0 } : row),
                })))
                .catch(() => { /* leave null */ });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [form.lines.length]);

    // ── Scan-to-add ─────────────────────────────────────────────────────────

    const handleScan = useCallback((p: ScannedProduct) => {
        setForm((f) => {
            const existingIdx = f.lines.findIndex((l) => l.productId === p.id);
            if (existingIdx >= 0) {
                // Already in list — increment by 1 (the scan-tick).
                const next = [...f.lines];
                const curr = parseFloat(next[existingIdx]!.quantity) || 0;
                next[existingIdx] = { ...next[existingIdx]!, quantity: String(curr + 1) };
                return { ...f, lines: next };
            }
            return {
                ...f,
                lines: [
                    ...f.lines,
                    {
                        productId:    p.id,
                        sku:          p.sku,
                        name:         p.name,
                        unitCode:     p.unit?.code ?? "",
                        quantity:     "1",
                        currentStock: p.stock ?? 0,
                    },
                ],
            };
        });
    }, []);

    // ── Line mutations ──────────────────────────────────────────────────────

    const updateQty = (i: number, qty: string) =>
        setForm((f) => ({ ...f, lines: f.lines.map((l, idx) => idx === i ? { ...l, quantity: qty } : l) }));
    const bumpQty = (i: number, delta: number) =>
        setForm((f) => ({ ...f, lines: f.lines.map((l, idx) => {
            if (idx !== i) return l;
            const curr = parseFloat(l.quantity) || 0;
            const next = Math.max(0, curr + delta);
            return { ...l, quantity: String(next) };
        }) }));
    const removeLine = (i: number) =>
        setForm((f) => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }));

    // ── Totals ──────────────────────────────────────────────────────────────

    const totalsByLine = useMemo(
        () => form.lines.map((l) => ({
            counted:  parseFloat(l.quantity) || 0,
            variance: (parseFloat(l.quantity) || 0) - (l.currentStock ?? 0),
        })),
        [form.lines],
    );
    const totalUnits = totalsByLine.reduce((s, t) => s + t.counted, 0);

    // ── Submit ──────────────────────────────────────────────────────────────

    const submit = async (postAfterSave: boolean) => {
        if (!form.description.trim()) { toast.error("Description required"); return; }
        if (!selectedBranchId) {
            toast.error("Pick a branch");
            return;
        }
        const cleaned = form.lines
            .map((l) => ({ ...l, qty: parseFloat(l.quantity) }))
            .filter((l) => l.productId > 0 && Number.isFinite(l.qty) && l.qty >= 0);
        if (cleaned.length === 0) {
            toast.error("Scan or pick at least one product");
            return;
        }

        setSaving(true);
        try {
            const payload = {
                type:        "PHYSICAL_STOCK" as const,
                branchId:    selectedBranchId,
                date:        form.date,
                description: form.description.trim(),
                lines: cleaned.map((l) => ({
                    productId: l.productId,
                    quantity:  l.qty,
                })),
            };

            let voucherId: number;
            if (editing) {
                await axios.patch(`/api/inventory/vouchers/${voucherIdParam}`, payload);
                voucherId = Number(voucherIdParam);
            } else {
                const created = await axios.post<{ id: number }>("/api/inventory/vouchers", payload);
                voucherId = created.data.id;
            }
            if (postAfterSave) {
                await axios.post(`/api/inventory/vouchers/${voucherId}/post`);
                toast.success("Physical Stock posted");
            } else {
                toast.success("Physical Stock saved as draft");
            }
            router.push("/vouchers/physical-stock");
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed";
            toast.error(msg ?? "Failed");
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

    return (
        <div className="max-w-5xl mx-auto space-y-5">
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-xl font-bold flex items-center gap-2">
                        <ClipboardCheck className="size-5" />
                        {editing ? `Edit Physical Stock ${voucherRef ? `(${voucherRef})` : ""}` : "New Physical Stock"}
                    </h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Counted qty is the <span className="font-medium">opening for the voucher&apos;s date</span>. Multiple vouchers on the
                        same date <span className="font-medium">combine (sum)</span> — useful for counting in batches across the day.
                    </p>
                </div>
                {branches.length > 1 ? (
                    <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">Branch</Label>
                        <Select value={selectedBranchId ?? ""} onValueChange={(v) => setSelectedBranchId(v)}>
                            <SelectTrigger className="h-8 w-[200px] text-xs">
                                <div className="flex items-center gap-1.5">
                                    <Building2 size={12} className="shrink-0 text-muted-foreground" />
                                    <SelectValue placeholder="Pick a branch" />
                                </div>
                            </SelectTrigger>
                            <SelectContent>
                                {branches.map((b) => (
                                    <SelectItem key={b.id} value={b.id} className="text-xs">{b.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                ) : branches.length === 1 ? (
                    <div className="flex items-center gap-1.5 px-2 py-0.5 text-xs text-muted-foreground border border-border/60 rounded">
                        <Building2 size={12} className="shrink-0" />
                        <span>{branches[0]!.name}</span>
                    </div>
                ) : null}
            </div>

            <div className="rounded-lg border border-border bg-card p-5 shadow space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                        <Label>Date</Label>
                        <Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
                    </div>
                    <div className="md:col-span-2 space-y-1.5">
                        <Label>Description / Narration *</Label>
                        <Textarea
                            value={form.description}
                            rows={1}
                            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                        />
                    </div>
                </div>

                {/* Scan or type — single POS-style input. Barcode scan,
                    SKU type, or name search all land in the same box. */}
                <div className="space-y-2">
                    <Label className="text-sm">Scan or type SKU / barcode / name</Label>
                    <ProductScanInput onScan={handleScan} />
                    <p className="text-[11px] text-muted-foreground">
                        Each scan / Enter adds the product if new, or +1s the existing row. Use +/− to adjust, or edit qty inline.
                    </p>
                </div>

                {/* Counted lines */}
                <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-sm">
                        <thead className="bg-muted text-xs text-muted-foreground border-b border-border">
                            <tr>
                                <th className="px-3 py-2 text-left font-medium">#</th>
                                <th className="px-3 py-2 text-left font-medium">Item</th>
                                <th className="px-3 py-2 text-right font-medium w-24">Current</th>
                                <th className="px-3 py-2 text-center font-medium w-44">Counted</th>
                                <th className="px-3 py-2 text-right font-medium w-24">Variance</th>
                                <th className="px-3 py-2 w-10" />
                            </tr>
                        </thead>
                        <tbody>
                            {form.lines.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                                        Nothing scanned yet. Place your cursor in the scan input above and start scanning, or use the picker.
                                    </td>
                                </tr>
                            ) : form.lines.map((line, i) => {
                                const t = totalsByLine[i]!;
                                return (
                                    <tr key={`${line.productId}-${i}`} className="border-t border-border align-middle">
                                        <td className="px-3 py-2 text-xs text-muted-foreground font-mono">{i + 1}</td>
                                        <td className="px-3 py-2">
                                            <div className="font-medium">{line.name}</div>
                                            <div className="text-xs text-muted-foreground font-mono">
                                                {line.sku}{line.unitCode ? ` · ${line.unitCode}` : ""}
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">
                                            {line.currentStock == null ? "—" : line.currentStock}
                                        </td>
                                        <td className="px-3 py-2">
                                            <div className="flex items-center justify-center gap-1">
                                                <Button type="button" variant="outline" size="icon-xs" onClick={() => bumpQty(i, -1)} aria-label="Minus one">
                                                    <Minus size={14} />
                                                </Button>
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    value={line.quantity}
                                                    onChange={(e) => updateQty(i, e.target.value)}
                                                    className="w-20 rounded border border-input bg-background px-2 py-1 text-sm text-right font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                />
                                                <Button type="button" variant="outline" size="icon-xs" onClick={() => bumpQty(i, +1)} aria-label="Plus one">
                                                    <Plus size={14} />
                                                </Button>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono text-xs">
                                            {line.currentStock == null ? <span className="text-muted-foreground">—</span>
                                                : t.variance === 0 ? <span className="text-muted-foreground">0</span>
                                                : <span className={t.variance > 0 ? "text-emerald-600" : "text-rose-600"}>{t.variance > 0 ? "+" : ""}{t.variance}</span>}
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                            <Button onClick={() => removeLine(i)} variant="ghost" size="icon-xs" className="text-destructive hover:text-destructive/80">
                                                <Trash2 size={14} />
                                            </Button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        {form.lines.length > 0 && (
                            <tfoot className="border-t border-border bg-muted text-xs font-medium">
                                <tr>
                                    <td colSpan={3} className="px-3 py-2 text-muted-foreground text-right">
                                        {form.lines.length} line{form.lines.length === 1 ? "" : "s"}
                                    </td>
                                    <td className="px-3 py-2 text-center font-mono">{totalUnits} units</td>
                                    <td colSpan={2} />
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>

                <div className="flex items-center justify-end gap-2">
                    <Button variant="outline" onClick={() => router.push("/vouchers/physical-stock")}>Cancel</Button>
                    <Button onClick={() => submit(false)} variant="outline" disabled={saving}>
                        {saving && <Loader2 size={14} className="animate-spin" />} Save Draft
                    </Button>
                    <Button onClick={() => submit(true)} disabled={saving} className="bg-green-600 hover:bg-green-700 text-white border-green-600">
                        {saving && <Loader2 size={14} className="animate-spin" />} Save &amp; Post
                    </Button>
                </div>
            </div>
        </div>
    );
}
