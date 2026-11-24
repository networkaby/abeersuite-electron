"use client";

// Unified products page — read-only browse by default with all classification
// fields visible + search + pagination; flip to "Edit cells" to bulk-edit
// category / brand / group / warranty / unit / model / barcode / Custom / active
// inline. Name is derived, not typed — it regenerates from the masters + Custom
// (namePart) per the naming convention, or via the per-row regenerate button.
// Pricing, opening stock, GST, naming-config etc. are still edited via the
// per-row dialog (pencil button → InvProductDialog).
//
// Save model (edit mode): per dirty row, PATCH /api/inventory/products/{id},
// at most SAVE_CONCURRENCY at once.
//
// Search, column filters, sort and paging run on the SERVER over every product
// (modules/inventory/lib/productList.ts) — the page holds one page of rows.
// The existing PATCH already accepts every classification field this grid touches —
// no batch endpoint needed.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Search, Save, RotateCcw, Wand2, Eye, ListChecks, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InvProductDialog } from "@/modules/inventory/components/InvProductDialog";
import {
    InventoryMasterDropdownQuickDialog,
    type MasterKind,
} from "@/modules/inventory/components/InventoryMasterDropdownQuickDialog";
import { flattenTree, treeLabel } from "@/shared/lib/tree";
import {
    buildOfflineName,
    DEFAULT_NAMING_CONFIG,
    type NamingConfigShape,
    type NamingMasters,
} from "@/modules/inventory/lib/productName";
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { BreadcrumbBar } from "@/shared/components/BreadcrumbBar";
import { useEscape, useActiveRow } from "@/shared/hooks";
import { usePagedQuery } from "@/shared/hooks/usePagedQuery";
import { useDebouncedValue } from "@/shared/hooks/useDebouncedValue";
import { gridRowClass, GRID_FROZEN_CELL, GRID_FROZEN_HEAD, GRID_FROZEN_EDGE } from "@/shared/lib/format";
import { primaryBarcode, withPrimaryBarcode } from "@/shared/lib/inventory";
import { confirmAction } from "@/shared/lib/ui/confirmStore";
import { runPool } from "@/shared/lib/runPool";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import {
    Opt,
    GstRateOpt,
    EditRow,
    Row,
    Patch,
    Mode,
    SortField,
    FilterField,
    ColId,
    COLUMNS,
    ALL_COL_IDS,
    COLS_STORAGE_KEY,
    ProductPage,
    NO_ROWS,
    LIVE_TOPICS,
    NO_TOPICS,
    SAVE_CONCURRENCY,
    sameValue,
    STOCK_FILTER_ITEMS,
    FROZEN_W,
} from "./_components/productsTypes";
import { SortHead, ColumnChooser, ColFilter, CellSelect, BulkApply } from "./_components/ProductsGridParts";

