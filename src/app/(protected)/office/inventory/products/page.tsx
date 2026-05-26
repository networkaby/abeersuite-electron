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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import {
    Plus, Pencil, Trash2, Box, Search, Save, RotateCcw, Wand2,
    Eye, ListChecks, Filter, RefreshCw, ChevronDown, X,
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
import {
    buildOfflineName,
    DEFAULT_NAMING_CONFIG,
    type NamingConfigShape,
    type NamingMasters,
} from "@/modules/inventory/lib/productName";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

type Opt = { id: number; name?: string; code?: string; label?: string };

type Row = {
    id: number;
    sku: string;
    name: string;
    namePart: string | null;
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
    namePart: string | null;
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

type SortField =
    | "sku" | "name" | "namePart" | "categoryName" | "brandName" | "groupName"
    | "warrantyName" | "unitCode" | "modelNo" | "barcode1" | "stock" | "isActive";

type FilterField = "categoryId" | "brandId" | "groupId" | "warrantyTermId" | "unitId" | "isActive";

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
    const [namingConfig, setNamingConfig] = useState<NamingConfigShape | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const [search, setSearch] = useState("");
    const [dirty, setDirty] = useState<Map<number, Patch>>(new Map());
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [pageSize, setPageSize] = useState<number>(100);
    const [pageIndex, setPageIndex] = useState<number>(0);

    /// Sort state. null = the natural order returned by the API.
    /// Click cycles null → asc → desc → null.
    const [sort, setSort] = useState<{ field: SortField; dir: "asc" | "desc" } | null>(null);

    /// Per-column multi-select filters keyed by the row field name. Values are
    /// option ids stringified; "__none__" represents null/missing relations.
    const [colFilters, setColFilters] = useState<Map<FilterField, Set<string>>>(new Map());

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
            const [u, c, b, g, w, n] = await Promise.all([
                axios.get<Opt[]>("/api/inventory/units"),
                axios.get<Opt[]>("/api/inventory/categories"),
                axios.get<Opt[]>("/api/inventory/brands"),
                axios.get<Opt[]>("/api/inventory/product-groups"),
                axios.get<Opt[]>("/api/inventory/warranty-terms"),
                axios.get<Partial<NamingConfigShape>>("/api/inventory/naming-config").catch(() => ({ data: {} as Partial<NamingConfigShape> })),
            ]);
            setUnits(u.data);
            setCategories(c.data);
            setBrands(b.data);
            setGroups(g.data);
            setWarrantyTerms(w.data);
            setNamingConfig({ ...DEFAULT_NAMING_CONFIG, ...(n.data ?? {}) });
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

    /// Create a new master row by name (POST /api/inventory/<endpoint>),
    /// refresh that master list, and return the new id. Returns null if the
    /// user cancelled the prompt or the request failed.
    async function createMaster(
        endpoint: "categories" | "brands" | "product-groups" | "warranty-terms" | "units",
        label: string,
    ): Promise<number | null> {
        const name = window.prompt(`New ${label} name`)?.trim();
        if (!name) return null;
        try {
            const body = endpoint === "units"
                ? { code: name.toUpperCase().slice(0, 12), label: name }
                : { name };
            const res = await axios.post<{ id: number }>(`/api/inventory/${endpoint}`, body);
            await loadMasters();
            toast.success(`Created ${label} "${name}"`);
            return res.data.id;
        } catch (e: unknown) {
            const msg = axios.isAxiosError(e) ? e.response?.data?.error : null;
            toast.error(msg ?? `Failed to create ${label}`);
            return null;
        }
    }

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        // 1. free-text search across SKU/name/namePart/model/barcode
        let out = !q ? rows : rows.filter((r) =>
            r.sku.toLowerCase().includes(q) ||
            r.name.toLowerCase().includes(q) ||
            (r.namePart ?? "").toLowerCase().includes(q) ||
            (r.modelNo ?? "").toLowerCase().includes(q) ||
            (r.barcode1 ?? "").toLowerCase().includes(q),
        );
        // 2. per-column multi-select filters
        for (const [field, allowed] of colFilters) {
            if (allowed.size === 0) continue;
            out = out.filter((r) => {
                const v = r[field];
                const key = v == null ? "__none__" : String(v);
                return allowed.has(key);
            });
        }
        // 3. sort
        if (sort) {
            const dirMul = sort.dir === "asc" ? 1 : -1;
            const key = (r: Row): string | number => {
                switch (sort.field) {
                    case "sku": return r.sku;
                    case "name": return r.name.toLowerCase();
                    case "namePart": return (r.namePart ?? "").toLowerCase();
                    case "categoryName": return r.category?.name?.toLowerCase() ?? "";
                    case "brandName": return r.brand?.name?.toLowerCase() ?? "";
                    case "groupName": return r.group?.name?.toLowerCase() ?? "";
                    case "warrantyName": return r.warrantyTerm?.name?.toLowerCase() ?? "";
                    case "unitCode": return r.unit.code;
                    case "modelNo": return (r.modelNo ?? "").toLowerCase();
                    case "barcode1": return r.barcode1 ?? "";
                    case "stock": return r.stock ?? -1;
                    case "isActive": return r.isActive ? 1 : 0;
                }
            };
            out = [...out].sort((a, b) => {
                const ka = key(a), kb = key(b);
                if (ka < kb) return -1 * dirMul;
                if (ka > kb) return 1 * dirMul;
                return 0;
            });
        }
        return out;
    }, [rows, search, colFilters, sort]);

    function cycleSort(field: SortField) {
        setSort((cur) => {
            if (!cur || cur.field !== field) return { field, dir: "asc" };
            if (cur.dir === "asc") return { field, dir: "desc" };
            return null;
        });
    }

    function toggleColFilter(field: FilterField, key: string) {
        setColFilters((prev) => {
            const next = new Map(prev);
            const cur = new Set(next.get(field) ?? new Set<string>());
            if (cur.has(key)) cur.delete(key); else cur.add(key);
            if (cur.size === 0) next.delete(field); else next.set(field, cur);
            return next;
        });
    }
    function clearColFilter(field: FilterField) {
        setColFilters((prev) => {
            const next = new Map(prev);
            next.delete(field);
            return next;
        });
    }

    useEffect(() => { setPageIndex(0); }, [search, pageSize, mode, colFilters, sort]);

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

    /// Rebuild the offline name for one row from its current (dirty-or-saved)
    /// classification fields, using the org-wide InvNamingConfig. Patches the
    /// row's name field with the result. No-op if the naming config hasn't
    /// loaded yet.
    function regenerateName(r: Row) {
        if (!namingConfig) {
            toast.error("Naming config not loaded yet");
            return;
        }
        const findOpt = (list: Opt[], id: number | null | undefined) =>
            id == null ? null : list.find((o) => o.id === id) ?? null;
        const cat = findOpt(categories, val(r, "categoryId") as number | null);
        const brand = findOpt(brands, val(r, "brandId") as number | null);
        const grp = findOpt(groups, val(r, "groupId") as number | null);
        const war = findOpt(warrantyTerms, val(r, "warrantyTermId") as number | null);
        const unit = findOpt(units, val(r, "unitId") as number);
        const masters: NamingMasters = {
            brand: brand ? { name: brand.name ?? "" } : null,
            category: cat ? { name: cat.name ?? "" } : null,
            group: grp ? { name: grp.name ?? "" } : null,
            warranty: war ? { name: war.name ?? "" } : null,
            unit: unit ? { code: unit.code ?? "" } : null,
            modelNo: (val(r, "modelNo") as string | null) || null,
            attrs: null,
            // userPart survives every regenerate — the template inserts it
            // wherever the `userPart` token sits. Operator edits the Custom
            // column, never the auto-built portions.
            userPart: (val(r, "namePart") as string | null) || null,
        };
        const next = buildOfflineName(masters, namingConfig).trim();
        if (!next) {
            toast.error("Naming config produced an empty name — pick more masters first");
            return;
        }
        patch(r.id, { name: next });
    }

    const isEdit = mode === "edit";

    return (
        <div className="flex h-full flex-col gap-4 overflow-hidden">
            <div className="flex flex-none flex-wrap items-center justify-between gap-3">
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

            <div className="flex flex-none flex-wrap items-center justify-between gap-2">
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
                // Floating bulk-apply bar — fixed to the bottom of the viewport so
                // it stays reachable no matter how far the user has scrolled the
                // product list. The pb-24 spacer on the table wrapper below keeps
                // the last row from hiding under it.
                <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 max-w-[95vw]">
                    <div className="flex flex-wrap items-center gap-2 rounded-full border border-primary/40 bg-card/95 backdrop-blur px-3 py-1.5 shadow-lg">
                        <span className="flex items-center gap-1.5 text-xs font-medium px-1">
                            <Wand2 className="size-3.5" />
                            Apply to <strong>{selected.size}</strong>
                        </span>
                        <span className="h-5 w-px bg-border" aria-hidden />
                        <BulkApply label="Category" options={categories} field="categoryId" onApply={applyToSelected} onCreate={() => createMaster("categories", "category")} />
                        <BulkApply label="Brand" options={brands} field="brandId" onApply={applyToSelected} onCreate={() => createMaster("brands", "brand")} />
                        <BulkApply label="Group" options={groups} field="groupId" onApply={applyToSelected} onCreate={() => createMaster("product-groups", "group")} />
                        <BulkApply label="Warranty" options={warrantyTerms} field="warrantyTermId" onApply={applyToSelected} onCreate={() => createMaster("warranty-terms", "warranty term")} />
                        <BulkApply label="Unit" options={units} field="unitId" onApply={applyToSelected} clearable={false} onCreate={() => createMaster("units", "unit")} />
                        <span className="h-5 w-px bg-border" aria-hidden />
                        <button
                            type="button"
                            className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline px-1.5"
                            onClick={() => setSelected(new Set())}
                            title="Clear selection"
                        >
                            clear
                        </button>
                    </div>
                </div>
            ) : null}
            <ScrollArea className="min-h-0 flex-1 border border-border">
                <div className={isEdit && selected.size > 0 ? "pb-20" : ""}>
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
                                <TableHead className="w-10">#</TableHead>
                                <TableHead className="w-28"><SortHead field="sku" sort={sort} onSort={cycleSort}>SKU</SortHead></TableHead>
                                <TableHead className="min-w-64"><SortHead field="name" sort={sort} onSort={cycleSort}>Name</SortHead></TableHead>
                                <TableHead className="min-w-40"><SortHead field="namePart" sort={sort} onSort={cycleSort}>Custom</SortHead></TableHead>
                                <TableHead className="min-w-44">
                                    <div className="flex items-center gap-1">
                                        <SortHead field="categoryName" sort={sort} onSort={cycleSort}>Category</SortHead>
                                        <ColFilter field="categoryId" options={categories} rows={rows} colFilters={colFilters} onToggle={toggleColFilter} onClear={clearColFilter} />
                                    </div>
                                </TableHead>
                                <TableHead className="min-w-36">
                                    <div className="flex items-center gap-1">
                                        <SortHead field="brandName" sort={sort} onSort={cycleSort}>Brand</SortHead>
                                        <ColFilter field="brandId" options={brands} rows={rows} colFilters={colFilters} onToggle={toggleColFilter} onClear={clearColFilter} />
                                    </div>
                                </TableHead>
                                <TableHead className="min-w-36">
                                    <div className="flex items-center gap-1">
                                        <SortHead field="groupName" sort={sort} onSort={cycleSort}>Group</SortHead>
                                        <ColFilter field="groupId" options={groups} rows={rows} colFilters={colFilters} onToggle={toggleColFilter} onClear={clearColFilter} />
                                    </div>
                                </TableHead>
                                <TableHead className="min-w-36">
                                    <div className="flex items-center gap-1">
                                        <SortHead field="warrantyName" sort={sort} onSort={cycleSort}>Warranty</SortHead>
                                        <ColFilter field="warrantyTermId" options={warrantyTerms} rows={rows} colFilters={colFilters} onToggle={toggleColFilter} onClear={clearColFilter} />
                                    </div>
                                </TableHead>
                                <TableHead className="w-24">
                                    <div className="flex items-center gap-1">
                                        <SortHead field="unitCode" sort={sort} onSort={cycleSort}>Unit</SortHead>
                                        <ColFilter field="unitId" options={units} rows={rows} colFilters={colFilters} onToggle={toggleColFilter} onClear={clearColFilter} />
                                    </div>
                                </TableHead>
                                <TableHead className="min-w-32"><SortHead field="modelNo" sort={sort} onSort={cycleSort}>Model No</SortHead></TableHead>
                                <TableHead className="min-w-36"><SortHead field="barcode1" sort={sort} onSort={cycleSort}>Barcode</SortHead></TableHead>
                                <TableHead className="w-20 text-right"><SortHead field="stock" sort={sort} onSort={cycleSort} align="right">Stock</SortHead></TableHead>
                                <TableHead className="w-20 text-center">
                                    <div className="flex items-center justify-center gap-1">
                                        <SortHead field="isActive" sort={sort} onSort={cycleSort}>Active</SortHead>
                                        <ColFilter field="isActive" options={[]} rows={rows} colFilters={colFilters} onToggle={toggleColFilter} onClear={clearColFilter} booleanField />
                                    </div>
                                </TableHead>
                                {!isEdit ? <TableHead className="w-24 text-right"> </TableHead> : null}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell colSpan={isEdit ? 14 : 14} className="text-muted-foreground">Loading…</TableCell>
                                </TableRow>
                            ) : pageRows.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={isEdit ? 14 : 14} className="text-muted-foreground">
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
                                            <TableCell className="text-muted-foreground text-sm align-top">{pageStart + i + 1}</TableCell>
                                            <TableCell className="font-mono text-xs align-top whitespace-nowrap">{r.sku}</TableCell>

                                            {/* Name */}
                                            <TableCell className={isEdit ? "min-w-48 align-top whitespace-normal break-words" : "font-medium align-top whitespace-normal break-words"}>
                                                {isEdit ? (
                                                    <div className="flex items-start gap-1">
                                                        <div className="flex-1 min-w-0">
                                                            <AutoGrowInput
                                                                value={val(r, "name") as string}
                                                                onChange={(v) => patch(r.id, { name: v })}
                                                            />
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => regenerateName(r)}
                                                            title="Regenerate name from masters + Custom (per naming config)"
                                                            className="shrink-0 inline-flex items-center justify-center size-7 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                                                        >
                                                            <RefreshCw className="size-3.5" />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    r.name
                                                )}
                                            </TableCell>

                                            {/* Custom (namePart) — operator-curated portion that survives regenerate */}
                                            <TableCell className={isEdit ? "min-w-40 align-top whitespace-normal break-words" : "text-sm align-top whitespace-normal break-words"}>
                                                {isEdit ? (
                                                    <Input
                                                        value={(val(r, "namePart") as string | null) ?? ""}
                                                        onChange={(e) => patch(r.id, { namePart: e.target.value.trim() === "" ? null : e.target.value })}
                                                        placeholder="1.5M Special…"
                                                        className="h-8"
                                                    />
                                                ) : (
                                                    r.namePart ?? <span className="text-muted-foreground">—</span>
                                                )}
                                            </TableCell>

                                            {/* Category */}
                                            <TableCell className={isEdit ? "min-w-40 align-top whitespace-normal break-words" : "text-sm align-top whitespace-normal break-words"}>
                                                {isEdit ? (
                                                    <CellSelect
                                                        value={val(r, "categoryId") as number | null}
                                                        options={categories}
                                                        onChange={(v) => patch(r.id, { categoryId: v })}
                                                        onCreate={() => createMaster("categories", "category")}
                                                    />
                                                ) : (
                                                    r.category?.name ?? "—"
                                                )}
                                            </TableCell>

                                            {/* Brand */}
                                            <TableCell className={isEdit ? "min-w-40 align-top whitespace-normal break-words" : "text-sm align-top whitespace-normal break-words"}>
                                                {isEdit ? (
                                                    <CellSelect
                                                        value={val(r, "brandId") as number | null}
                                                        options={brands}
                                                        onChange={(v) => patch(r.id, { brandId: v })}
                                                        onCreate={() => createMaster("brands", "brand")}
                                                    />
                                                ) : (
                                                    r.brand?.name ?? "—"
                                                )}
                                            </TableCell>

                                            {/* Group */}
                                            <TableCell className={isEdit ? "min-w-40 align-top whitespace-normal break-words" : "text-sm align-top whitespace-normal break-words"}>
                                                {isEdit ? (
                                                    <CellSelect
                                                        value={val(r, "groupId") as number | null}
                                                        options={groups}
                                                        onChange={(v) => patch(r.id, { groupId: v })}
                                                        onCreate={() => createMaster("product-groups", "group")}
                                                    />
                                                ) : (
                                                    r.group?.name ?? "—"
                                                )}
                                            </TableCell>

                                            {/* Warranty */}
                                            <TableCell className={isEdit ? "min-w-40 align-top whitespace-normal break-words" : "text-sm align-top whitespace-normal break-words"}>
                                                {isEdit ? (
                                                    <CellSelect
                                                        value={val(r, "warrantyTermId") as number | null}
                                                        options={warrantyTerms}
                                                        onChange={(v) => patch(r.id, { warrantyTermId: v })}
                                                        onCreate={() => createMaster("warranty-terms", "warranty term")}
                                                    />
                                                ) : (
                                                    r.warrantyTerm?.name ?? "—"
                                                )}
                                            </TableCell>

                                            {/* Unit */}
                                            <TableCell className={isEdit ? "min-w-28 align-top" : "text-muted-foreground text-sm align-top whitespace-normal break-words"}>
                                                {isEdit ? (
                                                    <CellSelect
                                                        value={val(r, "unitId") as number}
                                                        options={units}
                                                        onChange={(v) => v != null && patch(r.id, { unitId: v })}
                                                        clearable={false}
                                                        onCreate={() => createMaster("units", "unit")}
                                                    />
                                                ) : (
                                                    r.unit.code
                                                )}
                                            </TableCell>

                                            {/* Model No */}
                                            <TableCell className={isEdit ? "min-w-32 align-top whitespace-normal break-words" : "text-sm align-top whitespace-normal break-words"}>
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
                                            <TableCell className={isEdit ? "min-w-32 font-mono align-top whitespace-nowrap" : "font-mono text-sm align-top whitespace-nowrap"}>
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
                <ScrollBar orientation="horizontal" />
            </ScrollArea>

            <div className="-mt-4 flex flex-none flex-wrap items-center justify-between gap-2 border-t border-border bg-background py-1 text-sm">
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

