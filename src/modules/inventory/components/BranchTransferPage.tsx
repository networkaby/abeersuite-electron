"use client";

// Branch Transfer voucher — moves stock from one branch to another.
//
// Semantics:
//   • Header carries source branch + destination branch (must differ).
//   • Each line: product + qty. No rate / amount — it's the same product,
//     just changing branch.
//   • On post: two InvStockLedger rows per line (qty- at source, qty+ at
//     destination). InvProductBranch updates both sides. The org-wide
//     InvProduct.stock cache is UNCHANGED — units never leave the org.
//
// UX:
//   • POS-style scan / typeahead input at the top.
//   • Each scan adds the product (qty 1) or +1s the existing row.
//   • Optional "Current at source" column shows the per-branch on-hand at
//     the source so the operator knows what's available to move.

import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { extractApiError } from "@/shared/lib/api";
import { Loader2, Trash2, Building2, Plus, Minus } from "lucide-react";
import { useActiveBranchStore } from "@/store/activeBranchStore";
import { Button } from "@/components/ui/button";
import {
    Dialog, DialogContent, DialogDescription,
    DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProductScanInput, type ScannedProduct } from "@/modules/inventory/components/ProductScanInput";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { LifecycleActions, type LifecycleVoucher } from "@/modules/accountancy/components/LifecycleActions";
import { VoucherTopBar } from "@/modules/accountancy/components/VoucherTopBar";
import { VoucherInlineActions } from "@/modules/accountancy/components/VoucherInlineActions";
import { useSession } from "next-auth/react";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { toIsoDate } from "@/shared/hooks/useTallyDate";

type Branch = { id: string; name: string; isActive?: boolean };
type SessionUser = { branchIds?: string[]; permissions?: string[] } | null;

type LineForm = {
    productId:    number;
    sku:          string;
    name:         string;
    unitCode:     string;
    quantity:     string;
};

type ExistingVoucher = {
    id:                  number;
    reference:           string;
    type:                string;
    date:                string;
    description:         string;
    status:              "DRAFT" | "POSTED" | "CANCELLED";
    deletedAt:           string | null;
    cancelledAt:         string | null;
    branchId:            string;
    destinationBranchId: string | null;
    lines: {
        productId:   number;
        quantity:    string | number;
        description: string | null;
        product:     { id: number; sku: string; name: string; unit: { code: string } };
    }[];
};