export default function InventoryProductsPage() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const editParam = searchParams.get("edit");

    const [mode, setMode] = useState<Mode>("view");
    const [units, setUnits] = useState<Opt[]>([]);
    const [categories, setCategories] = useState<Opt[]>([]);
    const [brands, setBrands] = useState<Opt[]>([]);
    const [groups, setGroups] = useState<Opt[]>([]);
    const [gstRates, setGstRates] = useState<GstRateOpt[]>([]);
    const [warrantyTerms, setWarrantyTerms] = useState<Opt[]>([]);
    const [namingConfig, setNamingConfig] = useState<NamingConfigShape | null>(null);
    const [mastersLoading, setMastersLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const [search, setSearch] = useState("");
    const [dirty, setDirty] = useState<Map<number, Patch>>(new Map());
    const [selected, setSelected] = useState<Set<number>>(new Set());

    /// The row the operator is currently on — drives the active-line highlight.
    const { rowProps, isActive: isActiveRow } = useActiveRow<number>();

    /// Sort state. null = the natural order returned by the API.
    /// Click cycles null → asc → desc → null.
    const [sort, setSort] = useState<{ field: SortField; dir: "asc" | "desc" } | null>(null);

    /// Per-column multi-select filters keyed by the row field name. Values are
    /// option ids stringified; "__none__" represents null/missing relations.
    /// `?groups=1,2,3` / `?collections=1,2,3` (the Items links on Product groups
    /// and Collections) set that column's filter — on first open AND whenever the
    /// link changes while the page is already mounted (client navigation keeps state).
    const drillParam = `${searchParams.get("groups") ?? ""}|${searchParams.get("collections") ?? ""}`;
    const [colFilters, setColFilters] = useState<Map<FilterField, Set<string>>>(new Map());
    const [seenDrillParam, setSeenDrillParam] = useState<string | null>(null);
    if (drillParam !== seenDrillParam) {
        setSeenDrillParam(drillParam);
        const ids = (key: string) => searchParams.get(key)?.split(",").filter((x) => /^[0-9]+$/.test(x)) ?? [];
        const next = new Map<FilterField, Set<string>>();
        if (ids("groups").length) next.set("groupId", new Set(ids("groups")));
        if (ids("collections").length) next.set("categoryId", new Set(ids("collections")));
        if (next.size) setColFilters(next);
    }

    /// Which data columns are visible — user-controlled via the Columns chooser,
    /// remembered per browser. Unknown/legacy ids are ignored; new columns
    /// default to visible so a release that adds one doesn't hide it.
    const [visibleCols, setVisibleCols] = useState<Set<ColId>>(new Set(ALL_COL_IDS));
    useEffect(() => {
        try {
            const raw = localStorage.getItem(COLS_STORAGE_KEY);
            if (!raw) return;
            const saved = JSON.parse(raw) as string[];
            // Start from all-visible, then hide anything the user has hidden — so
            // a newly added column is shown until they hide it themselves.
            // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore after mount; the server render has no localStorage
            setVisibleCols(new Set(ALL_COL_IDS.filter((id) => saved.includes(id))));
        } catch { /* ignore malformed storage */ }
    }, []);
    const setColVisible = (id: ColId, on: boolean) => {
        setVisibleCols((prev) => {
            const next = new Set(prev);
            if (on) next.add(id); else next.delete(id);
            try { localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
            return next;
        });
    };
    const showCol = (id: ColId) => visibleCols.has(id);
    const visibleColCount = COLUMNS.filter((c) => visibleCols.has(c.id)).length;

    const [dialogOpen, setDialogOpen] = useState(false);
    const [dialogEditId, setDialogEditId] = useState<number | null>(null);

    /// Shared master quick-add dialog. One instance handles every kind —
    /// `masterKind` switches the rendered fields. The Promise returned by
    /// `createMaster` resolves with the new id (or null if cancelled), so
    /// callers can pre-select what the user just made.
    const [masterDialogOpen, setMasterDialogOpen] = useState(false);
    const [masterKind, setMasterKind] = useState<MasterKind>("brand");
    const masterResolveRef = useRef<((id: number | null) => void) | null>(null);

    const createMaster = useCallback((kind: MasterKind): Promise<number | null> => {
        return new Promise((resolve) => {
            masterResolveRef.current = resolve;
            setMasterKind(kind);
            setMasterDialogOpen(true);
        });
    }, []);

    /// What the list asks the server for — everything except the page number,
    /// which usePagedQuery keeps and resets to 1 whenever this changes.
    const debouncedSearch = useDebouncedValue(search.trim(), 250);
    const listParams = useMemo(() => {
        // SKU master is org-level: show the ALL-branch total (opening +
        // every branch's movements), not the session's active branch.
        const p: Record<string, string> = { branchId: "all", q: debouncedSearch };
        if (sort) { p.sort = sort.field; p.dir = sort.dir; }
        for (const [field, allowed] of colFilters) {
            if (allowed.size > 0) p[field] = [...allowed].join(",");
        }
        return p;
    }, [debouncedSearch, sort, colFilters]);

    // Live in browse mode only: a re-read while cells are being edited would
    // throw away unsaved rows. Edit mode reloads itself on save. The old page
    // stays on screen while the next one (or a new search) loads.
    const list = usePagedQuery<ProductPage>("/api/inventory/products", listParams, {
        topics: mode === "view" ? LIVE_TOPICS : NO_TOPICS,
        keepPrevious: true,
    });
    const rows = list.data?.rows ?? NO_ROWS;
    const reloadProducts = list.reload;
    useEffect(() => {
        if (list.error) toast.error("Failed to load products");
    }, [list.error]);

    /// Every row the grid has seen — the current page plus rows reached by
    /// "select all filtered" — so patch / bulk-apply can read a row that is not
    /// on this page.
    const seenRef = useRef(new Map<number, EditRow>());
    useEffect(() => {
        for (const r of rows) seenRef.current.set(r.id, r);
    }, [rows]);

    const loadMasters = useCallback(async () => {
        try {
            const [u, c, b, g, w, gst, n] = await Promise.all([
                axios.get<Opt[]>("/api/inventory/units"),
                axios.get<Opt[]>("/api/inventory/categories"),
                axios.get<Opt[]>("/api/inventory/brands"),
                axios.get<Opt[]>("/api/inventory/product-groups"),
                axios.get<Opt[]>("/api/inventory/warranty-terms"),
                axios.get<GstRateOpt[]>("/api/inventory/gst-rates").catch(() => ({ data: [] as GstRateOpt[] })),
                axios.get<Partial<NamingConfigShape>>("/api/inventory/naming-config").catch(() => ({ data: {} as Partial<NamingConfigShape> })),
            ]);
            setUnits(u.data);
            setCategories(c.data);
            setBrands(b.data);
            setGroups(g.data);
            setWarrantyTerms(w.data);
            setGstRates(gst.data);
            setNamingConfig({ ...DEFAULT_NAMING_CONFIG, ...(n.data ?? {}) });
        } catch {
            toast.error("Failed to load reference data");
        }
    }, []);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch the masters once on mount
        void loadMasters().finally(() => setMastersLoading(false));
    }, [loadMasters]);
    const loading = list.loading || mastersLoading;

    // Deep-link: /office/inventory/products?edit=<id> auto-opens the dialog.
    const handledEditRef = useRef<number | null>(null);
    useEffect(() => {
        if (!editParam) return;
        const id = Number(editParam);
        if (!Number.isFinite(id)) return;
        if (handledEditRef.current === id) return;
        handledEditRef.current = id;
        // A ?edit=<id> link opens the dialog once, then leaves the URL.
        setDialogEditId(id);
        setDialogOpen(true);
        const next = new URLSearchParams(searchParams.toString());
        next.delete("edit");
        const qs = next.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname);
    }, [editParam, pathname, router, searchParams]);

    function val<K extends keyof EditRow>(row: EditRow, key: K): EditRow[K] {
        const p = dirty.get(row.id);
        if (p && key in p) {
            return (p as Record<string, unknown>)[key as string] as EditRow[K];
        }
        return row[key];
    }

    function patch(id: number, change: Patch) {
        const row = seenRef.current.get(id);
        setDirty((prev) => {
            const next = new Map(prev);
            const cur = next.get(id) ?? {};
            const merged: Patch = { ...cur, ...change };
            // Drop the entry if every patched key matches the underlying row.
            if (row) {
                let allMatch = true;
                for (const k of Object.keys(merged) as (keyof Patch)[]) {
                    if (!sameValue((merged as Record<string, unknown>)[k], (row as Record<string, unknown>)[k])) {
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

    /// Inline-edit pickers for category / group show the hierarchy as
    /// indented rows ("-father", "--son") so the operator can tell a
    /// "Laptops" sub-of-Computers apart from a top-level "Laptops". The
    /// CellSelect filters by substring against the label, which now carries
    /// the depth prefix — typing "son" still matches "--son" via includes.
    const categoryOptionsHier = useMemo(
        () => flattenTree(categories).map((r) => ({ id: r.id, name: treeLabel(r) })),
        [categories],
    );
    const groupOptionsHier = useMemo(
        () => flattenTree(groups).map((r) => ({ id: r.id, name: treeLabel(r) })),
        [groups],
    );

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

    // The server may pull an out-of-range page back to the last one (e.g. after
    // a delete), so the footer reads its answer rather than our own counter.
    const page = list.data?.page ?? list.page;
    const pageSize = list.data?.pageSize ?? 0;
    const pageCount = list.data?.pageCount ?? 1;
    const matched = list.data?.matched ?? 0;
    const total = list.data?.total ?? 0;
    const pageStart = (page - 1) * pageSize;
    const pageRows = rows;

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
    /// Tick every match, including rows on other pages. The server sends each
    /// one as the small edit row so bulk-apply can still rebuild its name.
    async function selectAllFiltered() {
        try {
            const qs = new URLSearchParams({ ...listParams, idsOnly: "1" });
            const { data } = await axios.get<{ rows: EditRow[] }>(`/api/inventory/products?${qs}`);
            for (const r of data.rows) {
                if (!seenRef.current.has(r.id)) seenRef.current.set(r.id, r);
            }
            setSelected((prev) => new Set([...prev, ...data.rows.map((r) => r.id)]));
        } catch {
            toast.error("Failed to select all filtered products");
        }
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
                const merged: Patch = { ...cur, [field]: value };
                // Bulk-applied fields (category / brand / group / warranty /
                // unit) are name sources — regenerate Name to match, but only
                // for rows that have a Custom part to anchor the rebuild (same
                // rule as patchWithRegen). Rows without one keep their existing
                // descriptive name.
                const row = seenRef.current.get(id);
                const namePart = (cur.namePart !== undefined ? cur.namePart : row?.namePart) ?? "";
                if (row && namePart.trim()) {
                    const nm = computeName(row, merged);
                    if (nm) merged.name = nm;
                }
                next.set(id, merged);
            }
            return next;
        });
        toast.success(`Applied to ${selected.size} row${selected.size === 1 ? "" : "s"}`);
    }

    /// Bulk-set a boolean field (e.g. requireSaleNote) on every selected row.
    /// Boolean sibling of applyToSelected — no name regeneration, no numeric coercion.
    function applyBoolToSelected(field: keyof Patch, value: boolean) {
        if (selected.size === 0) {
            toast.error("Select at least one row first");
            return;
        }
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
        const saved = new Map<number, Patch>();
        const failed: { id: number; reason: string }[] = [];
        await runPool([...dirty.entries()], SAVE_CONCURRENCY, async ([id, p]) => {
            try {
                await axios.patch(`/api/inventory/products/${id}`, p);
                saved.set(id, p);
            } catch (e) {
                failed.push({ id, reason: extractApiError(e, "Save failed") });
            }
        });
        setSaving(false);
        // Clear only what reached the server. A failed row keeps its pending
        // edit (and its highlight) so the operator can fix it and save again;
        // a row edited again while the save ran keeps the newer edit.
        setDirty((prev) => {
            const next = new Map(prev);
            for (const [id, p] of saved) if (next.get(id) === p) next.delete(id);
            return next;
        });
        if (failed.length === 0) {
            toast.success(`Saved ${saved.size} product${saved.size === 1 ? "" : "s"}`);
        } else {
            const skus = failed.slice(0, 3).map((f) => seenRef.current.get(f.id)?.sku ?? `#${f.id}`).join(", ");
            const more = failed.length > 3 ? ` +${failed.length - 3} more` : "";
            toast.error(`Saved ${saved.size}, failed ${failed.length} (${skus}${more}): ${failed[0].reason}`, {
                description: "The failed rows are still pending — fix them and press Save again.",
            });
        }
        await reloadProducts();
    }

    async function discard() {
        if (dirty.size === 0) return;
        if (!(await confirmAction({ title: `Discard ${dirty.size} pending change${dirty.size === 1 ? "" : "s"}?`, confirmLabel: "Discard" }))) return;
        setDirty(new Map());
    }

    async function flipMode(next: Mode) {
        if (next === "view" && dirty.size > 0) {
            if (!(await confirmAction({ title: `Switch to view mode and discard ${dirty.size} pending change${dirty.size === 1 ? "" : "s"}?`, confirmLabel: "Switch", destructive: false }))) return;
            setDirty(new Map());
        }
        setMode(next);
    }

    async function del(id: number) {
        if (!(await confirmAction({ title: "Delete this product master?", confirmLabel: "Delete" }))) return;
        try {
            await axios.delete(`/api/inventory/products/${id}`);
            toast.success("Deleted");
            void reloadProducts();
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

    /// Build the offline name for one row from its classification fields using
    /// the org-wide InvNamingConfig. `override` wins over the row's current
    /// (dirty-or-saved) values — used so a name-source change regenerates from
    /// the NEW value in the same tick (setDirty is async, so val() would still
    /// read the pre-change value). Returns "" if config isn't loaded or the
    /// template resolves to nothing.
    function computeName(r: EditRow, override: Patch): string {
        if (!namingConfig) return "";
        const pick = <K extends keyof EditRow>(key: K): EditRow[K] =>
            (key in override ? (override as Record<string, unknown>)[key as string] as EditRow[K] : val(r, key));
        const findOpt = (list: Opt[], id: number | null | undefined) =>
            id == null ? null : list.find((o) => o.id === id) ?? null;
        const cat = findOpt(categories, pick("categoryId") as number | null);
        const brand = findOpt(brands, pick("brandId") as number | null);
        const grp = findOpt(groups, pick("groupId") as number | null);
        const war = findOpt(warrantyTerms, pick("warrantyTermId") as number | null);
        const unit = findOpt(units, pick("unitId") as number);
        const masters: NamingMasters = {
            brand: brand ? { name: brand.name ?? "" } : null,
            category: cat ? { name: cat.name ?? "" } : null,
            group: grp ? { name: grp.name ?? "" } : null,
            warranty: war ? { name: war.name ?? "" } : null,
            unit: unit ? { code: unit.code ?? "" } : null,
            modelNo: (pick("modelNo") as string | null) || null,
            attrs: (r.attrsJson as Record<string, string> | null | undefined) ?? null,
            // userPart survives every regenerate — the template inserts it
            // wherever the `userPart` token sits. Operator edits the Custom
            // column, never the auto-built Name.
            userPart: (pick("namePart") as string | null) || null,
        };
        return buildOfflineName(masters, namingConfig).trim();
    }

    /// Regenerate button (per row). Name is not hand-typed — this is the manual
    /// rebuild path when nothing else changed (e.g. the naming config itself).
    function regenerateName(r: Row) {
        if (!namingConfig) {
            toast.error("Naming config not loaded yet");
            return;
        }
        const next = computeName(r, {});
        if (!next) {
            toast.error("Naming config produced an empty name — pick more masters first");
            return;
        }
        patch(r.id, { name: next });
    }

    /// Patch a name-source field (brand / group / model / Custom / …) and
    /// regenerate Name so it tracks the convention — but ONLY when the product
    /// has a Custom part (namePart) to anchor the rebuild. With no Custom part
    /// the existing name IS the descriptive content (imported / hand-typed), so
    /// a masters-only rebuild would wipe it — leave the name untouched instead.
    /// The per-row regenerate button still forces a rebuild when wanted.
    function patchWithRegen(r: Row, change: Patch) {
        const namePart = (("namePart" in change ? change.namePart : val(r, "namePart")) as string | null) ?? "";
        if (!namePart.trim()) {
            patch(r.id, change);
            return;
        }
        const next = computeName(r, change);
        patch(r.id, next ? { ...change, name: next } : change);
    }

    const isEdit = mode === "edit";

    // Left offsets for the frozen identity columns (select / # / SKU / Name),
    // so a cell far to the right always stays tied to a visible product name.
    const leftIndex = isEdit ? FROZEN_W.select : 0;
    const leftSku = leftIndex + FROZEN_W.index;
    const leftName = leftSku + (showCol("sku") ? FROZEN_W.sku : 0);
    const frozenCell = GRID_FROZEN_CELL;
    const frozenHead = GRID_FROZEN_HEAD;

    useEscape(() => router.back());

    return (
        <div className="flex h-full flex-col overflow-hidden">
            <BreadcrumbBar>
                <Breadcrumb>
                    <BreadcrumbList>
                        <BreadcrumbItem>
                            <BreadcrumbLink asChild>
                                <Link href="/office/inventory">Inventory</Link>
                            </BreadcrumbLink>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator />
                        <BreadcrumbItem>
                            <BreadcrumbPage>Products</BreadcrumbPage>
                        </BreadcrumbItem>
                    </BreadcrumbList>
                </Breadcrumb>
            </BreadcrumbBar>
            <div className="flex flex-1 min-h-0 flex-col gap-4 overflow-hidden p-3">
                <InvProductDialog
                    open={dialogOpen}
                    onOpenChange={setDialogOpen}
                    editId={dialogEditId}
                    onSaved={reloadProducts}
                />

                <InventoryMasterDropdownQuickDialog
                    open={masterDialogOpen}
                    onOpenChange={(v) => {
                        setMasterDialogOpen(v);
                        if (!v && masterResolveRef.current) {
                            masterResolveRef.current(null);
                            masterResolveRef.current = null;
                        }
                    }}
                    kind={masterKind}
                    siblings={
                        masterKind === "category" ? categories
                            : masterKind === "group" ? groups
                                : undefined
                    }
                    gstRates={gstRates}
                    onCreated={async (id) => {
                        await loadMasters();
                        if (masterResolveRef.current) {
                            masterResolveRef.current(id);
                            masterResolveRef.current = null;
                        }
                        setMasterDialogOpen(false);
                    }}
                />

                <div className="flex flex-none flex-wrap items-center gap-2">
                    <div className="relative">
                        <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            placeholder="Search SKU, name, model, barcode"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="pl-7 w-80"
                        />
                    </div>
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
                    <ColumnChooser visible={visibleCols} onToggle={setColVisible} onReset={() => {
                        setVisibleCols(new Set(ALL_COL_IDS));
                        try { localStorage.removeItem(COLS_STORAGE_KEY); } catch { /* ignore */ }
                    }} />
                    <Button type="button" onClick={openNew}>
                        <Plus className="size-4" />
                        New product
                    </Button>
                    <div className="ml-auto flex items-center gap-2">
                        {isEdit ? (
                            <>
                                <Button type="button" variant="outline" onClick={discard} disabled={dirty.size === 0 || saving}>
                                    <RotateCcw className="size-4" /> Discard
                                </Button>
                                <Button type="button" onClick={save} disabled={dirty.size === 0 || saving}>
                                    <Save className="size-4" /> Save {dirty.size > 0 ? `(${dirty.size})` : ""}
                                </Button>
                            </>
                        ) : null}
                    </div>
                </div>

                {/* Single flex-fill scroll box owning BOTH axes: the inner shadcn
                table-container's overflow-x is neutralized so this div is the
                only scroller, which lets the header stick on vertical scroll.
                Matches the Update & Print Labels grid. */}
                <div className="min-h-0 flex-1 overflow-auto border border-border **:data-[slot=table-container]:overflow-x-visible">
                    <div>
                        {/* In edit mode every cell is an input, so draw the grid
                        lines — without them the row reads as a soup of boxes. */}
                        <Table className={isEdit ? "[&_tbody_td:not(:last-child)]:border-r [&_tbody_td]:border-border/50 [&_tbody_td]:py-1.5" : undefined}>
                            <TableHeader className="sticky top-0 z-20 bg-[color-mix(in_oklab,var(--muted)_75%,var(--background))] [&_th]:bg-[color-mix(in_oklab,var(--muted)_75%,var(--background))] [&_tr]:border-b [&_th]:shadow-[inset_0_-1px_0_var(--border)]">
                                <TableRow className="hover:bg-inherit">
                                    {isEdit ? (
                                        <TableHead className={`w-10 ${frozenHead}`} style={{ left: 0 }}>
                                            <Checkbox
                                                checked={allPageSelected}
                                                onCheckedChange={toggleAllPage}
                                                aria-label="Select all on page"
                                            />
                                        </TableHead>
                                    ) : null}
                                    <TableHead className={`w-10 ${frozenHead}`} style={{ left: leftIndex }}>#</TableHead>
                                    {showCol("sku") ? <TableHead className={`w-28 ${frozenHead}`} style={{ left: leftSku }}><SortHead field="sku" sort={sort} onSort={cycleSort}>SKU</SortHead></TableHead> : null}
                                    {showCol("name") ? <TableHead className={`min-w-64 ${frozenHead} ${GRID_FROZEN_EDGE}`} style={{ left: leftName }}><SortHead field="name" sort={sort} onSort={cycleSort}>Name</SortHead></TableHead> : null}
                                    {showCol("namePart") ? <TableHead className="min-w-40"><SortHead field="namePart" sort={sort} onSort={cycleSort}>Custom</SortHead></TableHead> : null}
                                    {showCol("category") ? (
                                        <TableHead className="min-w-44">
                                            <div className="flex items-center gap-1">
                                                <SortHead field="categoryName" sort={sort} onSort={cycleSort}>Collection</SortHead>
                                                <ColFilter field="categoryId" options={categories} colFilters={colFilters} onToggle={toggleColFilter} onClear={clearColFilter} onCreate={() => createMaster("category")} createLabel="category" />
                                            </div>
                                        </TableHead>
                                    ) : null}
                                    {showCol("brand") ? (
                                        <TableHead className="min-w-36">
                                            <div className="flex items-center gap-1">
                                                <SortHead field="brandName" sort={sort} onSort={cycleSort}>Brand</SortHead>
                                                <ColFilter field="brandId" options={brands} colFilters={colFilters} onToggle={toggleColFilter} onClear={clearColFilter} onCreate={() => createMaster("brand")} createLabel="brand" />
                                            </div>
                                        </TableHead>
                                    ) : null}
                                    {showCol("group") ? (
                                        <TableHead className="min-w-36">
                                            <div className="flex items-center gap-1">
                                                <SortHead field="groupName" sort={sort} onSort={cycleSort}>Group</SortHead>
                                                <ColFilter field="groupId" options={groups} colFilters={colFilters} onToggle={toggleColFilter} onClear={clearColFilter} onCreate={() => createMaster("group")} createLabel="group" />
                                            </div>
                                        </TableHead>
                                    ) : null}
                                    {showCol("warranty") ? (
                                        <TableHead className="min-w-36">
                                            <div className="flex items-center gap-1">
                                                <SortHead field="warrantyName" sort={sort} onSort={cycleSort}>Warranty</SortHead>
                                                <ColFilter field="warrantyTermId" options={warrantyTerms} colFilters={colFilters} onToggle={toggleColFilter} onClear={clearColFilter} onCreate={() => createMaster("warranty")} createLabel="warranty term" />
                                            </div>
                                        </TableHead>
                                    ) : null}
                                    {showCol("unit") ? (
                                        <TableHead className="w-24">
                                            <div className="flex items-center gap-1">
                                                <SortHead field="unitCode" sort={sort} onSort={cycleSort}>Unit</SortHead>
                                                <ColFilter field="unitId" options={units} noneOption={false} colFilters={colFilters} onToggle={toggleColFilter} onClear={clearColFilter} onCreate={() => createMaster("unit")} createLabel="unit" />
                                            </div>
                                        </TableHead>
                                    ) : null}
                                    {showCol("modelNo") ? <TableHead className="min-w-32"><SortHead field="modelNo" sort={sort} onSort={cycleSort}>Model No</SortHead></TableHead> : null}
                                    {showCol("barcode") ? <TableHead className="min-w-36"><SortHead field="barcode1" sort={sort} onSort={cycleSort}>Barcode</SortHead></TableHead> : null}
                                    {showCol("stock") ? (
                                        <TableHead className="w-24 text-right">
                                            <div className="flex items-center justify-end gap-1">
                                                <SortHead field="stock" sort={sort} onSort={cycleSort} align="right">Stock</SortHead>
                                                <ColFilter field="stock" options={[]} colFilters={colFilters} onToggle={toggleColFilter} onClear={clearColFilter} fixedItems={STOCK_FILTER_ITEMS} align="right" />
                                            </div>
                                        </TableHead>
                                    ) : null}
                                    {showCol("isActive") ? (
                                        <TableHead className="w-20 text-center">
                                            <div className="flex items-center justify-center gap-1">
                                                <SortHead field="isActive" sort={sort} onSort={cycleSort}>Active</SortHead>
                                                <ColFilter field="isActive" options={[]} colFilters={colFilters} onToggle={toggleColFilter} onClear={clearColFilter} booleanField align="right" />
                                            </div>
                                        </TableHead>
                                    ) : null}
                                    {showCol("requireSaleNote") ? (
                                        <TableHead className="w-24 text-center" title="Cashier must fill the POS line note before selling">
                                            <div className="flex items-center justify-center gap-1">
                                                <span>Req. note</span>
                                                <ColFilter field="requireSaleNote" options={[]} colFilters={colFilters} onToggle={toggleColFilter} onClear={clearColFilter} booleanField boolLabels={{ trueLabel: "Required", falseLabel: "Not required" }} align="right" />
                                            </div>
                                        </TableHead>
                                    ) : null}
                                    {!isEdit ? <TableHead className="w-24 text-right"> </TableHead> : null}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading ? (
                                    <TableRow>
                                        <TableCell colSpan={visibleColCount + 2} className="text-muted-foreground">Loading…</TableCell>
                                    </TableRow>
                                ) : pageRows.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={visibleColCount + 2} className="text-muted-foreground">
                                            {total === 0 ? "No products yet. Create a unit first, then add a product." : "No products match the search."}
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
                                                {...rowProps(r.id)}
                                                className={gridRowClass({
                                                    dirty: isDirty,
                                                    selected: isSelected,
                                                    active: isActiveRow(r.id),
                                                    inactive: !(val(r, "isActive") as boolean),
                                                    odd: i % 2 === 1,
                                                })}
                                            >
                                                {isEdit ? (
                                                    <TableCell className={frozenCell} style={{ left: 0 }}>
                                                        <Checkbox
                                                            checked={isSelected}
                                                            onCheckedChange={() => toggleRow(r.id)}
                                                            aria-label="Select row"
                                                        />
                                                    </TableCell>
                                                ) : null}
                                                <TableCell className={`text-muted-foreground text-sm align-top ${frozenCell}`} style={{ left: leftIndex }}>{pageStart + i + 1}</TableCell>
                                                {showCol("sku") ? <TableCell className={`font-mono text-xs align-top whitespace-nowrap ${frozenCell}`} style={{ left: leftSku }}>{r.sku}</TableCell> : null}

                                                {/* Name */}
                                                {showCol("name") ? (
                                                    <TableCell
                                                        className={`${frozenCell} ${GRID_FROZEN_EDGE} ${isEdit ? "min-w-48 align-top whitespace-normal wrap-break-word" : "font-medium align-top whitespace-normal wrap-break-word"}`}
                                                        style={{ left: leftName }}
                                                    >
                                                        {isEdit ? (
                                                            <div className="flex items-start gap-1">
                                                                {/* Name is derived, not typed — edit the Custom column or
                                                            the masters, or press regenerate. */}
                                                                <div className="flex-1 min-w-0 px-2 py-1 text-sm font-medium">
                                                                    {(val(r, "name") as string) || <span className="text-muted-foreground">—</span>}
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
                                                            <>
                                                                {r.name}
                                                                {r.movementClass && r.movementClass !== "REGULAR" && (
                                                                    <span
                                                                        className={`ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium align-middle ${r.movementClass === "NEW" ? "bg-blue-500/15 text-blue-600"
                                                                            : r.movementClass === "SLOW" ? "bg-amber-500/15 text-amber-600"
                                                                                : r.movementClass === "NON_MOVING" ? "bg-orange-500/15 text-orange-600"
                                                                                    : "bg-red-500/15 text-red-600"
                                                                            }`}
                                                                        title={r.daysSinceLastSale != null
                                                                            ? `Last sale ${r.daysSinceLastSale}d ago — movement class from the Reorder / Stock Health engine`
                                                                            : "Never sold — movement class from the Reorder / Stock Health engine"}
                                                                    >
                                                                        {r.movementClass === "NON_MOVING" ? "Non-moving"
                                                                            : r.movementClass === "NEW" ? "New"
                                                                                : r.movementClass === "SLOW" ? "Slow" : "Dead"}
                                                                    </span>
                                                                )}
                                                            </>
                                                        )}
                                                    </TableCell>
                                                ) : null}

                                                {/* Custom (namePart) — operator-curated portion that survives regenerate */}
                                                {showCol("namePart") ? (
                                                    <TableCell className={isEdit ? "min-w-40 align-top whitespace-normal wrap-break-word" : "text-sm align-top whitespace-normal wrap-break-word"}>
                                                        {isEdit ? (
                                                            <Input
                                                                value={(val(r, "namePart") as string | null) ?? ""}
                                                                onChange={(e) => patchWithRegen(r, { namePart: e.target.value.trim() === "" ? null : e.target.value })}
                                                                placeholder="1.5M Special…"
                                                                className="h-8"
                                                            />
                                                        ) : (
                                                            r.namePart ?? <span className="text-muted-foreground">—</span>
                                                        )}
                                                    </TableCell>
                                                ) : null}

                                                {/* Category */}
                                                {showCol("category") ? (
                                                    <TableCell className={isEdit ? "min-w-40 align-top whitespace-normal wrap-break-word" : "text-sm align-top whitespace-normal wrap-break-word"}>
                                                        {isEdit ? (
                                                            <CellSelect
                                                                value={val(r, "categoryId") as number | null}
                                                                options={categoryOptionsHier}
                                                                onChange={(v) => patchWithRegen(r, { categoryId: v })}
                                                                onCreate={() => createMaster("category")}
                                                            />
                                                        ) : (
                                                            r.category?.name ?? "—"
                                                        )}
                                                    </TableCell>
                                                ) : null}

                                                {/* Brand */}
                                                {showCol("brand") ? (
                                                    <TableCell className={isEdit ? "min-w-40 align-top whitespace-normal wrap-break-word" : "text-sm align-top whitespace-normal wrap-break-word"}>
                                                        {isEdit ? (
                                                            <CellSelect
                                                                value={val(r, "brandId") as number | null}
                                                                options={brands}
                                                                onChange={(v) => patchWithRegen(r, { brandId: v })}
                                                                onCreate={() => createMaster("brand")}
                                                            />
                                                        ) : (
                                                            r.brand?.name ?? "—"
                                                        )}
                                                    </TableCell>
                                                ) : null}

                                                {/* Group */}
                                                {showCol("group") ? (
                                                    <TableCell className={isEdit ? "min-w-40 align-top whitespace-normal wrap-break-word" : "text-sm align-top whitespace-normal wrap-break-word"}>
                                                        {isEdit ? (
                                                            <CellSelect
                                                                value={val(r, "groupId") as number | null}
                                                                options={groupOptionsHier}
                                                                onChange={(v) => patchWithRegen(r, { groupId: v })}
                                                                onCreate={() => createMaster("group")}
                                                            />
                                                        ) : (
                                                            r.group?.name ?? "—"
                                                        )}
                                                    </TableCell>
                                                ) : null}

                                                {/* Warranty */}
                                                {showCol("warranty") ? (
                                                    <TableCell className={isEdit ? "min-w-40 align-top whitespace-normal wrap-break-word" : "text-sm align-top whitespace-normal wrap-break-word"}>
                                                        {isEdit ? (
                                                            <CellSelect
                                                                value={val(r, "warrantyTermId") as number | null}
                                                                options={warrantyTerms}
                                                                onChange={(v) => patchWithRegen(r, { warrantyTermId: v })}
                                                                onCreate={() => createMaster("warranty")}
                                                            />
                                                        ) : (
                                                            r.warrantyTerm?.name ?? "—"
                                                        )}
                                                    </TableCell>
                                                ) : null}

                                                {/* Unit */}
                                                {showCol("unit") ? (
                                                    <TableCell className={isEdit ? "min-w-28 align-top" : "text-muted-foreground text-sm align-top whitespace-normal wrap-break-word"}>
                                                        {isEdit ? (
                                                            <CellSelect
                                                                value={val(r, "unitId") as number}
                                                                options={units}
                                                                onChange={(v) => v != null && patchWithRegen(r, { unitId: v })}
                                                                clearable={false}
                                                                onCreate={() => createMaster("unit")}
                                                            />
                                                        ) : (
                                                            r.unit.code
                                                        )}
                                                    </TableCell>
                                                ) : null}

                                                {/* Model No */}
                                                {showCol("modelNo") ? (
                                                    <TableCell className={isEdit ? "min-w-32 align-top whitespace-normal wrap-break-word" : "text-sm align-top whitespace-normal wrap-break-word"}>
                                                        {isEdit ? (
                                                            <Input
                                                                value={(val(r, "modelNo") as string | null) ?? ""}
                                                                onChange={(e) => patchWithRegen(r, { modelNo: e.target.value.trim() === "" ? null : e.target.value })}
                                                                className="h-8"
                                                            />
                                                        ) : (
                                                            r.modelNo ?? "—"
                                                        )}
                                                    </TableCell>
                                                ) : null}

                                                {/* Barcode */}
                                                {showCol("barcode") ? (
                                                    <TableCell className={isEdit ? "min-w-32 font-mono align-top whitespace-nowrap" : "font-mono text-sm align-top whitespace-nowrap"}>
                                                        {isEdit ? (
                                                            <Input
                                                                value={primaryBarcode(val(r, "codes")) ?? ""}
                                                                onChange={(e) => patch(r.id, { codes: withPrimaryBarcode(val(r, "codes") ?? [], e.target.value) })}
                                                                className="h-8 font-mono"
                                                            />
                                                        ) : (
                                                            primaryBarcode(r.codes) ?? "—"
                                                        )}
                                                    </TableCell>
                                                ) : null}

                                                {/* Stock (read-only in both modes — adjusted via vouchers / opening) */}
                                                {showCol("stock") ? (
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
                                                ) : null}

                                                {/* Active */}
                                                {showCol("isActive") ? (
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
                                                ) : null}

                                                {/* Require note on sale */}
                                                {showCol("requireSaleNote") ? (
                                                    <TableCell className="text-center">
                                                        {isEdit ? (
                                                            <Checkbox
                                                                checked={val(r, "requireSaleNote") as boolean}
                                                                onCheckedChange={(v) => patch(r.id, { requireSaleNote: !!v })}
                                                                aria-label="Require note on sale"
                                                            />
                                                        ) : (
                                                            r.requireSaleNote ? <Badge variant="outline">note</Badge> : <span className="text-muted-foreground text-xs">—</span>
                                                        )}
                                                    </TableCell>
                                                ) : null}

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
                </div>

                {isEdit && selected.size > 0 ? (
                    // Bulk-apply strip — part of the footer stack, not a floating
                    // card: full width, square, flush against the grid above.
                    <div className="-mt-4 flex flex-none flex-wrap items-center justify-center gap-2 border-t border-border bg-muted/40 px-2 py-1.5">
                        <span className="flex items-center gap-1.5 text-xs font-medium">
                            <Wand2 className="size-3.5" />
                            Apply to <strong>{selected.size}</strong>
                        </span>
                        <span className="h-5 w-px bg-border" aria-hidden />
                        <BulkApply label="Collection" options={categories} field="categoryId" onApply={applyToSelected} onCreate={() => createMaster("category")} />
                        <BulkApply label="Brand" options={brands} field="brandId" onApply={applyToSelected} onCreate={() => createMaster("brand")} />
                        <BulkApply label="Group" options={groups} field="groupId" onApply={applyToSelected} onCreate={() => createMaster("group")} />
                        <BulkApply label="Warranty" options={warrantyTerms} field="warrantyTermId" onApply={applyToSelected} onCreate={() => createMaster("warranty")} />
                        <BulkApply label="Unit" options={units} field="unitId" onApply={applyToSelected} clearable={false} onCreate={() => createMaster("unit")} />
                        <span className="h-5 w-px bg-border" aria-hidden />
                        <span className="flex items-center gap-1 text-[11px]">
                            <span className="text-muted-foreground">Req. note</span>
                            <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => applyBoolToSelected("requireSaleNote", true)}>On</Button>
                            <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => applyBoolToSelected("requireSaleNote", false)}>Off</Button>
                        </span>
                    </div>
                ) : null}

                <div className={`${isEdit && selected.size > 0 ? "" : "-mt-4 "}flex flex-none flex-wrap items-center justify-between gap-2 border-t border-border bg-background py-1 text-sm`}>
                    <div className="flex items-center gap-3 text-muted-foreground">
                        <span>{matched} match / {total} total</span>
                        {list.refreshing ? <span className="text-xs">Loading…</span> : null}
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
                        {isEdit && matched > pageRows.length ? (
                            <button
                                type="button"
                                className="text-xs underline-offset-2 hover:underline"
                                onClick={selectAllFiltered}
                            >
                                select all {matched} filtered
                            </button>
                        ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                        {pageCount > 1 ? (
                            <div className="flex items-center gap-1">
                                <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => list.setPage(1)}>«</Button>
                                <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => list.setPage(page - 1)}>‹</Button>
                                <span className="px-2 text-xs text-muted-foreground">{page} / {pageCount}</span>
                                <Button type="button" variant="outline" size="sm" disabled={page >= pageCount} onClick={() => list.setPage(page + 1)}>›</Button>
                                <Button type="button" variant="outline" size="sm" disabled={page >= pageCount} onClick={() => list.setPage(pageCount)}>»</Button>
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    );
}