/// Clickable header cell — cycles null → asc → desc → null on each click and
/// shows a tiny arrow when sort is active on this column.
function SortHead({
    field, sort, onSort, children, align = "left",
}: {
    field: SortField;
    sort: { field: SortField; dir: "asc" | "desc" } | null;
    onSort: (f: SortField) => void;
    children: React.ReactNode;
    align?: "left" | "right";
}) {
    const active = sort?.field === field;
    const arrow = !active ? "↕" : sort!.dir === "asc" ? "↑" : "↓";
    return (
        <button
            type="button"
            onClick={() => onSort(field)}
            className={`inline-flex items-center gap-1 ${align === "right" ? "flex-row-reverse" : ""} hover:text-primary`}
        >
            <span>{children}</span>
            <span className={`text-xs ${active ? "text-primary" : "text-muted-foreground/60"}`}>{arrow}</span>
        </button>
    );
}

/// Per-column multi-select filter. Renders a funnel button that opens a
/// checklist of unique values from the master list (plus "(none)" if any row
/// has a null relation). For booleanField (isActive), shows ✓ / inactive.
function ColFilter({
    field, options, rows, colFilters, onToggle, onClear, booleanField = false,
}: {
    field: FilterField;
    options: Opt[];
    rows: Row[];
    colFilters: Map<FilterField, Set<string>>;
    onToggle: (f: FilterField, key: string) => void;
    onClear: (f: FilterField) => void;
    booleanField?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        if (!open) return;
        function onDocClick(e: MouseEvent) {
            if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
        }
        function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
        document.addEventListener("mousedown", onDocClick);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onDocClick);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

    const active = (colFilters.get(field)?.size ?? 0) > 0;
    const selected = colFilters.get(field) ?? new Set<string>();

    // Build the option list. For booleanField, two fixed options.
    const items: { key: string; label: string }[] = booleanField
        ? [{ key: "true", label: "Active" }, { key: "false", label: "Inactive" }]
        : (() => {
            const list = options.map((o) => ({ key: String(o.id), label: optLabel(o) }));
            // "(none)" only if any row has null for this field
            const anyNull = rows.some((r) => (r as unknown as Record<string, unknown>)[field] == null);
            if (anyNull) list.unshift({ key: "__none__", label: "(none)" });
            return list;
        })();

    return (
        <div ref={wrapRef} className="relative">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-label="Filter column"
                title={active ? `Filter (${selected.size})` : "Filter"}
                className={`inline-flex items-center justify-center size-5 rounded hover:bg-muted ${active ? "text-primary" : "text-muted-foreground/60"}`}
            >
                <Filter className="size-3.5" />
            </button>
            {open ? (
                <div className="absolute z-20 mt-1 left-0 min-w-48 max-h-72  rounded-md border border-border bg-popover text-popover-foreground p-2 shadow-md">
                    {/* <div className="absolute z-20 mt-1 left-0 min-w-48 max-h-72 overflow-auto rounded-md border border-border bg-popover text-popover-foreground p-2 shadow-md"> */}
                    <div className="flex items-center justify-between mb-1 text-xs">
                        <span className="text-muted-foreground">Filter</span>
                        {active ? (
                            <button type="button" className="hover:underline" onClick={() => onClear(field)}>
                                clear
                            </button>
                        ) : null}
                    </div>
                    <ul className="space-y-1">
                        {items.map((it) => (
                            <li key={it.key}>
                                <label className="flex items-center gap-2 text-sm cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={selected.has(it.key)}
                                        onChange={() => onToggle(field, it.key)}
                                    />
                                    <span className="truncate">{it.label}</span>
                                </label>
                            </li>
                        ))}
                        {items.length === 0 ? (
                            <li className="text-xs text-muted-foreground italic">no values</li>
                        ) : null}
                    </ul>
                </div>
            ) : null}
        </div>
    );
}

