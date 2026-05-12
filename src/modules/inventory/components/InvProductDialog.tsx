"use client";

// Reusable product-master create / edit dialog.
//
// Owns its own:
//   • form state (`InvProductFormState`)
//   • refs fetch (units / categories / groups / brands / warranty terms)
//   • SKU auto-fill on create
//   • save handler (POST or PATCH, depending on `editId`)
//
// Consumers control open/close + the row being edited, and get a `onSaved`
// callback to refresh their own list. Mount this on any page that wants to
// edit a product master in-place — stock summary, products page, future
// inventory-details page, etc.

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
    InvProductFormFields,
    emptyInvProductForm,
    type InvProductFormState,
} from "@/modules/inventory/components/InvProductFormFields";
import { generateSku } from "@/modules/inventory/lib/sku";

type Opt = { id: number; name?: string; code?: string; label?: string };

// Shape returned by GET /api/inventory/products/[id]. Kept loose here so the
// dialog accepts any subset; the page that triggers it can pass its own type.
export type InvProductRow = {
    id: number;
    sku: string;
    name: string;
    isActive: boolean;
    modelNo: string | null;
    unitId: number;
    categoryId: number | null;
    groupId: number | null;
    brandId: number | null;
    warrantyTermId: number | null;
    barcode1: string | null; barcode2: string | null; barcode3: string | null;
    ean1: string | null; ean2: string | null; ean3: string | null;
    upc1: string | null; upc2: string | null; upc3: string | null;
    notes: string | null;
    costPaise: number | null;
    pricePaise: number | null;
    mrpPaise: number | null;
    openingStock: number | string | null;
    openingRate: number | string | null;
    openingStockDate: string | null;
};

const paiseToRupees = (p: number | null): string =>
    p == null ? "" : (p / 100).toFixed(2);

const rupeesToPaise = (r: string): number | null => {
    const t = r.trim();
    if (t === "") return null;
    const n = parseFloat(t);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n * 100);
};

function optionalId(s: string): number | null {
    if (s === "" || s === "__none__") return null;
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : null;
}

function optionalStr(s: string): string | null {
    const t = s.trim();
    return t === "" ? null : t;
}

function rowToForm(p: InvProductRow): InvProductFormState {
    return {
        sku: p.sku,
        name: p.name,
        unitId: String(p.unitId),
        categoryId: p.categoryId != null ? String(p.categoryId) : "",
        groupId: p.groupId != null ? String(p.groupId) : "",
        brandId: p.brandId != null ? String(p.brandId) : "",
        warrantyTermId: p.warrantyTermId != null ? String(p.warrantyTermId) : "",
        modelNo: p.modelNo ?? "",
        barcode1: p.barcode1 ?? "",
        barcode2: p.barcode2 ?? "",
        barcode3: p.barcode3 ?? "",
        ean1: p.ean1 ?? "",
        ean2: p.ean2 ?? "",
        ean3: p.ean3 ?? "",
        upc1: p.upc1 ?? "",
        upc2: p.upc2 ?? "",
        upc3: p.upc3 ?? "",
        notes: p.notes ?? "",
        isActive: p.isActive,
        costRupees:  paiseToRupees(p.costPaise),
        priceRupees: paiseToRupees(p.pricePaise),
        mrpRupees:   paiseToRupees(p.mrpPaise),
        openingQty:  p.openingStock != null ? String(p.openingStock) : "",
        openingRate: p.openingRate  != null ? String(p.openingRate)  : "",
        openingDate: p.openingStockDate ? p.openingStockDate.slice(0, 10) : "",
    };
}

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** null = create mode, number = edit mode */
    editId: number | null;
    /** Fired after a successful save. Caller refreshes its list. */
    onSaved?: () => void;
}

