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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { extractApiError } from "@/shared/lib/api";
import { http } from "@/shared/lib/http";
import { BranchRequired } from "@/shared/components/BranchRequired";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Trash2, Plus, Minus } from "lucide-react";
import { useActiveBranchStore } from "@/store/activeBranchStore";
import { Button } from "@/components/ui/button";
import {
    Dialog, DialogContent, DialogDescription,
    DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ProductScanInput, type ScannedProduct } from "@/modules/inventory/components/ProductScanInput";
import { LifecycleActions, type LifecycleVoucher } from "@/modules/accountancy/components/LifecycleActions";
import { VoucherTopBar } from "@/modules/accountancy/components/VoucherTopBar";
import { VoucherInlineActions } from "@/modules/accountancy/components/VoucherInlineActions";
import { printVoucherAfterSave } from "@/shared/lib/print/silentThermalPrint";
import { printAfterSaveDefault, thermalDefault } from "@/shared/lib/print/voucherTemplateDefaults";
import { useSession } from "next-auth/react";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { requiredVoucherPermission } from "@/shared/lib/auth/voucherMatrix";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { toIsoDate } from "@/shared/hooks/useTallyDate";
import { useEscape } from "@/shared/hooks/useEscape";

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
    deletedAt:    string | null;
    cancelledAt:  string | null;
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
    const [printAfterSave, setPrintAfterSave] = useState(() => printAfterSaveDefault("PHYSICAL_STOCK"));
    const [thermal, setThermal] = useState(() => thermalDefault("PHYSICAL_STOCK"));
    const [loading, setLoading] = useState(editing);
    const [voucherRef, setVoucherRef] = useState<string | null>(null);
    const [loadedVoucher, setLoadedVoucher] = useState<LifecycleVoucher | null>(null);

    // Permissions for the inline lifecycle bar — same rules as the row 3-dot menu.
    const { data: session } = useSession();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const holds = (id: string | null) => id != null && hasPermissionWithScope(permissions, id);
    const canCancel     = holds(requiredVoucherPermission("PHYSICAL_STOCK", "cancel"));
    const canDelete     = holds(requiredVoucherPermission("PHYSICAL_STOCK", "delete"));
    const canHardDelete = canDelete;
    // Posting is a separate permission — a create-but-not-post user keeps only Save
    // Draft. Matches the route's userCanPostVoucher(type) check exactly.
    const canPost = holds(requiredVoucherPermission("PHYSICAL_STOCK", "post"));

    // Close / Cancel — smart back-nav (matches TradingVoucherPage):
    //   • Same-tab open → router.back() returns to wherever the operator came from.
    //   • New-tab open (window.open from ButtonBar) → window.close() shuts the tab.
    //   • Manually-typed URL → window.close() silently fails. Acceptable.
    const closeForm = useCallback(() => {
        if (typeof window === "undefined") return;
        if (window.history.length > 1) router.back();
        else window.close();
    }, [router]);
    const isDirtyRef = useRef(false);
    const [closeDialogOpen, setCloseDialogOpen] = useState(false);
    const handleClose = useCallback(() => {
        if (isDirtyRef.current) { setCloseDialogOpen(true); } else { closeForm(); }
    }, [closeForm]);
    // Esc = Back; an open dialog or list takes its own Esc first (see useEscape).
    useEscape(handleClose);
    const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);

    const [form, setForm] = useState({
        date:        toIsoDate(new Date()),
        description: "Physical stock count — counted qty is the opening for this date.",
        lines:       [] as LineForm[],
    });


    // Edit-mode prefill
    useEffect(() => {
        if (!editing) return;
        axios.get<ExistingVoucher>(`/api/inventory/vouchers/${voucherIdParam}`)
            .then((r) => {
                const v = r.data;
                setVoucherRef(v.reference);
                setLoadedVoucher({ status: v.status, deletedAt: v.deletedAt, cancelledAt: v.cancelledAt });
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

    const submit = async (postAfterSave: boolean, print = false) => {
        if (!form.description.trim()) { toast.error("Description required"); return; }
        const branchId = editing ? selectedBranchId : activeBranchId;
        if (!branchId) {
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
                branchId,
                date:        form.date,
                description: form.description.trim(),
                lines: cleaned.map((l) => ({
                    productId: l.productId,
                    quantity:  l.qty,
                })),
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
                toast.success("Physical Stock posted");
            } else {
                toast.success("Physical Stock saved as draft");
            }
            if (print) void printVoucherAfterSave("inv", voucherId, { thermal });
            if (editing) {
                // Edit done — return to wherever the operator came from.
                closeForm();
            } else {
                // Create mode — reset for the next count session (cashier rhythm).
                setForm((f) => ({ ...f, lines: [] }));
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

    return (
        <BranchRequired action="record physical stock">
        <div className="flex flex-col h-screen overflow-hidden bg-background" onChange={() => { isDirtyRef.current = true; }}>
            {/* Breadcrumb bar */}
            <VoucherTopBar
                title="Physical Stock"
                onClose={handleClose}
                editingRef={editing && voucherRef ? voucherRef : undefined}
            />
            <div className="flex-1 overflow-y-auto">
            <div className="max-w-5xl mx-auto w-full space-y-5 p-6">

            <div className="rounded-lg border border-border bg-card p-5 shadow space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                        <Label>Date</Label>
                        <TallyDateInput value={form.date} onValueChange={(iso) => setForm((f) => ({ ...f, date: iso }))} />
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

            </div>
            </div>
            </div>
            <div className="border-t border-border bg-card px-6 py-3 shrink-0">
                <VoucherInlineActions
                    onCancel={handleClose}
                    onSave={() => submit(true, printAfterSave)}
                    onSaveDraft={() => submit(false, printAfterSave)}
                    showSaveDraft
                    showSave={editing || canPost}
                    showPrintToggle
                    printAfterSave={printAfterSave}
                    onPrintAfterSaveChange={setPrintAfterSave}
                    showThermalToggle
                    thermal={thermal}
                    onThermalChange={setThermal}
                    saving={saving}
                    leftContent={editing && loadedVoucher ? (
                        <LifecycleActions
                            voucher={loadedVoucher}
                            apiBasePath={`/api/inventory/vouchers/${voucherIdParam}`}
                            listPath="/office/accountancy/vouchers-registers/physical-stock"
                            label="Physical Stock"
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
