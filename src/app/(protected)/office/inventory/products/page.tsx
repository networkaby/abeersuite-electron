"use client";

// Unified products page — read-only browse by default with all classification
// fields visible + search + pagination; flip to "Edit cells" to bulk-edit
// category / brand / group / warranty / unit / model / barcode / name / active
// inline. Pricing, opening stock, GST, naming-config etc. are still edited via
// the per-row dialog (pencil button → InvProductDialog).
//
// Save model (edit mode): per dirty row, parallel PATCH /api/inventory/products/{id}.
// The existing PATCH already accepts every classification field this grid touches —
// no batch endpoint needed.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import {
    Plus, Pencil, Trash2, Box, Search, Save, RotateCcw, Wand2,
    Eye, ListChecks,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { InvProductDialog } from "@/modules/inventory/components/InvProductDialog";

type Opt = { id: number; name?: string; code?: string; label?: string };

type Row = {
    id: number;
    sku: string;
    name: string;
    isActive: boolean;
    stock: number | null;
    lowStockThreshold: number;
    modelNo: string | null;
    barcode1: string | null;
    unitId: number;
    categoryId: number | null;
    groupId: number | null;
    brandId: number | null;
    warrantyTermId: number | null;
    unit: { code: string; label?: string };
    category: { name: string } | null;
    brand: { name: string } | null;
    group?: { name: string } | null;
    warrantyTerm?: { name: string } | null;
};

/// Patch payload — only the fields the editable grid touches.
type Patch = Partial<{
    name: string;
    modelNo: string | null;
    barcode1: string | null;
    isActive: boolean;
    unitId: number;
    categoryId: number | null;
    groupId: number | null;
    brandId: number | null;
    warrantyTermId: number | null;
}>;

type Mode = "view" | "edit";

function optLabel(o: Opt | undefined | null): string {
    if (!o) return "—";
    if (o.name) return o.name;
    const composed = `${o.code ?? ""} ${o.label ?? ""}`.trim();
    return composed || "—";
}