/// Single-line by default, grows vertically as the text wraps. Used for the
/// Name cell so a long product name shows in full while still feeling like
/// an input. Sets rows={1} and resizes on every render to the scrollHeight.
function AutoGrowInput({
    value,
    onChange,
    className,
}: {
    value: string;
    onChange: (v: string) => void;
    className?: string;
}) {
    const ref = useRef<HTMLTextAreaElement | null>(null);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight}px`;
    }, [value]);
    return (
        <textarea
            ref={ref}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={1}
            className={
                "block w-full resize-none rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring " +
                (className ?? "")
            }
        />
    );
}

/// Searchable combobox cell. Closed state is just a button (cheap — keeps the
/// grid lean at 100+ rows × 5 dropdowns); opening one cell mounts a small
/// floating popover with a search input + filtered list. Native <select> was
/// the previous take but it can't substring-search a 250-brand list — only
/// first-letter jump.
///
/// onCreate (when supplied) shows a "+ New …" action at the top of the open
/// list. Choosing it calls onCreate (which prompts + POSTs + refreshes masters)
/// and selects the new id on success.
function CellSelect({
    value,
    options,
    onChange,
    clearable = true,
    onCreate,
    createLabel = "+ New",
}: {
    value: number | null;
    options: Opt[];
    onChange: (v: number | null) => void;
    clearable?: boolean;
    onCreate?: () => Promise<number | null>;
    createLabel?: string;
}) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [highlight, setHighlight] = useState(0);
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const listRef = useRef<HTMLUListElement | null>(null);

    const selected = options.find((o) => o.id === value) ?? null;
    const selectedLabel = selected ? optLabel(selected) : "";

    // Filtered + ranked options. Empty query → all options.
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return options;
        // Prefix matches first, then substring matches.
        const prefix: Opt[] = [];
        const sub: Opt[] = [];
        for (const o of options) {
            const lbl = optLabel(o).toLowerCase();
            if (lbl.startsWith(q)) prefix.push(o);
            else if (lbl.includes(q)) sub.push(o);
        }
        return [...prefix, ...sub];
    }, [options, query]);

    // Close on outside click + Escape.
    useEffect(() => {
        if (!open) return;
        function onDoc(e: MouseEvent) {
            if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
        }
        function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
        document.addEventListener("mousedown", onDoc);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onDoc);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

    // Reset query + focus the input each time the popover opens; reset highlight
    // whenever the filter changes.
    useEffect(() => {
        if (open) {
            setQuery("");
            setHighlight(0);
            // Focus on next tick so the input is mounted.
            requestAnimationFrame(() => inputRef.current?.focus());
        }
    }, [open]);
    useEffect(() => { setHighlight(0); }, [query]);

    // Scroll the highlighted item into view on arrow nav.
    useEffect(() => {
        if (!open || !listRef.current) return;
        const el = listRef.current.querySelector<HTMLLIElement>(`[data-idx="${highlight}"]`);
        el?.scrollIntoView({ block: "nearest" });
    }, [highlight, open]);

    function commit(o: Opt) {
        onChange(o.id);
        setOpen(false);
    }
    function commitClear() {
        onChange(null);
        setOpen(false);
    }
    async function commitNew() {
        if (!onCreate) return;
        setOpen(false);
        const id = await onCreate();
        if (id != null) onChange(id);
    }

    return (
        <div ref={wrapRef} className="relative">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="flex h-8 w-full items-center justify-between gap-1 rounded-md border border-input bg-transparent px-2 text-left text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                aria-haspopup="listbox"
                aria-expanded={open}
            >
                <span className={"truncate " + (selectedLabel ? "" : "text-muted-foreground")}>
                    {selectedLabel || "—"}
                </span>
                <span className="flex items-center gap-0.5 shrink-0">
                    {clearable && value != null ? (
                        <span
                            role="button"
                            tabIndex={-1}
                            aria-label="Clear"
                            onClick={(e) => { e.stopPropagation(); commitClear(); }}
                            className="inline-flex items-center justify-center size-4 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
                        >
                            <X className="size-3" />
                        </span>
                    ) : null}
                    <ChevronDown className="size-3.5 text-muted-foreground shrink-0" />
                </span>
            </button>
            {open ? (
                <div className="absolute z-30 left-0 right-0 mt-1 rounded-md border border-border bg-popover text-popover-foreground shadow-md min-w-56">
                    <div className="p-1 border-b border-border">
                        <input
                            ref={inputRef}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "ArrowDown") {
                                    e.preventDefault();
                                    setHighlight((h) => Math.min(filtered.length - 1, h + 1));
                                } else if (e.key === "ArrowUp") {
                                    e.preventDefault();
                                    setHighlight((h) => Math.max(0, h - 1));
                                } else if (e.key === "Enter") {
                                    e.preventDefault();
                                    const pick = filtered[highlight];
                                    if (pick) commit(pick);
                                }
                            }}
                            placeholder="Type to search…"
                            className="h-7 w-full rounded border border-input bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                    </div>
                    <ul ref={listRef} className="max-h-64 overflow-auto py-1" role="listbox">
                        {clearable && value != null ? (
                            <li>
                                <button
                                    type="button"
                                    onClick={commitClear}
                                    className="block w-full px-2 py-1 text-left text-sm text-muted-foreground hover:bg-muted"
                                >
                                    — clear —
                                </button>
                            </li>
                        ) : null}
                        {onCreate ? (
                            <li>
                                <button
                                    type="button"
                                    onClick={commitNew}
                                    className="block w-full px-2 py-1 text-left text-sm text-primary hover:bg-muted"
                                >
                                    {createLabel}
                                </button>
                            </li>
                        ) : null}
                        {filtered.length === 0 ? (
                            <li className="px-2 py-1 text-xs text-muted-foreground italic">No matches</li>
                        ) : (
                            filtered.map((o, i) => {
                                const isHighlighted = i === highlight;
                                const isSelected = o.id === value;
                                return (
                                    <li key={o.id} data-idx={i}>
                                        <button
                                            type="button"
                                            onMouseEnter={() => setHighlight(i)}
                                            onClick={() => commit(o)}
                                            className={
                                                "block w-full px-2 py-1 text-left text-sm " +
                                                (isHighlighted ? "bg-muted " : "") +
                                                (isSelected ? "font-medium" : "")
                                            }
                                        >
                                            {optLabel(o)}
                                        </button>
                                    </li>
                                );
                            })
                        )}
                    </ul>
                </div>
            ) : null}
        </div>
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
    onCreate,
}: {
    label: string;
    options: Opt[];
    field: keyof Patch;
    onApply: (field: keyof Patch, raw: string) => void;
    clearable?: boolean;
    onCreate?: () => Promise<number | null>;
}) {
    const [v, setV] = useState<string>("");
    const CLEAR = "__clear__";
    const NEW = "__new__";
    return (
        <div className="flex items-center gap-1">
            <Select
                value={v}
                onValueChange={async (next) => {
                    if (next === NEW && onCreate) {
                        const id = await onCreate();
                        if (id != null) setV(String(id));
                        return;
                    }
                    setV(next);
                }}
            >
                <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder={label} />
                </SelectTrigger>
                <SelectContent>
                    {clearable ? <SelectItem value={CLEAR}>— clear —</SelectItem> : null}
                    {onCreate ? <SelectItem value={NEW}>+ New {label.toLowerCase()}</SelectItem> : null}
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
