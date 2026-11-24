"use client";

/**
 * Update & Print Labels — the price-generation step that feeds the barcode labels.
 *
 * DATA (wired to the live engine):
 *   • Products + cost + Strategy/Computed voices ← GET /api/pricing-strategy/items?withSaleAge=1
 *   • Barcode bands ← OrgDefaults.barcodeBandsJson (GET /api/settings/org-defaults)
 *
 * A product has THREE price "voices":
 *   • Strategy — the winning pricing-strategy rule's output (engine `computedPricePaise`). LIVE.
 *   • Computed — cost × my margin. LIVE (floats with cost).
 *   • Sale Price — the sticky, hand-typed price (InvProduct.savedSalePricePaise).
 *
 * You pick which voice is the LOWEST price by CLICKING it (Sale Price: its "use
 * as lowest" link) — the highlighted one is the effective sale price, the floor.
 * POS bills at the BARCODE price; the gap down to the floor is the room for
 * bargaining and every discount (tier, loyalty, coupon, group rebate), which
 * all stop at the floor (priceFloor.ts). POS shows the floor as "Lowest".
 *
 * EDITABLE + persisted (PATCH /api/pricing-strategy/items/[id]): Computed price
 *   (typed; Margin % is derived from it, read-only) → marginPercent, Barcode
 *   (own input, saved with Save prices; violet = typed by hand) → barcodeManualPaise,
 * MRP → mrpPaise, Method → costMethod. Everything else (name,
 * taxonomy, stock, cost, GST, Strategy voice, days-since-sale, barcode) is
 * read-only/derived. Cost is GST-inclusive; because cost_incl × (1+margin) equals
 * the engine's cost_excl × (1+margin) × (1+gst), the Computed voice matches POS.
 *
 * The barcode price is SAVED (barcodeStore.ts): only a hand edit or "Update
 * barcode" (bands on the effective/selling price, MRP-capped) writes it, with its date
 * and gap. "Save prices" saves the Sale Price + source only. The barcode is
 * what POS charges; the floor is the least it may end up at. Each voice shows its own
 * AFTER-TAX profit (₹ + %) beneath the price, so all three can be compared.
 *
 *   voicePrice = cost_incl × (1 + margin% / 100)
 */

import { Fragment, type ReactNode, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCanOpenPage } from "@/shared/hooks/useCanOpenPage";
import axios from "axios";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { toast } from "sonner";
import type { PricingItem } from "@/modules/pricing-strategy/lib/pricingItem";
import { type BarcodeBand } from "@/shared/lib/pricing/barcodePrice";
import { productMatchesSearch } from "@/shared/lib/inventory";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { CrossRangeSlider } from "@/shared/components/CrossRangeSlider";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { localDateOf } from "@/modules/inventory/lib/labelItems";
import { useLabelPrintStore } from "@/store/labelPrintStore";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Barcode,
    Check,
    Filter,
    Loader2,
    Plus,
    Printer,
    RotateCcw,
    Save,
    Search,
    SlidersHorizontal,
} from "lucide-react";
import { useValueChange } from "@/shared/hooks/useValueChange";
import { useTableSort } from "@/shared/hooks/useTableSort";
import { SortHeader } from "@/shared/components/SortHeader";

import {
    COST_METHODS,
    ColKey,
    COLS,
    COL_TINT,
    Row,
    voiceToDb,
    itemToRow,
    setBarcodeBands,
    SortKey,
    SORT_TH,
    sortVal,
    RangeKey,
    RANGE_FIELDS,
    RANGE_GRID,
    RANGE_LABEL,
    FILTER_STORAGE_KEY,
    SOURCE_OPTIONS,
    numOrNull,
    inRange,
    barcodeCapped,
    saleCapped,
    marginDirty,
    mrpDirty,
    barcodeDirty,
    resetRow,
    rowDirty,
    stockQty,
    rangeVal,
} from "./_components/labelRowMath";
import { RowPersistPatch, ProductRow } from "./_components/ProductRow";