export default function InventoryProductsPage() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const editParam = searchParams.get("edit");

    const [mode, setMode] = useState<Mode>("view");
    const [rows, setRows] = useState<Row[]>([]);
    const [units, setUnits] = useState<Opt[]>([]);
    const [categories, setCategories] = useState<Opt[]>([]);
    const [brands, setBrands] = useState<Opt[]>([]);
    const [groups, setGroups] = useState<Opt[]>([]);
    const [warrantyTerms, setWarrantyTerms] = useState<Opt[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const [search, setSearch] = useState("");
    const [dirty, setDirty] = useState<Map<number, Patch>>(new Map());
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [pageSize, setPageSize] = useState<number>(100);
    const [pageIndex, setPageIndex] = useState<number>(0);

    const [dialogOpen, setDialogOpen] = useState(false);
    const [dialogEditId, setDialogEditId] = useState<number | null>(null);

    const loadProducts = useCallback(() =>
        axios
            .get<Row[]>("/api/inventory/products")
            .then((r) => setRows(r.data))
            .catch(() => toast.error("Failed to load products"))
    , []);

    const loadMasters = useCallback(async () => {
        try {
            const [u, c, b, g, w] = await Promise.all([
                axios.get<Opt[]>("/api/inventory/units"),
                axios.get<Opt[]>("/api/inventory/categories"),
                axios.get<Opt[]>("/api/inventory/brands"),
                axios.get<Opt[]>("/api/inventory/product-groups"),
                axios.get<Opt[]>("/api/inventory/warranty-terms"),
            ]);
            setUnits(u.data);
            setCategories(c.data);
            setBrands(b.data);
            setGroups(g.data);
            setWarrantyTerms(w.data);
        } catch {
            toast.error("Failed to load reference data");
        }
    }, []);

    useEffect(() => {
        Promise.all([loadProducts(), loadMasters()]).finally(() => setLoading(false));
    }, [loadProducts, loadMasters]);

    // Deep-link: /office/inventory/products?edit=<id> auto-opens the dialog.
    const handledEditRef = useRef<number | null>(null);
    useEffect(() => {
        if (!editParam) return;
        const id = Number(editParam);
        if (!Number.isFinite(id)) return;
        if (handledEditRef.current === id) return;
        handledEditRef.current = id;
        setDialogEditId(id);
        setDialogOpen(true);
        const next = new URLSearchParams(searchParams.toString());
        next.delete("edit");
        const qs = next.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname);
    }, [editParam, pathname, router, searchParams]);

    function val<K extends keyof Row>(row: Row, key: K): Row[K] {
        const p = dirty.get(row.id);
        if (p && key in p) {
            return (p as Record<string, unknown>)[key as string] as Row[K];
        }
        return row[key];
    }

    function patch(id: number, change: Patch) {
        setDirty((prev) => {
            const next = new Map(prev);
            const cur = next.get(id) ?? {};
            const merged: Patch = { ...cur, ...change };
            // Drop the entry if every patched key matches the underlying row.
            const row = rows.find((r) => r.id === id);
            if (row) {
                let allMatch = true;
                for (const k of Object.keys(merged) as (keyof Patch)[]) {
                    if ((merged as Record<string, unknown>)[k] !== (row as Record<string, unknown>)[k]) {
                        allMatch = false;
                        break;
                    }
                }
                if (allMatch) {
                    next.delete(id);
                    return next;
                }
            }
            next.set(id, merged);
            return next;
        });
    }

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return rows;
        return rows.filter((r) =>
            r.sku.toLowerCase().includes(q) ||
            r.name.toLowerCase().includes(q) ||
            (r.modelNo ?? "").toLowerCase().includes(q) ||
            (r.barcode1 ?? "").toLowerCase().includes(q),
        );
    }, [rows, search]);

    useEffect(() => { setPageIndex(0); }, [search, pageSize, mode]);

    const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(filtered.length / pageSize));
    const safePage = Math.min(pageIndex, totalPages - 1);
    const pageStart = pageSize === 0 ? 0 : safePage * pageSize;
    const pageRows = pageSize === 0 ? filtered : filtered.slice(pageStart, pageStart + pageSize);

    const allPageSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));

    function toggleAllPage() {
        setSelected((prev) => {
            const next = new Set(prev);
            if (allPageSelected) pageRows.forEach((r) => next.delete(r.id));
            else pageRows.forEach((r) => next.add(r.id));
            return next;
        });
    }
    function toggleRow(id: number) {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }
    function selectAllFiltered() {
        setSelected((prev) => {
            const next = new Set(prev);
            filtered.forEach((r) => next.add(r.id));
            return next;
        });
    }

    function applyToSelected(field: keyof Patch, raw: string) {
        if (selected.size === 0) {
            toast.error("Select at least one row first");
            return;
        }
        const value: number | null = raw === "" ? null : Number(raw);
        if (raw !== "" && !Number.isFinite(value)) return;
        setDirty((prev) => {
            const next = new Map(prev);
            for (const id of selected) {
                const cur = next.get(id) ?? {};
                next.set(id, { ...cur, [field]: value });
            }
            return next;
        });
        toast.success(`Applied to ${selected.size} row${selected.size === 1 ? "" : "s"}`);
    }

    async function save() {
        if (dirty.size === 0) return;
        setSaving(true);
        const entries = [...dirty.entries()];
        let ok = 0;
        let fail = 0;
        await Promise.all(
            entries.map(async ([id, p]) => {
                try {
                    await axios.patch(`/api/inventory/products/${id}`, p);
                    ok++;
                } catch {
                    fail++;
                }
            }),
        );
        setSaving(false);
        if (fail === 0) toast.success(`Saved ${ok} product${ok === 1 ? "" : "s"}`);
        else toast.error(`Saved ${ok}, failed ${fail}`);
        setDirty(new Map());
        await loadProducts();
    }

    function discard() {
        if (dirty.size === 0) return;
        if (!confirm(`Discard ${dirty.size} pending change${dirty.size === 1 ? "" : "s"}?`)) return;
        setDirty(new Map());
    }

    function flipMode(next: Mode) {
        if (next === "view" && dirty.size > 0) {
            if (!confirm(`Switch to view mode and discard ${dirty.size} pending change${dirty.size === 1 ? "" : "s"}?`)) return;
            setDirty(new Map());
        }
        setMode(next);
    }

    async function del(id: number) {
        if (!confirm("Delete this product master?")) return;
        try {
            await axios.delete(`/api/inventory/products/${id}`);
            toast.success("Deleted");
            loadProducts();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error : "Delete failed");
        }
    }

    function openNew() {
        setDialogEditId(null);
        setDialogOpen(true);
    }
    function openEdit(id: number) {
        setDialogEditId(id);
        setDialogOpen(true);
    }

    const isEdit = mode === "edit";

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
                        <Box className="size-5" aria-hidden />
                        Products
                    </h2>
                    <p className="text-muted-foreground text-sm">SKU master — stock updated automatically via Purchase/Sale vouchers.</p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="inline-flex rounded-md border border-input p-0.5">
                        <button
                            type="button"
                            onClick={() => flipMode("view")}
                            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-sm ${!isEdit ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                        >
                            <Eye className="size-4" /> View
                        </button>
                        <button
                            type="button"
                            onClick={() => flipMode("edit")}
                            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-sm ${isEdit ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                        >
                            <ListChecks className="size-4" /> Edit cells
                        </button>
                    </div>
                    <Button type="button" onClick={openNew}>
                        <Plus className="size-4" />
                        New product
                    </Button>
                </div>
            </div>

            <InvProductDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                editId={dialogEditId}
                onSaved={loadProducts}
            />

            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="relative">
                    <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        placeholder="Search SKU, name, model, barcode"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-7 w-80"
                    />
                </div>
                {isEdit ? (
                    <div className="flex items-center gap-2">
                        <Button type="button" variant="outline" onClick={discard} disabled={dirty.size === 0 || saving}>
                            <RotateCcw className="size-4" /> Discard
                        </Button>
                        <Button type="button" onClick={save} disabled={dirty.size === 0 || saving}>
                            <Save className="size-4" /> Save {dirty.size > 0 ? `(${dirty.size})` : ""}
                        </Button>
                    </div>
                ) : null}
            </div>

            {isEdit && selected.size > 0 ? (
                <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                        <Wand2 className="size-4" />
                        <span className="font-medium">Apply to {selected.size} selected</span>
                        <button
                            type="button"
                            className="ml-auto text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                            onClick={() => setSelected(new Set())}
                        >
                            clear selection
                        </button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                        <BulkApply label="Category" options={categories} field="categoryId" onApply={applyToSelected} />
                        <BulkApply label="Brand"    options={brands}     field="brandId"    onApply={applyToSelected} />
                        <BulkApply label="Group"    options={groups}     field="groupId"    onApply={applyToSelected} />
                        <BulkApply label="Warranty" options={warrantyTerms} field="warrantyTermId" onApply={applyToSelected} />
                        <BulkApply label="Unit"     options={units}      field="unitId"     onApply={applyToSelected} clearable={false} />
                    </div>
                </div>
            ) : null}

            <div className="overflow-x-auto border border-border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            {isEdit ? (
                                <TableHead className="w-10">
                                    <Checkbox
                                        checked={allPageSelected}
                                        onCheckedChange={toggleAllPage}
                                        aria-label="Select all on page"
                                    />
                                </TableHead>
                            ) : null}
                            <TableHead className="w-12">#</TableHead>
                            <TableHead>SKU</TableHead>
                            <TableHead>Name</TableHead>
                            <TableHead>Category</TableHead>
                            <TableHead>Brand</TableHead>
                            <TableHead>Group</TableHead>
                            <TableHead>Warranty</TableHead>
                            <TableHead>Unit</TableHead>
                            <TableHead>Model No</TableHead>
                            <TableHead>Barcode</TableHead>
                            <TableHead className="text-right">Stock</TableHead>
                            <TableHead className="text-center">Active</TableHead>
                            {!isEdit ? <TableHead className="text-right"> </TableHead> : null}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell colSpan={isEdit ? 13 : 13} className="text-muted-foreground">Loading…</TableCell>
                            </TableRow>
                        ) : pageRows.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={isEdit ? 13 : 13} className="text-muted-foreground">
                                    {rows.length === 0 ? "No products yet. Create a unit first, then add a product." : "No products match the search."}
                                </TableCell>
                            </TableRow>
                        ) : (
                            pageRows.map((r, i) => {
                                const isDirty = dirty.has(r.id);
                                const isSelected = selected.has(r.id);
                                const isLow = r.stock != null && r.stock <= r.lowStockThreshold;
                                return (
                                    <TableRow
                                        key={r.id}
                                        data-state={isSelected ? "selected" : undefined}
                                        className={isDirty ? "bg-amber-50/50 dark:bg-amber-950/20" : undefined}
                                    >
                                        {isEdit ? (
                                            <TableCell>
                                                <Checkbox
                                                    checked={isSelected}
                                                    onCheckedChange={() => toggleRow(r.id)}
                                                    aria-label="Select row"
                                                />
                                            </TableCell>
                                        ) : null}
                                        <TableCell className="text-muted-foreground text-sm">{pageStart + i + 1}</TableCell>
                                        <TableCell className="font-mono text-sm">{r.sku}</TableCell>

                                        {/* Name */}
                                        <TableCell className={isEdit ? "min-w-48" : "font-medium"}>
                                            {isEdit ? (
                                                <Input
                                                    value={val(r, "name") as string}
                                                    onChange={(e) => patch(r.id, { name: e.target.value })}
                                                    className="h-8"
                                                />
                                            ) : (
                                                r.name
                                            )}
                                        </TableCell>

                                        {/* Category */}
                                        <TableCell className={isEdit ? "min-w-40" : "text-sm"}>
                                            {isEdit ? (
                                                <CellSelect
                                                    value={val(r, "categoryId") as number | null}
                                                    options={categories}
                                                    onChange={(v) => patch(r.id, { categoryId: v })}
                                                />
                                            ) : (
                                                r.category?.name ?? "—"
                                            )}
                                        </TableCell>

                                        {/* Brand */}
                                        <TableCell className={isEdit ? "min-w-40" : "text-sm"}>
                                            {isEdit ? (
                                                <CellSelect
                                                    value={val(r, "brandId") as number | null}
                                                    options={brands}
                                                    onChange={(v) => patch(r.id, { brandId: v })}
                                                />
                                            ) : (
                                                r.brand?.name ?? "—"
                                            )}
                                        </TableCell>

                                        {/* Group */}
                                        <TableCell className={isEdit ? "min-w-40" : "text-sm"}>
                                            {isEdit ? (
                                                <CellSelect
                                                    value={val(r, "groupId") as number | null}
                                                    options={groups}
                                                    onChange={(v) => patch(r.id, { groupId: v })}
                                                />
                                            ) : (
                                                r.group?.name ?? "—"
                                            )}
                                        </TableCell>

                                        {/* Warranty */}
                                        <TableCell className={isEdit ? "min-w-40" : "text-sm"}>
                                            {isEdit ? (
                                                <CellSelect
                                                    value={val(r, "warrantyTermId") as number | null}
                                                    options={warrantyTerms}
                                                    onChange={(v) => patch(r.id, { warrantyTermId: v })}
                                                />
                                            ) : (
                                                r.warrantyTerm?.name ?? "—"
                                            )}
                                        </TableCell>

                                        {/* Unit */}
                                        <TableCell className={isEdit ? "min-w-28" : "text-muted-foreground text-sm"}>
                                            {isEdit ? (
                                                <CellSelect
                                                    value={val(r, "unitId") as number}
                                                    options={units}
                                                    onChange={(v) => v != null && patch(r.id, { unitId: v })}
                                                    clearable={false}
                                                />
                                            ) : (
                                                r.unit.code
                                            )}
                                        </TableCell>

                                        {/* Model No */}
                                        <TableCell className={isEdit ? "min-w-32" : "text-sm"}>
                                            {isEdit ? (
                                                <Input
                                                    value={(val(r, "modelNo") as string | null) ?? ""}
                                                    onChange={(e) => patch(r.id, { modelNo: e.target.value.trim() === "" ? null : e.target.value })}
                                                    className="h-8"
                                                />
                                            ) : (
                                                r.modelNo ?? "—"
                                            )}
                                        </TableCell>

                                        {/* Barcode */}
                                        <TableCell className={isEdit ? "min-w-32 font-mono" : "font-mono text-sm"}>
                                            {isEdit ? (
                                                <Input
                                                    value={(val(r, "barcode1") as string | null) ?? ""}
                                                    onChange={(e) => patch(r.id, { barcode1: e.target.value.trim() === "" ? null : e.target.value })}
                                                    className="h-8 font-mono"
                                                />
                                            ) : (
                                                r.barcode1 ?? "—"
                                            )}
                                        </TableCell>

                                        {/* Stock (read-only in both modes — adjusted via vouchers / opening) */}
                                        <TableCell className="text-right">
                                            {r.stock == null ? (
                                                <span className="text-muted-foreground text-xs">—</span>
                                            ) : (
                                                <span className={`font-mono text-sm font-semibold ${isLow ? "text-destructive" : ""}`}>
                                                    {r.stock}
                                                    {isLow && <Badge variant="destructive" className="ml-1.5 text-xs py-0 px-1">Low</Badge>}
                                                </span>
                                            )}
                                        </TableCell>

                                        {/* Active */}
                                        <TableCell className="text-center">
                                            {isEdit ? (
                                                <Checkbox
                                                    checked={val(r, "isActive") as boolean}
                                                    onCheckedChange={(v) => patch(r.id, { isActive: !!v })}
                                                    aria-label="Active"
                                                />
                                            ) : (
                                                !r.isActive ? <Badge variant="outline">inactive</Badge> : <span className="text-muted-foreground text-xs">✓</span>
                                            )}
                                        </TableCell>

                                        {/* Actions — view mode only (full-field edit + delete) */}
                                        {!isEdit ? (
                                            <TableCell className="text-right space-x-1 whitespace-nowrap">
                                                <Button type="button" variant="outline" size="icon-sm" aria-label="Edit" onClick={() => openEdit(r.id)}>
                                                    <Pencil className="size-4" />
                                                </Button>
                                                <Button type="button" variant="outline" size="icon-sm" aria-label="Delete" onClick={() => del(r.id)}>
                                                    <Trash2 className="size-4" />
                                                </Button>
                                            </TableCell>
                                        ) : null}
                                    </TableRow>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
            </div>

            <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background/95 backdrop-blur px-4 py-2 text-sm">
                <div className="flex items-center gap-3 text-muted-foreground">
                    <span>{filtered.length} match / {rows.length} total</span>
                    {isEdit && dirty.size > 0 ? <Badge variant="secondary">{dirty.size} pending</Badge> : null}
                    {isEdit && selected.size > 0 ? (
                        <>
                            <Badge variant="outline">{selected.size} selected</Badge>
                            <button
                                type="button"
                                className="text-xs underline-offset-2 hover:underline"
                                onClick={() => setSelected(new Set())}
                            >
                                clear
                            </button>
                        </>
                    ) : null}
                    {isEdit && filtered.length > pageRows.length && pageSize !== 0 ? (
                        <button
                            type="button"
                            className="text-xs underline-offset-2 hover:underline"
                            onClick={selectAllFiltered}
                        >
                            select all {filtered.length} filtered
                        </button>
                    ) : null}
                </div>
                <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1 text-xs text-muted-foreground">
                        Page size
                        <select
                            value={pageSize}
                            onChange={(e) => setPageSize(Number(e.target.value))}
                            className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
                        >
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                            <option value={250}>250</option>
                            <option value={0}>All</option>
                        </select>
                    </label>
                    {pageSize !== 0 && totalPages > 1 ? (
                        <div className="flex items-center gap-1">
                            <Button type="button" variant="outline" size="sm" disabled={safePage === 0} onClick={() => setPageIndex(0)}>«</Button>
                            <Button type="button" variant="outline" size="sm" disabled={safePage === 0} onClick={() => setPageIndex(safePage - 1)}>‹</Button>
                            <span className="px-2 text-xs text-muted-foreground">{safePage + 1} / {totalPages}</span>
                            <Button type="button" variant="outline" size="sm" disabled={safePage >= totalPages - 1} onClick={() => setPageIndex(safePage + 1)}>›</Button>
                            <Button type="button" variant="outline" size="sm" disabled={safePage >= totalPages - 1} onClick={() => setPageIndex(totalPages - 1)}>»</Button>
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

/// Native <select> — Radix Select renders a portal per instance, which chokes
/// the renderer when the grid has hundreds of cells. Native select is fast,
/// accessible, and adequate for a dense bulk-edit screen.
function CellSelect({
    value,
    options,
    onChange,
    clearable = true,
}: {
    value: number | null;
    options: Opt[];
    onChange: (v: number | null) => void;
    clearable?: boolean;
}) {
    return (
        <select
            value={value == null ? "" : String(value)}
            onChange={(e) => {
                const v = e.target.value;
                onChange(v === "" ? null : Number(v));
            }}
            className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
            {clearable ? <option value="">— clear —</option> : null}
            {options.map((o) => (
                <option key={o.id} value={String(o.id)}>
                    {optLabel(o)}
                </option>
            ))}
        </select>
    );
}

/// Bulk-apply toolbar cell — uses Radix Select (only 5 instances, no perf
/// concern) with a paired Apply button so a stray click doesn't write.
function BulkApply({
    label,
    options,
    field,
    onApply,
    clearable = true,
}: {
    label: string;
    options: Opt[];
    field: keyof Patch;
    onApply: (field: keyof Patch, raw: string) => void;
    clearable?: boolean;
}) {
    const [v, setV] = useState<string>("");
    const CLEAR = "__clear__";
    return (
        <div className="flex items-center gap-1">
            <Select value={v} onValueChange={setV}>
                <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder={label} />
                </SelectTrigger>
                <SelectContent>
                    {clearable ? <SelectItem value={CLEAR}>— clear —</SelectItem> : null}
                    {options.map((o) => (
                        <SelectItem key={o.id} value={String(o.id)}>
                            {optLabel(o)}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                disabled={!v}
                onClick={() => {
                    if (!v) return;
                    onApply(field, v === CLEAR ? "" : v);
                    setV("");
                }}
            >
                Apply
            </Button>
        </div>
    );
}