export function InvProductDialog({ open, onOpenChange, editId, onSaved }: Props) {
    const [form, setForm] = useState<InvProductFormState>(emptyInvProductForm);
    const [units, setUnits] = useState<Opt[]>([]);
    const [categories, setCategories] = useState<Opt[]>([]);
    const [groups, setGroups] = useState<Opt[]>([]);
    const [brands, setBrands] = useState<Opt[]>([]);
    const [warrantyTerms, setWarrantyTerms] = useState<Opt[]>([]);
    const [saving, setSaving] = useState(false);
    const [refsLoaded, setRefsLoaded] = useState(false);

    // Lazy-load reference data once, on first open.
    useEffect(() => {
        if (!open || refsLoaded) return;
        Promise.all([
            axios.get<Opt[]>("/api/inventory/units").then((r) => setUnits(r.data)),
            axios.get<Opt[]>("/api/inventory/categories").then((r) => setCategories(r.data)),
            axios.get<Opt[]>("/api/inventory/product-groups").then((r) => setGroups(r.data)),
            axios.get<Opt[]>("/api/inventory/brands").then((r) => setBrands(r.data)),
            axios.get<Opt[]>("/api/inventory/warranty-terms").then((r) => setWarrantyTerms(r.data)),
        ])
            .then(() => setRefsLoaded(true))
            .catch(() => toast.error("Failed to load reference data"));
    }, [open, refsLoaded]);

    // Initialise form whenever the dialog opens (different mode or same mode
    // with a different editId).
    useEffect(() => {
        if (!open) return;
        if (editId == null) {
            setForm({ ...emptyInvProductForm, sku: generateSku() });
            return;
        }
        axios
            .get<InvProductRow>(`/api/inventory/products/${editId}`)
            .then((r) => setForm(rowToForm(r.data)))
            .catch(() => {
                toast.error("Failed to load product");
                onOpenChange(false);
            });
    }, [open, editId, onOpenChange]);

    const save = useCallback(async () => {
        if (!form.name.trim()) { toast.error("Name is required"); return; }
        const unitId = optionalId(form.unitId);
        if (editId == null) {
            if (!form.sku.trim()) { toast.error("SKU is required"); return; }
            if (unitId == null) { toast.error("Unit is required"); return; }
        } else if (unitId == null) {
            toast.error("Unit is required");
            return;
        }

        const payload = {
            sku: form.sku.trim(),
            name: form.name.trim(),
            unitId: unitId!,
            categoryId: optionalId(form.categoryId),
            groupId: optionalId(form.groupId),
            brandId: optionalId(form.brandId),
            warrantyTermId: optionalId(form.warrantyTermId),
            modelNo: optionalStr(form.modelNo),
            barcode1: optionalStr(form.barcode1),
            barcode2: optionalStr(form.barcode2),
            barcode3: optionalStr(form.barcode3),
            ean1: optionalStr(form.ean1),
            ean2: optionalStr(form.ean2),
            ean3: optionalStr(form.ean3),
            upc1: optionalStr(form.upc1),
            upc2: optionalStr(form.upc2),
            upc3: optionalStr(form.upc3),
            notes: optionalStr(form.notes),
            isActive: form.isActive,
            costPaise:  rupeesToPaise(form.costRupees),
            pricePaise: rupeesToPaise(form.priceRupees),
            mrpPaise:   rupeesToPaise(form.mrpRupees),
            openingStock:     form.openingQty.trim()  === "" ? null : Number(form.openingQty),
            openingRate:      form.openingRate.trim() === "" ? null : Number(form.openingRate),
            openingStockDate: form.openingDate || null,
        };

        setSaving(true);
        try {
            if (editId == null) {
                await axios.post("/api/inventory/products", payload);
                toast.success("Product created");
            } else {
                await axios.patch(`/api/inventory/products/${editId}`, payload);
                toast.success("Product updated");
            }
            onOpenChange(false);
            onSaved?.();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error : "Save failed");
        } finally {
            setSaving(false);
        }
    }, [editId, form, onOpenChange, onSaved]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[90vh] w-[95vw] !max-w-4xl flex-col gap-0 overflow-hidden border-2 border-border p-0">
                <DialogHeader className="border-b px-6 py-4">
                    <DialogTitle>{editId == null ? "New product" : "Edit product"}</DialogTitle>
                </DialogHeader>
                <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 py-4">
                    <InvProductFormFields
                        form={form}
                        setForm={setForm}
                        units={units}
                        categories={categories}
                        groups={groups}
                        brands={brands}
                        warrantyTerms={warrantyTerms}
                        skuDisabled={false}
                    />
                </div>
                <div className="flex justify-end gap-2 border-t bg-muted/30 px-6 py-3">
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button type="button" onClick={save} disabled={saving || !refsLoaded}>
                        {saving ? "Saving…" : "Save"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
