"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Box } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    InvProductFormFields,
    emptyInvProductForm,
    type InvProductFormState,
} from "@/modules/inventory/components/InvProductFormFields";

type Opt = { id: number; name?: string; code?: string; label?: string };

type ProductRow = {
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
    barcode1: string | null;
    barcode2: string | null;
    barcode3: string | null;
    ean1: string | null;
    ean2: string | null;
    ean3: string | null;
    upc1: string | null;
    upc2: string | null;
    upc3: string | null;
    notes: string | null;
    unit: { code: string; label: string };
    category: { name: string } | null;
    brand: { name: string } | null;
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

function rowToForm(p: ProductRow): InvProductFormState {
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
    };
}

export default function InventoryProductsPage() {
    const [rows, setRows] = useState<ProductRow[]>([]);
    const [units, setUnits] = useState<Opt[]>([]);
    const [categories, setCategories] = useState<Opt[]>([]);
    const [groups, setGroups] = useState<Opt[]>([]);
    const [brands, setBrands] = useState<Opt[]>([]);
    const [warrantyTerms, setWarrantyTerms] = useState<Opt[]>([]);
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState(false);
    const [editId, setEditId] = useState<number | null>(null);
    const [form, setForm] = useState<InvProductFormState>(emptyInvProductForm);
    const [saving, setSaving] = useState(false);

    const loadRefs = useCallback(() => {
        return Promise.all([
            axios.get<Opt[]>("/api/inventory/units").then((r) => setUnits(r.data)),
            axios.get<Opt[]>("/api/inventory/categories").then((r) => setCategories(r.data)),
            axios.get<Opt[]>("/api/inventory/product-groups").then((r) => setGroups(r.data)),
            axios.get<Opt[]>("/api/inventory/brands").then((r) => setBrands(r.data)),
            axios.get<Opt[]>("/api/inventory/warranty-terms").then((r) => setWarrantyTerms(r.data)),
        ]);
    }, []);

    const loadProducts = useCallback(() => {
        return axios
            .get<ProductRow[]>("/api/inventory/products")
            .then((r) => setRows(r.data))
            .catch(() => toast.error("Failed to load products"));
    }, []);

    useEffect(() => {
        Promise.all([loadRefs(), loadProducts()]).finally(() => setLoading(false));
    }, [loadRefs, loadProducts]);

    const openNew = () => {
        setEditId(null);
        setForm(emptyInvProductForm);
        setOpen(true);
    };

    const openEdit = async (id: number) => {
        try {
            const { data } = await axios.get<ProductRow>(`/api/inventory/products/${id}`);
            setForm(rowToForm(data));
            setEditId(id);
            setOpen(true);
        } catch {
            toast.error("Failed to load product");
        }
    };

    const save = async () => {
        if (!form.name.trim()) {
            toast.error("Name is required");
            return;
        }
        const unitId = optionalId(form.unitId);
        if (editId == null) {
            if (!form.sku.trim()) {
                toast.error("SKU is required");
                return;
            }
            if (unitId == null) {
                toast.error("Unit is required");
                return;
            }
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
            setOpen(false);
            loadProducts();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error : "Save failed");
        } finally {
            setSaving(false);
        }
    };

    const del = async (id: number) => {
        if (!confirm("Delete this product master?")) return;
        try {
            await axios.delete(`/api/inventory/products/${id}`);
            toast.success("Deleted");
            loadProducts();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error : "Delete failed");
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
                        <Box className="size-5" aria-hidden />
                        Products
                    </h2>
                    <p className="text-muted-foreground text-sm">SKU master — no stock quantities here.</p>
                </div>
                <Button type="button" onClick={openNew}>
                    <Plus className="size-4" />
                    New product
                </Button>
                <Dialog open={open} onOpenChange={setOpen}>
                    <DialogContent className="max-h-[90vh] w-full max-w-2xl overflow-y-auto border-2 border-border">
                        <DialogHeader>
                            <DialogTitle>{editId == null ? "New product" : "Edit product"}</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 pt-2">
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
                            <div className="flex gap-2">
                                <Button type="button" onClick={save} disabled={saving}>
                                    Save
                                </Button>
                                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                                    Cancel
                                </Button>
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>

            <div className="overflow-x-auto border border-border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>SKU</TableHead>
                            <TableHead>Name</TableHead>
                            <TableHead>Unit</TableHead>
                            <TableHead>Category</TableHead>
                            <TableHead>Brand</TableHead>
                            <TableHead className="text-right"> </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell colSpan={6} className="text-muted-foreground">
                                    Loading…
                                </TableCell>
                            </TableRow>
                        ) : rows.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} className="text-muted-foreground">
                                    No products yet. Create a unit first, then add a product.
                                </TableCell>
                            </TableRow>
                        ) : (
                            rows.map((p) => (
                                <TableRow key={p.id}>
                                    <TableCell className="font-mono text-sm">{p.sku}</TableCell>
                                    <TableCell className="font-medium">{p.name}</TableCell>
                                    <TableCell className="text-muted-foreground text-sm">
                                        {p.unit.code}
                                    </TableCell>
                                    <TableCell className="text-sm">{p.category?.name ?? "—"}</TableCell>
                                    <TableCell className="text-sm">{p.brand?.name ?? "—"}</TableCell>
                                    <TableCell className="text-right space-x-2">
                                        {!p.isActive ? <Badge variant="outline">inactive</Badge> : null}
                                        <Button type="button" variant="outline" size="icon-sm" aria-label="Edit" onClick={() => openEdit(p.id)}>
                                            <Pencil className="size-4" />
                                        </Button>
                                        <Button type="button" variant="outline" size="icon-sm" aria-label="Delete" onClick={() => del(p.id)}>
                                            <Trash2 className="size-4" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