export function BranchTransferPage() {
    const router = useRouter();
    const sp = useSearchParams();
    const voucherIdParam = sp.get("voucherId");
    const editing = voucherIdParam != null;
    const activeBranchId = useActiveBranchStore((s) => s.activeBranchId);

    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(editing);
    const [voucherRef, setVoucherRef] = useState<string | null>(null);
    const [loadedVoucher, setLoadedVoucher] = useState<LifecycleVoucher | null>(null);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [sourceBranchId, setSourceBranchId] = useState<string | null>(activeBranchId);
    const [destinationBranchId, setDestinationBranchId] = useState<string | null>(null);

    const { data: session } = useSession();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const canCancel     = hasPermissionWithScope(permissions, "inventory:voucher:cancel");
    const canDelete     = hasPermissionWithScope(permissions, "inventory:voucher:delete");
    const canHardDelete = hasPermissionWithScope(permissions, "inventory:voucher:hard-delete");

    const [form, setForm] = useState({
        date:        toIsoDate(new Date()),
        description: "Branch transfer — moving stock between locations.",
        lines:       [] as LineForm[],
    });

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

    // Load branches with the same RBAC filter as the global BranchSwitcher.
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
                setSourceBranchId((prev) => {
                    if (prev && visible.some((b) => b.id === prev)) return prev;
                    return visible[0]?.id ?? null;
                });
                // Default destination = first branch that isn't the source.
                setDestinationBranchId((prev) => {
                    if (prev && visible.some((b) => b.id === prev)) return prev;
                    return visible.find((b) => b.id !== (activeBranchId ?? visible[0]?.id))?.id ?? null;
                });
            } catch { /* picker stays empty */ }
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
                setLoadedVoucher({ status: v.status, deletedAt: v.deletedAt, cancelledAt: v.cancelledAt });
                if (v.branchId) setSourceBranchId(v.branchId);
                if (v.destinationBranchId) setDestinationBranchId(v.destinationBranchId);
                setForm({
                    date: v.date.slice(0, 10),
                    description: v.description,
                    lines: v.lines.map((l) => ({
                        productId: l.productId,
                        sku:       l.product.sku,
                        name:      l.product.name,
                        unitCode:  l.product.unit?.code ?? "",
                        quantity:  String(Number(l.quantity)),
                    })),
                });
            })
            .catch(() => toast.error("Failed to load voucher"))
            .finally(() => setLoading(false));
    }, [editing, voucherIdParam]);

    // ── Scan-to-add ─────────────────────────────────────────────────────────

    const handleScan = useCallback((p: ScannedProduct) => {
        setForm((f) => {
            const existingIdx = f.lines.findIndex((l) => l.productId === p.id);
            if (existingIdx >= 0) {
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
                        productId: p.id,
                        sku:       p.sku,
                        name:      p.name,
                        unitCode:  p.unit?.code ?? "",
                        quantity:  "1",
                    },
                ],
            };
        });
    }, []);

    const updateQty = (i: number, qty: string) =>
        setForm((f) => ({ ...f, lines: f.lines.map((l, idx) => idx === i ? { ...l, quantity: qty } : l) }));
    const bumpQty = (i: number, delta: number) =>
        setForm((f) => ({ ...f, lines: f.lines.map((l, idx) => {
            if (idx !== i) return l;
            const curr = parseFloat(l.quantity) || 0;
            return { ...l, quantity: String(Math.max(0, curr + delta)) };
        }) }));
    const removeLine = (i: number) =>
        setForm((f) => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }));

    const totalUnits = form.lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0), 0);

    const submit = async (postAfterSave: boolean) => {
        if (!form.description.trim()) { toast.error("Description required"); return; }
        if (!sourceBranchId)       { toast.error("Pick a source branch"); return; }
        if (!destinationBranchId)  { toast.error("Pick a destination branch"); return; }
        if (sourceBranchId === destinationBranchId) {
            toast.error("Source and destination branches must differ");
            return;
        }
        const cleaned = form.lines
            .map((l) => ({ ...l, qty: parseFloat(l.quantity) }))
            .filter((l) => l.productId > 0 && Number.isFinite(l.qty) && l.qty > 0);
        if (cleaned.length === 0) {
            toast.error("Scan or pick at least one product to transfer");
            return;
        }

        setSaving(true);
        try {
            const payload = {
                type:                "BRANCH_TRANSFER" as const,
                branchId:            sourceBranchId,
                destinationBranchId: destinationBranchId,
                date:                form.date,
                description:         form.description.trim(),
                lines: cleaned.map((l) => ({ productId: l.productId, quantity: l.qty })),
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
                toast.success("Branch Transfer posted");
            } else {
                toast.success("Branch Transfer saved as draft");
            }
            if (editing) {
                closeForm();
            } else {
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
        <div className="flex flex-col h-screen overflow-hidden bg-background" onChange={() => { isDirtyRef.current = true; }}>
            {/* Breadcrumb bar */}
            <VoucherTopBar
                title="Branch Transfer"
                onClose={handleClose}
                editingRef={editing && voucherRef ? voucherRef : undefined}
            />
            <div className="flex-1 overflow-y-auto">
            <div className="max-w-5xl mx-auto w-full space-y-5 p-6">

            <div className="rounded-lg border border-border bg-card p-5 shadow space-y-4">
                {/* Source / Destination / Date */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                    <div className="space-y-1.5">
                        <Label className="flex items-center gap-1.5 text-sm">
                            <Building2 size={14} className="text-amber-600" /> Source location
                        </Label>
                        <Select value={sourceBranchId ?? ""} onValueChange={(v) => setSourceBranchId(v)}>
                            <SelectTrigger className="h-9 text-sm">
                                <SelectValue placeholder="Pick source" />
                            </SelectTrigger>
                            <SelectContent>
                                {branches.map((b) => (
                                    <SelectItem key={b.id} value={b.id} className="text-sm" disabled={b.id === destinationBranchId}>
                                        {b.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1.5">
                        <Label className="flex items-center gap-1.5 text-sm">
                            <Building2 size={14} className="text-emerald-600" /> Destination location
                        </Label>
                        <Select value={destinationBranchId ?? ""} onValueChange={(v) => setDestinationBranchId(v)}>
                            <SelectTrigger className="h-9 text-sm">
                                <SelectValue placeholder="Pick destination" />
                            </SelectTrigger>
                            <SelectContent>
                                {branches.map((b) => (
                                    <SelectItem key={b.id} value={b.id} className="text-sm" disabled={b.id === sourceBranchId}>
                                        {b.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1.5">
                        <Label>Date</Label>
                        <TallyDateInput value={form.date} onValueChange={(iso) => setForm((f) => ({ ...f, date: iso }))} />
                    </div>
                </div>

                {/* Scan input */}
                <div className="space-y-2">
                    <Label className="text-sm">Scan or type SKU / barcode / name</Label>
                    <ProductScanInput onScan={handleScan} />
                    <p className="text-[11px] text-muted-foreground">
                        Each scan / Enter adds the product (qty 1) or +1s the existing row. Edit qty inline.
                    </p>
                </div>

                {/* Line table */}
                <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-sm">
                        <thead className="bg-muted text-xs text-muted-foreground border-b border-border">
                            <tr>
                                <th className="px-3 py-2 text-left font-medium">#</th>
                                <th className="px-3 py-2 text-left font-medium">Item</th>
                                <th className="px-3 py-2 text-center font-medium w-44">Qty</th>
                                <th className="px-3 py-2 w-10" />
                            </tr>
                        </thead>
                        <tbody>
                            {form.lines.length === 0 ? (
                                <tr>
                                    <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">
                                        Nothing scanned yet. Place your cursor in the scan input above and start scanning.
                                    </td>
                                </tr>
                            ) : form.lines.map((line, i) => (
                                <tr key={`${line.productId}-${i}`} className="border-t border-border align-middle">
                                    <td className="px-3 py-2 text-xs text-muted-foreground font-mono">{i + 1}</td>
                                    <td className="px-3 py-2">
                                        <div className="font-medium">{line.name}</div>
                                        <div className="text-xs text-muted-foreground font-mono">
                                            {line.sku}{line.unitCode ? ` · ${line.unitCode}` : ""}
                                        </div>
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
                                    <td className="px-3 py-2 text-center">
                                        <Button onClick={() => removeLine(i)} variant="ghost" size="icon-xs" className="text-destructive hover:text-destructive/80">
                                            <Trash2 size={14} />
                                        </Button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        {form.lines.length > 0 && (
                            <tfoot className="border-t border-border bg-muted text-xs font-medium">
                                <tr>
                                    <td colSpan={2} className="px-3 py-2 text-muted-foreground text-right">
                                        {form.lines.length} line{form.lines.length === 1 ? "" : "s"}
                                    </td>
                                    <td className="px-3 py-2 text-center font-mono">{totalUnits} units</td>
                                    <td />
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>

                {/* Narration — actions moved to pinned footer below. */}
                <div className="pt-2 border-t border-border space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Narration</Label>
                    <Textarea
                        rows={2}
                        value={form.description}
                        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                        placeholder="Free-form notes — e.g. carrier reference, packing list #"
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
                            listPath="/office/accountancy/vouchers-registers/branch-transfers"
                            label="Branch Transfer"
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
    );
}