export default function GeneratePage() {
    const [rows, setRows] = useState<Row[]>([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState("");
    // Client-side pagination of the rendered rows (pageSize 0 = show All).
    const [pageSize, setPageSize] = useState(150);
    const [pageIndex, setPageIndex] = useState(0);
    // Top tab (All products / Selected product) + the working "selection".
    const [tab, setTab] = useState<"all" | "selected">("all");

    const router = useRouter();
    // "Go to Print" only for someone who may open Print labels (the page lock).
    const canOpen = useCanOpenPage();
    const searchParams = useSearchParams();
    // ?view=selected — arriving from the Print labels page to price the queued
    // products. Same shared queue, so the Selected tab already holds them.
    const view = searchParams.get("view");
    if (useValueChange(view, null) && view === "selected") setTab("selected");

    // ── Load real products (engine) + barcode bands (OrgDefaults) ─────────────
    // Merge preserves locally-edited sticky Sale-Price fields and any locally
    // added rows (negative ids) across a reload (e.g. after a cost-method change).
    const loadData = useCallback(() => Promise.all([
        axios.get<PricingItem[]>("/api/pricing-strategy/items?withSaleAge=1"),
        axios.get<{ barcodeBandsJson?: BarcodeBand[] }>("/api/settings/org-defaults"),
    ]).then(([itemsRes, odRes]) => {
            setBarcodeBands(Array.isArray(odRes.data.barcodeBandsJson) ? odRes.data.barcodeBandsJson : []);
            const mapped = itemsRes.data.map(itemToRow);
            setRows((prev) => {
                const byId = new Map(prev.map((r) => [r.id, r]));
                const merged = mapped.map((m) => {
                    const old = byId.get(m.id);
                    // A row with nothing unsaved takes the server's whole row — so a
                    // temporary Fixed Price that a purchase just ended shows at once.
                    return old && rowDirty(old)
                        ? { ...m, salePrice: old.salePrice, baseline: old.baseline, saleSource: old.saleSource, baseSource: old.baseSource,
                            margin: old.margin, baseMargin: old.baseMargin, mrp: old.mrp, baseMrp: old.baseMrp,
                            // An unsaved barcode survives a reload; a clean row takes the server's.
                            ...(barcodeDirty(old) ? { barcodeManual: old.barcodeManual, barcodeIsManual: old.barcodeIsManual, baseBarcode: m.baseBarcode, baseBarcodeIsManual: m.baseBarcodeIsManual } : {}) }
                        : m;
                });
                const locals = prev.filter((r) => r.id < 0); // keep locally-added rows
                return [...merged, ...locals];
            });
        })
        .catch(() => { toast.error("Failed to load products."); })
        .finally(() => setLoading(false)), []);
    useEffect(() => { loadData(); }, [loadData]);

    // Product rows, brands and categories behind the label picker are catalogue
    // data; a new SKU should be printable without reloading the screen. Not
    // "stock": every bill at any counter moves stock, and each one re-read the
    // whole catalogue under the person pricing. The Stock column catches up on
    // the next catalogue change or when the tab is looked at again. On a replica
    // the tables narrow the wake-up, so an unrelated sync cycle costs nothing.
    useRealtimeTopics(
        ["catalogue"],
        () => { loadData(); },
        true,
        ["InvProduct", "InvProductCode", "InvBrand", "InvCategory", "InvProductGroup"],
    );

    // Persist an editable field to InvProduct via the items PATCH. Local-only
    // rows (negative ids) are skipped. `reload` re-pulls the engine values when a
    // change alters the cost basis (cost method) so derived voices stay accurate.
    const queueMarkTouched = useLabelPrintStore((s) => s.markTouched);
    const persist = useCallback(async (
        id: number,
        patch: RowPersistPatch,
        opts?: { reload?: boolean },
    ) => {
        if (id < 0) return;
        try {
            const { data } = await axios.patch<{ barcodeManualPaise?: number | null; barcodeIsManual?: boolean; salePriceFrozenAt?: string | null }>(`/api/pricing-strategy/items/${id}`, patch);
            // The server owns the saved barcode (a barcode edit, or an MRP cut that
            // capped it) — take its price, manual flag and date back.
            if (data && "barcodeManualPaise" in data) {
                const next = {
                    barcodeManual: data.barcodeManualPaise != null ? (data.barcodeManualPaise / 100).toFixed(2) : "",
                    barcodeIsManual: !!data.barcodeIsManual,
                    savedAt: localDateOf(data.salePriceFrozenAt ?? null),
                };
                setRows((prev) => prev.map((r) => (
                    r.id === id && (r.barcodeManual !== next.barcodeManual || r.barcodeIsManual !== next.barcodeIsManual || r.savedAt !== next.savedAt)
                        ? { ...r, ...next } : r
                )));
                if (patch.barcodeManualPaise !== undefined) queueMarkTouched([id]);
            }
            if (opts?.reload) await loadData();
        } catch (e) {
            const msg = axios.isAxiosError(e) ? (e.response?.data as { error?: string } | undefined)?.error : null;
            toast.error(msg ?? "Failed to save change.");
        }
    }, [loadData, queueMarkTouched]);

    // The label queue lives in a module-level store, so the products picked here
    // are the SAME list the standalone Print labels page shows (and the other way
    // round). See src/store/labelPrintStore.ts.
    const queueIds = useLabelPrintStore((s) => s.ids);
    const queueAdd = useLabelPrintStore((s) => s.add);
    const queueRemove = useLabelPrintStore((s) => s.remove);
    const queueClear = useLabelPrintStore((s) => s.clear);
    const selectionIds = useMemo(() => new Set(queueIds), [queueIds]);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [fBrand, setFBrand] = useState("ALL");
    const [fCategory, setFCategory] = useState("ALL");
    const [fGroup, setFGroup] = useState("ALL");
    const [fMethod, setFMethod] = useState("ALL");
    const [fSource, setFSource] = useState("ALL");
    const [fBarcodeCapped, setFBarcodeCapped] = useState(false);
    const [fSaleCapped, setFSaleCapped] = useState(false);
    const [fInStock, setFInStock] = useState(false);
    // Threshold boxes: show rows where the metric exceeds x%.
    // Profit reduced & increased contradict → typing in one empties the other.
    const emptyRanges = (): Record<RangeKey, { min: string; max: string }> =>
        RANGE_FIELDS.reduce((a, f) => { a[f.key] = { min: "", max: "" }; return a; }, {} as Record<RangeKey, { min: string; max: string }>);
    const [ranges, setRanges] = useState<Record<RangeKey, { min: string; max: string }>>(emptyRanges);
    const setRange = (key: RangeKey, side: "min" | "max", val: string) =>
        setRanges((prev) => ({ ...prev, [key]: { ...(prev[key] ?? { min: "", max: "" }), [side]: val } }));
    // "none" = the server's own order; a third click (or "clear sort") comes back to it.
    const sortProps = useTableSort<SortKey | "none">("none", "asc");
    const { sortKey, sortDir, isDefaultSort, resetSort } = sortProps;

    // ── Saved filters (localStorage) ──────────────────────────────────────────
    // Hydrate once on mount (after SSR, so no hydration mismatch), then persist on
    // every change. `hydrated` batches with the restored setStates, so the persist
    // effect never fires with default values before the restore lands.
    const [hydrated, setHydrated] = useState(false);
    useEffect(() => {
        try {
            const raw = localStorage.getItem(FILTER_STORAGE_KEY);
            if (raw) {
                const s = JSON.parse(raw) as Record<string, unknown>;
                // eslint-disable-next-line react-hooks/set-state-in-effect -- restores the saved filters from localStorage once after mount (the server render has none); `hydrated` holds the persist effect back until it lands
                if (typeof s.query === "string") setQuery(s.query);
                if (typeof s.fBrand === "string") setFBrand(s.fBrand);
                if (typeof s.fCategory === "string") setFCategory(s.fCategory);
                if (typeof s.fGroup === "string") setFGroup(s.fGroup);
                if (typeof s.fMethod === "string") setFMethod(s.fMethod);
                if (typeof s.fSource === "string") setFSource(s.fSource);
                if (typeof s.fBarcodeCapped === "boolean") setFBarcodeCapped(s.fBarcodeCapped);
                if (typeof s.fSaleCapped === "boolean") setFSaleCapped(s.fSaleCapped);
                if (typeof s.fInStock === "boolean") setFInStock(s.fInStock);
                if (typeof s.filtersOpen === "boolean") setFiltersOpen(s.filtersOpen);
                if (s.ranges && typeof s.ranges === "object") {
                    setRanges({ ...emptyRanges(), ...(s.ranges as Record<RangeKey, { min: string; max: string }>) });
                }
            }
        } catch { /* corrupt blob → ignore, fall back to defaults */ }
        setHydrated(true);
        // run once

    }, []);
    useEffect(() => {
        if (!hydrated) return;
        try {
            localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({
                query, fBrand, fCategory, fGroup, fMethod, fSource,
                fBarcodeCapped, fSaleCapped, fInStock,
                ranges, filtersOpen,
            }));
        } catch { /* quota / disabled storage → silently skip */ }
    }, [hydrated, query, fBrand, fCategory, fGroup, fMethod, fSource, fBarcodeCapped, fSaleCapped, fInStock, ranges, filtersOpen]);

    // Whole-list work (filter, sort, dropdown options, slider ends, barcode
    // count) reads these deferred copies. A keystroke in one price box or the
    // search box then repaints its own row at once, and the 1400-row passes run
    // in a background render React can drop when the next key arrives.
    const deferredRows = useDeferredValue(rows);
    const deferredQuery = useDeferredValue(query);

    // Dynamic filter options — distinct values present in the data.
    const distinct = useCallback((pick: (r: Row) => string) =>
        [...new Set(deferredRows.map(pick).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [deferredRows]);
    const brands = useMemo(() => distinct((r) => r.brand), [distinct]);
    const categories = useMemo(() => distinct((r) => r.category), [distinct]);
    const groups = useMemo(() => distinct((r) => r.group), [distinct]);
    const methodOpts = useMemo(
        () => distinct((r) => r.method).map((code) => ({ value: code, label: COST_METHODS.find((m) => m.code === code)?.full ?? code })),
        [distinct],
    );
    const [selected, setSelected] = useState<Set<number>>(new Set());
    // Brand / Category / Group hidden by default — taxonomy noise; show via Columns.
    const [hidden, setHidden] = useState<Set<ColKey>>(new Set<ColKey>(["brand", "category", "group"]));
    const show = (k: ColKey) => !hidden.has(k);
    const toggleCol = (k: ColKey) =>
        setHidden((prev) => {
            const next = new Set(prev);
            if (next.has(k)) next.delete(k);
            else next.add(k);
            return next;
        });
    // Always-on columns: select, #, name, remove (4) + the visible toggleable ones.
    const colSpan = 4 + COLS.filter((c) => show(c.key)).length;

    // Filter (by name) + sort → the visible list.
    const visible = useMemo(() => {
        const q = deferredQuery.trim().toLowerCase();
        let v = deferredRows;
        if (q) v = v.filter((r) => productMatchesSearch(r, q));
        if (fBrand !== "ALL") v = v.filter((r) => r.brand === fBrand);
        if (fCategory !== "ALL") v = v.filter((r) => r.category === fCategory);
        if (fGroup !== "ALL") v = v.filter((r) => r.group === fGroup);
        if (fMethod !== "ALL") v = v.filter((r) => r.method === fMethod);
        if (fSource !== "ALL") v = v.filter((r) => r.saleSource === fSource);
        if (fBarcodeCapped) v = v.filter((r) => barcodeCapped(r));
        if (fSaleCapped) v = v.filter((r) => saleCapped(r));
        if (fInStock) v = v.filter((r) => stockQty(r) > 0);
        for (const f of RANGE_FIELDS) {
            const cell = ranges[f.key] ?? { min: "", max: "" };
            const lo = numOrNull(cell.min);
            const hi = numOrNull(cell.max);
            if (lo == null && hi == null) continue;
            v = v.filter((r) => inRange(rangeVal(r, f.key), lo, hi));
        }
        if (sortKey !== "none") {
            const key = sortKey;
            const dir = sortDir === "asc" ? 1 : -1;
            v = [...v].sort((a, b) => {
                const av = sortVal(a, key);
                const bv = sortVal(b, key);
                const c = typeof av === "string" && typeof bv === "string"
                    ? av.localeCompare(bv)
                    // Equal first: two blanks are both -Infinity, and -Infinity - -Infinity is NaN.
                    : av === bv ? 0 : (av as number) - (bv as number);
                return c * dir;
            });
        }
        return v;
    }, [deferredRows, deferredQuery, fBrand, fCategory, fGroup, fMethod, fSource, fBarcodeCapped, fSaleCapped, fInStock, ranges, sortKey, sortDir]);

    // Jump back to the first page whenever the filtered/sorted list or page size
    // changes, so you never land on a now-empty page.
    // While rendering, keyed on the values themselves (ranges / sort by content).
    if (useValueChange(JSON.stringify([query, fBrand, fCategory, fGroup, fMethod, fSource, fBarcodeCapped, fSaleCapped, fInStock, ranges, sortKey, sortDir, tab, pageSize]))) {
        setPageIndex(0);
    }

    // The Selected tab shows only the picked rows (still honouring the same filters/sort).
    const selectionRows = useMemo(() => visible.filter((r) => selectionIds.has(r.id)), [visible, selectionIds]);
    // The list the active tab actually renders. (Only the active tab's body mounts.)
    const listRows = tab === "selected" ? selectionRows : visible;
    // Paginate the rendered rows so the full catalogue stays responsive — the page
    // slice keeps the DOM small even when thousands match. pageSize 0 = show All.
    const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(listRows.length / pageSize));
    const safePage = Math.min(pageIndex, totalPages - 1);
    const pageStart = pageSize === 0 ? 0 : safePage * pageSize;
    // The list above may be a keystroke behind; each row shown is swapped for its
    // current copy so the box being typed in never lags (or loses a row just removed).
    const rowById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
    const pageRows = (pageSize === 0 ? listRows : listRows.slice(pageStart, pageStart + pageSize))
        .flatMap((r) => { const cur = rowById.get(r.id); return cur ? [cur] : []; });

    const toggleSel = useCallback((id: number) =>
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        }), []);
    const allSelected = listRows.length > 0 && listRows.every((r) => selected.has(r.id));
    const toggleAll = () =>
        setSelected((prev) => {
            const next = new Set(prev);
            if (allSelected) listRows.forEach((r) => next.delete(r.id));
            else listRows.forEach((r) => next.add(r.id));
            return next;
        });

    // Push the ticked rows into the selection (feeds the Selected product tab), then clear ticks.
    const addToSelection = () => {
        queueAdd([...selected]);
        setSelected(new Set());
    };
    const update = useCallback((id: number, patch: Partial<Row>) =>
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r))), []);
    // The row's trash button means different things on the two tabs. On Selected it
    // takes the product OUT of the print queue (it stays in the catalogue — that is
    // the only way to un-pick a product, since ticking is one-way). On All products
    // it drops the row from this working list as before.
    const remove = useCallback((id: number) => {
        if (tab === "selected") { queueRemove(id); return; }
        setRows((prev) => prev.filter((r) => r.id !== id));
        setSelected((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
        });
    }, [tab, queueRemove]);
    // "Save prices" = persist the Sale Price + selling voice for ticked / edited rows
    // (PUT /api/pricing-strategy/sale-price), then mark them saved locally
    // (baseline + decided profit). The barcode price and its date are NOT touched
    // here — only a barcode save moves them (barcodeStore.ts). Local-only rows
    // (negative ids) save in the UI only.
    const [freezing, setFreezing] = useState(false);
    // Only rows with an unsaved freeze decision (Sale Price edited or selling
    // source switched) are saved. A tick alone used to count too, lighting the
    // button for rows with nothing to save; ticks now feed Add to selection and
    // nothing else.
    const save = async () => {
        const checked = rows.filter(rowDirty);

        const payload = checked
            .filter((r) => r.id > 0)
            .map((r) => {
                const sp = numOrNull(r.salePrice);
                // The saved Sale Price (barcode tag) persists whenever one is
                // entered, regardless of which voice sells; a blank input clears it.
                return {
                    id: r.id,
                    effectiveSalePriceSource: voiceToDb(r.saleSource),
                    savedSalePricePaise: sp != null ? Math.round(sp * 100) : null,
                    ...(marginDirty(r) ? { marginPercent: numOrNull(r.margin) } : {}),
                    ...(barcodeDirty(r) ? { barcodeManualPaise: Math.round(numOrNull(r.barcodeManual)! * 100) } : {}),
                    ...(r.saleSource === "SAVED" ? { tempUntilPurchase: r.temp } : {}),
                    ...(r.tempCancel ? { tempCancel: true } : {}),
                    ...(mrpDirty(r) ? { mrpPaise: ((m) => (m != null ? Math.round(m * 100) : null))(numOrNull(r.mrp)) } : {}),
                };
            });
        setFreezing(true);
        try {
            // A typed barcode rides along; nothing else moves it (barcodeStore.ts).
            if (payload.length) await axios.put("/api/pricing-strategy/sale-price", { items: payload });
            setRows((prev) =>
                prev.map((r) => {
                    if (!rowDirty(r)) return r;
                    return { ...r, baseline: r.salePrice, baseSource: r.saleSource, baseMargin: r.margin, baseMrp: r.mrp, baseBarcode: r.barcodeManual, baseBarcodeIsManual: r.barcodeIsManual,
                        temp: r.saleSource === "SAVED" && r.temp, baseTemp: r.saleSource === "SAVED" && r.temp,
                        tempSetAt: r.saleSource === "SAVED" && r.temp ? (r.baseTemp ? r.tempSetAt : new Date().toISOString()) : "", tempCancel: false };
                }),
            );
            // Margin / MRP moved the Strategy price and maybe capped the barcode — take the server's.
            const bcIds = payload.filter((p) => "barcodeManualPaise" in p).map((p) => p.id);
            if (bcIds.length) queueMarkTouched(bcIds); // new barcode → reprint its label
            // A cancelled temporary price comes back from the server with its original choice + Fixed Price.
            if (payload.some((p) => "marginPercent" in p || "mrpPaise" in p || "barcodeManualPaise" in p || "tempCancel" in p)) void loadData();
            toast.success(`${payload.length} product${payload.length === 1 ? "" : "s"} saved.`);
        } catch (e) {
            const msg = axios.isAxiosError(e) ? (e.response?.data as { error?: string } | undefined)?.error : null;
            toast.error(msg ?? "Failed to save prices.");
        } finally {
            setFreezing(false);
        }
    };

    // Slider ends per range = the real spread over every loaded row (not just the
    // filtered ones, so the track does not jump while filtering).
    const rangeBounds = useMemo(() => {
        const out = {} as Record<RangeKey, { lo: number; hi: number; step: number } | null>;
        for (const f of RANGE_FIELDS) {
            let lo = Infinity, hi = -Infinity;
            for (const r of deferredRows) {
                const v = rangeVal(r, f.key);
                if (v == null || !isFinite(v)) continue;
                if (v < lo) lo = v;
                if (v > hi) hi = v;
            }
            if (f.key === "barcodeGap") { lo = Math.min(lo, 0); hi = Math.max(hi, 100); }
            if (!isFinite(lo) || !isFinite(hi) || hi <= lo) { out[f.key] = null; continue; }
            const span = hi - lo;
            const step = span > 2000 ? 10 : span > 20 ? 1 : 0.1;
            out[f.key] = { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step };
        }
        return out;
    }, [deferredRows]);

    const dirtyCount = rows.filter(rowDirty).length;
    // Rows the Save action will write — the edited ones (same as dirtyCount).
    const saveCount = dirtyCount;


    // Plain render fns (not components) so they don't remount on each keystroke.
    const filterSelect = (value: string, onChange: (v: string) => void, allLabel: string, options: { value: string; label: string }[]) => (
        <Select value={value} onValueChange={onChange}>
            <SelectTrigger size="sm" className="h-7 w-full bg-white text-xs dark:bg-background"><SelectValue /></SelectTrigger>
            <SelectContent>
                <SelectItem value="ALL">{allLabel}</SelectItem>
                {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
        </Select>
    );
    const labelled = (label: string, node: ReactNode) => (
        <div>
            <div className="mb-0.5 truncate text-[11px] font-medium text-muted-foreground">{label}</div>
            {node}
        </div>
    );
    // ── Filter card pieces ── compact, white boxes; a primary tint marks a
    // filter in use. Ranges are a two-thumb slider over the real spread of the
    // loaded rows, with the exact numbers typeable in the two small boxes.
    const fieldShell = (active: boolean) =>
        `flex h-7 items-center gap-1 rounded-md border bg-white px-1.5 transition-colors focus-within:ring-2 focus-within:ring-ring/40 dark:bg-background ${active ? "border-primary/70 ring-1 ring-primary/20" : "border-input"}`;
    const bareInput = "h-6 min-w-0 flex-1 border-0 bg-transparent px-0 text-right text-xs font-mono shadow-none focus-visible:ring-0 dark:bg-transparent";
    const unitTag = (u?: string) => (u ? <span className="shrink-0 text-[10px] text-muted-foreground">{u}</span> : null);

    // Small ↺ that clears one range (only shown while it is in use).
    const resetBtn = (key: RangeKey, side?: "min" | "max") => (
        <button
            type="button"
            title="Reset"
            aria-label="Reset"
            onClick={() => { if (side !== "max") setRange(key, "min", ""); if (side !== "min") setRange(key, "max", ""); }}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
            <RotateCcw className="size-3" />
        </button>
    );

    // Barcode gap: Below and Above are two SEPARATE filters, each its own line
    // with its own one-thumb slider (0–100% of the original gap).
    const gapSideInput = (side: "max" | "min", text: string) => {
        const b = rangeBounds.barcodeGap ?? { lo: 0, hi: 100, step: 1 };
        const raw = ranges.barcodeGap?.[side] ?? "";
        const v = numOrNull(raw);
        const active = v != null;
        return (
            <div key={side} className={`rounded-md border px-2 py-1.5 ${active ? "border-primary/40 bg-primary/5" : "border-transparent"}`}>
                <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] font-medium text-muted-foreground">{text}</span>
                    <span className="flex shrink-0 items-center gap-1">
                        {active ? resetBtn("barcodeGap", side) : null}
                        <div className={`${fieldShell(active)} w-16`}>
                            <Input inputMode="decimal" value={raw} onChange={(e) => setRange("barcodeGap", side, e.target.value)} placeholder="any" className={bareInput} />
                            {unitTag("%")}
                        </div>
                    </span>
                </div>
                <Slider
                    className="mt-2 mb-0.5"
                    min={b.lo}
                    max={b.hi}
                    step={b.step}
                    // "Below" fills from the left; an untouched slider sits at its "no limit" end.
                    value={[Math.max(b.lo, Math.min(b.hi, v ?? (side === "max" ? b.hi : b.lo)))]}
                    onValueChange={([x]) => setRange("barcodeGap", side, (side === "max" ? x >= b.hi : x <= b.lo) ? "" : String(x))}
                    aria-label={text}
                />
            </div>
        );
    };

    const rangeInput = (label: string, key: RangeKey, unit?: string) => {
        const b = rangeBounds[key];
        const lo = numOrNull(ranges[key]?.min ?? "");
        const hi = numOrNull(ranges[key]?.max ?? "");
        const active = lo != null || hi != null;
        const box = (side: "min" | "max") => (
            <div className={`${fieldShell(!!ranges[key]?.[side].trim())} w-[5.5rem]`}>
                <Input inputMode="decimal" value={ranges[key]?.[side] ?? ""} onChange={(e) => setRange(key, side, e.target.value)} placeholder={side} className={bareInput} />
                {unitTag(unit)}
            </div>
        );
        return (
            <div className={`rounded-md border px-2 py-1.5 ${active ? "border-primary/40 bg-primary/5" : "border-transparent"}`}>
                <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] font-medium text-muted-foreground" title="min more than max = everything OUTSIDE (≤ max or ≥ min)">
                        {label}
                        {lo != null && hi != null && lo > hi ? <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800 dark:bg-amber-950 dark:text-amber-200">outside</span> : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                        {active ? resetBtn(key) : null}
                        {box("min")}
                        {box("max")}
                    </span>
                </div>
                {b ? (
                    // Thumbs may cross: min > max keeps the outside (blue ends, amber middle).
                    <CrossRangeSlider
                        className="mt-1.5"
                        lo={b.lo}
                        hi={b.hi}
                        step={b.step}
                        min={lo ?? b.lo}
                        max={hi ?? b.hi}
                        onChange={(a, z) => {
                            // A thumb at its own end of the track means "no limit" on that side.
                            setRange(key, "min", a <= b.lo ? "" : String(a));
                            setRange(key, "max", z >= b.hi ? "" : String(z));
                        }}
                        ariaLabel={label}
                    />
                ) : null}
            </div>
        );
    };
    // On/off flag as a pill — reads better than a bare checkbox row.
    const flagChip = (label: string, on: boolean, set: (v: boolean) => void, hint: string) => (
        <button
            type="button"
            title={hint}
            aria-pressed={on}
            onClick={() => set(!on)}
            className={`inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "border-input bg-white text-foreground hover:bg-muted dark:bg-background"}`}
        >
            {on ? <Check className="size-3.5" /> : null}
            {label}
        </button>
    );
    const sectionTitle = (text: string) => <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">{text}</div>;

    const catActive = [fBrand, fCategory, fGroup, fMethod, fSource].filter((x) => x !== "ALL").length;
    const flagActive = [fBarcodeCapped, fSaleCapped, fInStock].filter(Boolean).length;
    const rangeActive = RANGE_FIELDS.filter((f) => ranges[f.key]?.min.trim() || ranges[f.key]?.max.trim()).length;
    const activeFilterCount = catActive + flagActive + rangeActive;
    const clearAllFilters = () => {
        setFBrand("ALL"); setFCategory("ALL"); setFGroup("ALL"); setFMethod("ALL"); setFSource("ALL");
        setFBarcodeCapped(false); setFSaleCapped(false); setFInStock(false);
        setRanges(emptyRanges());
    };

    // Inline tab switcher — lives in the toolbar row (no separate tabs row) so the
    // table gets the extra vertical space.
    const tabSwitcher = (
        <div className="flex shrink-0 items-center rounded-md border bg-muted/40 p-0.5 text-xs font-medium">
            <button
                type="button"
                onClick={() => setTab("all")}
                className={`rounded px-2.5 py-1 transition-colors ${tab === "all" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
                All products
            </button>
            <button
                type="button"
                onClick={() => setTab("selected")}
                className={`rounded px-2.5 py-1 transition-colors ${tab === "selected" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
                Selected{selectionIds.size > 0 ? ` (${selectionIds.size})` : ""}
            </button>
        </div>
    );

    // The product table body — shared by the "All products" and "Selected product"
    // tabs (same UI for now; "Selected product" will narrow the list later).
    const productBody = (
        <>
            {/* Toolbar: tab switcher + search + filters + the selection/print actions + columns */}
            <div className="mb-3 flex shrink-0 items-center gap-3">
                {tabSwitcher}
                <div className="relative">
                    <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search name / SKU…"
                        className="h-8 w-56 pl-7 text-xs"
                    />
                </div>
                <Button type="button" variant={filtersOpen ? "secondary" : "outline"} size="sm" className="h-8" onClick={() => setFiltersOpen((o) => !o)}>
                    <Filter className="size-3.5" /> Filters
                    {activeFilterCount > 0 ? (
                        <span className="ml-1 rounded bg-primary px-1 text-[10px] font-medium text-primary-foreground">{activeFilterCount}</span>
                    ) : null}
                </Button>
                <span className="text-xs text-muted-foreground">
                    {tab === "selected" ? `${listRows.length} in selection` : `${listRows.length} / ${rows.length} shown`}
                </span>
                {!isDefaultSort ? (
                    <button type="button" onClick={resetSort} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
                        clear sort
                    </button>
                ) : null}
                {/* Selection / print actions — pushed to the right, just before Columns. */}
                <div className="ml-auto flex items-center gap-3">
                    {tab === "all" ? (
                        <Button type="button" variant="outline" size="sm" className="h-8" onClick={addToSelection} disabled={selected.size === 0}>
                            <Plus className="size-4" /> Add to selection{selected.size > 0 ? ` (${selected.size})` : ""}
                        </Button>
                    ) : (
                        <>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8"
                                onClick={queueClear}
                                disabled={selectionIds.size === 0}
                                title="Empty the whole selection (the products stay in the catalogue)"
                            >
                                Clear selection
                            </Button>
                            {canOpen("/office/pricing-strategy/print-labels") && (
                                <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => router.push("/office/pricing-strategy/print-labels")} title="Open Print labels — the same products laid out as labels (you can add more there)">
                                    <Printer className="size-4" /> Go to Print{selectionIds.size > 0 ? ` (${selectionIds.size})` : ""}
                                </Button>
                            )}
                        </>
                    )}
                    <span className="text-xs text-muted-foreground">
                        {selected.size > 0
                            ? `${selected.size} ticked`
                            : dirtyCount === 0 ? "Prices saved" : `${dirtyCount} to save`}
                    </span>
                    <Button type="button" size="sm" className="h-8" onClick={save} disabled={saveCount === 0 || freezing} title="Save every edited row: Computed (margin), Fixed Price, MRP, Public Price and the selling choice. Method saves by itself as you change it.">
                        {freezing ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save prices{saveCount > 0 ? ` (${saveCount})` : ""}
                    </Button>
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button type="button" variant="outline" size="sm" className="h-8">
                            <SlidersHorizontal className="size-3.5" /> Columns
                            {hidden.size > 0 ? <span className="ml-1 text-[10px] text-muted-foreground">({COLS.length - hidden.size}/{COLS.length})</span> : null}
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuLabel className="text-xs">Show columns</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {COLS.map((c) => (
                            <DropdownMenuCheckboxItem
                                key={c.key}
                                checked={show(c.key)}
                                onCheckedChange={() => toggleCol(c.key)}
                                onSelect={(e) => e.preventDefault()}
                                className="text-xs"
                            >
                                {c.label}
                            </DropdownMenuCheckboxItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            {/* Collapsible filter card — categorical + numeric ranges */}
            {filtersOpen ? (
                <div className="mb-3 shrink-0 rounded-lg border bg-card shadow-sm">
                    <div className="flex items-center justify-between border-b px-3 py-1.5">
                        <span className="flex items-center gap-2 text-sm font-medium">
                            <Filter className="size-4 text-muted-foreground" /> Filters
                            {activeFilterCount > 0 ? <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">{activeFilterCount} on</span> : null}
                        </span>
                        {activeFilterCount > 0 ? (
                            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={clearAllFilters}>
                                <RotateCcw className="size-3.5" /> Clear all
                            </Button>
                        ) : null}
                    </div>
                    <div className="space-y-3 p-3">
                        <section>
                            {sectionTitle("Product")}
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                                {labelled("Brand", filterSelect(fBrand, setFBrand, "All", brands.map((b) => ({ value: b, label: b }))))}
                                {labelled("Collection", filterSelect(fCategory, setFCategory, "All", categories.map((c) => ({ value: c, label: c }))))}
                                {labelled("Group", filterSelect(fGroup, setFGroup, "All", groups.map((g) => ({ value: g, label: g }))))}
                                {labelled("Method", filterSelect(fMethod, setFMethod, "All", methodOpts))}
                                {labelled("Sells at", filterSelect(fSource, setFSource, "All", SOURCE_OPTIONS))}
                            </div>
                        </section>
                        <section>
                            {sectionTitle("Quick checks")}
                            <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                                <div className="flex flex-wrap gap-2">
                                    {flagChip("Public Price capped", fBarcodeCapped, setFBarcodeCapped, "MRP is squeezing the Public Price")}
                                    {flagChip("Selling price capped", fSaleCapped, setFSaleCapped, "Selling price held down at the Public Price / MRP ceiling")}
                                    {flagChip("In stock only", fInStock, setFInStock, "Hide products with no stock")}
                                </div>
                                {/* Barcode gap pair beside the toggles (owner). */}
                                <div className="grid min-w-[20rem] flex-1 grid-cols-1 gap-x-3 sm:grid-cols-2">
                                    {gapSideInput("max", "Below original gap")}
                                    {gapSideInput("min", "Above original gap")}
                                </div>
                            </div>
                        </section>
                        <section>
                            {sectionTitle("Ranges")}
                            <div className="grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-3">
                                {RANGE_GRID.map((k) => <Fragment key={k}>{rangeInput(RANGE_LABEL[k].label, k, RANGE_LABEL[k].unit)}</Fragment>)}
                            </div>
                        </section>
                    </div>
                </div>
            ) : null}

            {/* Flex-fill scroll box: it takes the leftover vertical space (toolbar +
                filter card are shrink-0 above it) and scrolls BOTH axes itself, so
                ONLY the rows scroll — the page never does. The horizontal scrollbar
                stays pinned at its bottom and the sticky header keeps the column row
                visible while rows scroll under it. */}
            <div className="min-h-0 flex-1 overflow-auto rounded-sm border *:data-[slot=table-container]:overflow-x-visible">
                {/* Compact density: tighter than the default shadcn cell padding so the
                    grid fits more columns and the Product name gets the leftover width. */}
                <Table className="[&_th]:h-9 [&_th]:px-2 [&_td]:px-2 [&_td]:py-1">
                    <TableHeader className="sticky top-0 z-20 bg-background [&_th]:bg-background [&_tr]:border-b [&_th]:shadow-[inset_0_-1px_0_var(--border)]">
                        <TableRow>
                            <TableHead className="w-8">
                                <div className="flex items-center gap-1">
                                    <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all visible rows" />
                                    {/* Reset all: every unsaved row in the whole list (the Save count), not just this page. */}
                                    {dirtyCount > 0 ? (
                                        <button
                                            type="button"
                                            onClick={() => setRows((prev) => prev.map((x) => (rowDirty(x) ? resetRow(x) : x)))}
                                            className="rounded-full p-0.5 text-amber-600 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/40"
                                            title={`Reset all ${dirtyCount} unsaved row${dirtyCount === 1 ? "" : "s"}`}
                                            aria-label="Reset all unsaved rows"
                                        >
                                            <RotateCcw className="size-3.5" />
                                        </button>
                                    ) : null}
                                </div>
                            </TableHead>
                            <TableHead className="w-8 text-xs">#</TableHead>
                            <SortHeader k="name" label="Product name" className={`${SORT_TH} w-full min-w-[240px]`} {...sortProps} />
                            {show("brand") ? <SortHeader k="brand" label="Brand" className={SORT_TH} {...sortProps} /> : null}
                            {show("category") ? <SortHeader k="category" label="Collection" className={SORT_TH} {...sortProps} /> : null}
                            {show("group") ? <SortHeader k="group" label="Group" className={SORT_TH} {...sortProps} /> : null}
                            {show("stock") ? <SortHeader k="stock" label="Stock" align="right" firstDir="desc" className={`${SORT_TH} ${COL_TINT.stock}`} {...sortProps} /> : null}
                            {show("cost") ? <SortHeader k="cost" label="Cost (incl)" align="right" firstDir="desc" className={`${SORT_TH} ${COL_TINT.cost}`} {...sortProps} /> : null}
                            {show("margin") ? <TableHead className={`text-right text-xs ${COL_TINT.margin}`} title="Worked out from the Computed price">Margin %</TableHead> : null}
                            {show("computed") ? <SortHeader k="computed" label="Computed" align="right" firstDir="desc" title="Type a price — Margin % is worked out from it. Saves with Save prices." className={`${SORT_TH} ${COL_TINT.computed}`} {...sortProps} /> : null}
                            {show("strategy") ? <SortHeader k="strategy" label="Strategy" align="right" firstDir="desc" title="Set on the Strategy page" className={`${SORT_TH} ${COL_TINT.strategy}`} {...sortProps} /> : null}
                            {show("sale") ? <SortHeader k="saved" label="Fixed Price" align="right" firstDir="desc" title="Your fixed price — it never moves by itself. Saves with Save prices." className={`${SORT_TH} ${COL_TINT.sale}`} {...sortProps} /> : null}
                            {show("mrp") ? <TableHead className={`text-right text-xs ${COL_TINT.mrp}`} title="Type the MRP. Saves with Save prices.">MRP</TableHead> : null}
                            {show("barcode") ? <SortHeader k="barcode" label={<span className="inline-flex items-center gap-1"><Barcode className="size-3.5" aria-hidden />Public Price</span>} align="right" firstDir="desc" title="Price printed on the label (barcode). Typed only — nothing changes it on its own. Saves with Save prices." className={`${SORT_TH} ${COL_TINT.barcode}`} {...sortProps} /> : null}
                            <TableHead className="w-8" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {listRows.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={colSpan} className="py-8 text-center text-sm text-muted-foreground">
                                    {loading ? (
                                        <span className="inline-flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Loading products…</span>
                                    ) : tab === "selected"
                                        ? "No products in selection — tick rows in All products and click Add to selection."
                                        : `No products match “${query}”.`}
                                </TableCell>
                            </TableRow>
                        ) : null}
                        {pageRows.map((r, i) => (
                            <ProductRow
                                key={r.id}
                                r={r}
                                index={pageStart + i}
                                hidden={hidden}
                                selected={selected.has(r.id)}
                                onUpdate={update}
                                onPersist={persist}
                                onToggleSel={toggleSel}
                                onRemove={remove}
                                removeTitle={tab === "selected" ? "Remove from selection" : "Remove from this list"}
                            />
                        ))}
                    </TableBody>
                </Table>
            </div>
            {/* Pager — fixed below the scrolling rows; reaches the whole catalogue. */}
            <div className="mt-2 flex shrink-0 items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                    {listRows.length === 0
                        ? "No rows"
                        : pageSize === 0
                            ? `Showing all ${listRows.length}`
                            : `${pageStart + 1}–${Math.min(pageStart + pageSize, listRows.length)} of ${listRows.length}`}
                </span>
                <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1 text-xs text-muted-foreground">
                        Page size
                        <select
                            value={pageSize}
                            onChange={(e) => setPageSize(Number(e.target.value))}
                            className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
                        >
                            <option value={50}>50</option>
                            <option value={150}>150</option>
                            <option value={300}>300</option>
                            <option value={0}>All</option>
                        </select>
                    </label>
                    {pageSize !== 0 && totalPages > 1 ? (
                        <div className="flex items-center gap-1">
                            <Button type="button" variant="outline" size="sm" className="h-8" disabled={safePage === 0} onClick={() => setPageIndex(0)}>«</Button>
                            <Button type="button" variant="outline" size="sm" className="h-8" disabled={safePage === 0} onClick={() => setPageIndex(safePage - 1)}>‹</Button>
                            <span className="px-2 text-xs text-muted-foreground">{safePage + 1} / {totalPages}</span>
                            <Button type="button" variant="outline" size="sm" className="h-8" disabled={safePage >= totalPages - 1} onClick={() => setPageIndex(safePage + 1)}>›</Button>
                            <Button type="button" variant="outline" size="sm" className="h-8" disabled={safePage >= totalPages - 1} onClick={() => setPageIndex(totalPages - 1)}>»</Button>
                        </div>
                    ) : null}
                </div>
            </div>
        </>
    );

    // This page is the PRICING half of the label job — the table, and nothing else.
    // Laying the labels out and printing them lives on its own page (Pricing
    // Strategy → Print labels), working off the same shared queue.
    return (
        <div className="flex h-full flex-col overflow-hidden px-4 pt-3 pb-3">
            <div className="flex min-h-0 flex-1 flex-col">{productBody}</div>
        </div>
    );
}
