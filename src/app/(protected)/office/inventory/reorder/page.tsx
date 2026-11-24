"use client";

// Reorder Status — Tally's "Reorder Levels" screen done with the complete
// formula (sampling window and coverage horizon kept separate):
//
//   reorder level = avg daily usage (class-driven window) × lead time (days)
//   threshold     = max(reorder level, manual floor)
//   LOW           = threshold > 0 && available (stock − reserved) <= threshold
//                   (no reorder point → no opinion: a never-sold item with no
//                   manual floor stays silent instead of firing 0 <= 0)
//   shortfall     = threshold − available            what the SHELF needs
//   order qty     = max(shortfall, MOQ)               what the SUPPLIER sells
//                   (pack/case rounding: orderPackQty is wired server-side —
//                   see suggestedOrderQty() in reorder.ts — UI input hidden
//                   for now, MOQ alone covers today's need)
//
// The movement class (movementClass.ts: recency vs group→category→org bands)
// decides the treatment — Regular = red LOW (buy), Slow = amber REVIEW, New =
// floor only, Dead / Non-moving / In-house = the collapsed "Skipped" section
// with per-row reasons. Skipped is stated, never silent.
//
// Cutting across those, the collapsed "Untouched" section holds catalogue
// entries nobody has ever used (no ledger row ever + no stock + no opening +
// no manual floor). Separate from Skipped on purpose — Dead sold once and
// stopped, Untouched never started — and its Min-floor cell is the way out:
// type a floor and the item rejoins the main table with a live signal.
//
// Two tabs:
//   • Item wise — one row per product; lead time, floor + MOQ edited inline
//     (PATCH /api/inventory/products/:id). View select pivots the list
//     Group / Category / Brand-wise with expandable sections (stock-summary
//     pattern) so "order hard disks" doesn't mean scrolling 3000 rows.
//   • Smart — substitute bands: items in the same leaf product group whose
//     last-inward COST sits within x% pool their demand (Enter UPS ≈ Frontech
//     UPS). BOM outputs (in-house packs) are dropped — the parent carries the
//     buy signal. Member rows show cost + margin%.
//
// Funnel multi-select filters (Group / Category / Brand — products-page
// pattern) apply to BOTH tabs.

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Filter, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { BreadcrumbBar } from "@/shared/components/BreadcrumbBar";
import { SortHeader } from "@/shared/components/SortHeader";
import { useTableSort, useEscape } from "@/shared/hooks";
import { extractApiError } from "@/shared/lib/api";
import { gridRowClass } from "@/shared/lib/format";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { productMatchesSearch } from "@/shared/lib/inventory";
import { confirmAction } from "@/shared/lib/ui/confirmStore";
import { useValueChange } from "@/shared/hooks/useValueChange";
import {
    ReorderRow,
    Band,
    Report,
    FilterField,
    View,
    SortKey,
    ALL_BRANCHES,
    NONE_KEY,
    fmtQty,
    fmtCost,
    FIELD_LABELS,
    NONE_LABELS,
    fieldValue,
    buildFilterOptions,
    compareReorderRows,
    groupItemRows,
    buildBandSections,
} from "./_components/reorderMath";
import { ClassBadge, FilterBox } from "./_components/ReorderParts";

export default function ReorderPage() {
    const router = useRouter();
    useEscape(() => router.back());
    const [data, setData] = useState<Report | null>(null);
    const [loading, setLoading] = useState(true);
    const [branchId, setBranchId] = useState("");
    const [lowOnly, setLowOnly] = useState(false);
    const [search, setSearch] = useState("");
    const [tab, setTab] = useState<"items" | "smart">("items");
    const [tolerance, setTolerance] = useState(20);
    const [skippedOpen, setSkippedOpen] = useState(false);
    const [untouchedOpen, setUntouchedOpen] = useState(false);
    // Default "signal" reproduces the server order, so the table looks
    // untouched until a header is clicked. Third click on a column returns here.
    const { sortKey, sortDir, toggleSort, isDefaultSort, resetSort } = useTableSort<SortKey>("signal", "desc");
    const sortProps = { sortKey, sortDir, toggleSort };
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [view, setView] = useState<View>("item");
    const [sections, setSections] = useState<Set<string>>(new Set());
    const [filters, setFilters] = useState<Map<FilterField, Set<string>>>(new Map());
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [bulkLead, setBulkLead] = useState("");
    const [bulkFloor, setBulkFloor] = useState("");
    const [bulkMoq, setBulkMoq] = useState("");
    const [bulkApplying, setBulkApplying] = useState(false);
    /// Manually ticked rows. Empty = bulk targets ALL shown rows; ticking
    /// narrows the target (filter → select all → untick the exceptions).
    const [selected, setSelected] = useState<Set<number>>(new Set());

    const fetchReport = useCallback(() => {
        const params = new URLSearchParams();
        if (branchId) params.set("branchId", branchId);
        if (tab === "smart") { params.set("grouped", "1"); params.set("tolerance", String(tolerance)); }
        const qs = params.toString();
        return axios.get<Report>(`/api/inventory/reports/reorder${qs ? `?${qs}` : ""}`)
            .then((res) => setData(res.data))
            .catch((err) => { toast.error(extractApiError(err, "Failed to load reorder report")); })
            .finally(() => setLoading(false));
    }, [branchId, tab, tolerance]);
    const load = useCallback(() => {
        setLoading(true);
        return fetchReport();
    }, [fetchReport]);

    // A new branch / tab / tolerance shows the spinner from its first render.
    if (useValueChange(fetchReport)) setLoading(true);
    useEffect(() => { void fetchReport(); }, [fetchReport]);
    // Sales and inward move `stock`; floors and lead times move `catalogue`.
    useRealtimeTopics(["stock", "catalogue"], () => { void load(); });

    // Inline edit of leadTimeDays / lowStockThreshold — PATCH then reload so
    // the computed level/threshold columns stay server-authoritative.
    async function saveField(
        id: number,
        field: "leadTimeDays" | "lowStockThreshold" | "orderPackQty" | "minOrderQty",
        raw: string,
    ) {
        const trimmed = raw.trim();
        // Blank clears the nullable fields (lead time → org default, pack/MOQ →
        // supplier sells loose / no floor). lowStockThreshold is non-null, so a
        // blank there simply means "no change".
        const value = trimmed === ""
            ? (field === "lowStockThreshold" ? undefined : null)
            : Math.max(0, parseInt(trimmed, 10) || 0);
        if (value === undefined) return;
        const current = data?.rows.find((r) => r.id === id);
        const currentValue = current && (
            field === "leadTimeDays" ? current.ownLeadTimeDays
                : field === "lowStockThreshold" ? current.lowStockThreshold
                    : field === "orderPackQty" ? current.orderPackQty
                        : current.minOrderQty
        );
        if (current && currentValue === value) return;
        try {
            await axios.patch(`/api/inventory/products/${id}`, { [field]: value });
            toast.success("Saved");
            await load();
        } catch (err) {
            toast.error(extractApiError(err, "Failed to save"));
        }
    }


    // ── Filters ───────────────────────────────────────────────────────────────
    const toggleFilter = (field: FilterField, key: string) =>
        setFilters((prev) => {
            const next = new Map(prev);
            const set = new Set(next.get(field) ?? []);
            if (set.has(key)) set.delete(key); else set.add(key);
            if (set.size === 0) next.delete(field); else next.set(field, set);
            return next;
        });
    const clearFilter = (field: FilterField) =>
        setFilters((prev) => {
            const next = new Map(prev);
            next.delete(field);
            return next;
        });
    const anyFilter = filters.size > 0;


    const filterOptions = useMemo(() => buildFilterOptions(data?.rows ?? []), [data]);

    const rowById = useMemo(() => new Map((data?.rows ?? []).map((r) => [r.id, r])), [data]);

    const q = search.trim().toLowerCase();
    const passesFilters = useCallback((r: ReorderRow): boolean => {
        if (q && !productMatchesSearch(r, q)) return false;
        for (const [field, set] of filters) {
            const v = fieldValue(r, field);
            if (!set.has(v ?? NONE_KEY)) return false;
        }
        return true;
    }, [q, filters]);

    // Considered rows (Regular / New / Slow) — the main table. Untouched leaves
    // with skipped: a catalogue entry nobody has ever traded is not a reorder
    // decision, and 751 of them buried the ~600 rows that are.
    // Row comparator for the clickable headers. Text sorts case-insensitively
    // with nulls LAST in both directions (an item with no brand shouldn't
    // outrank one that has a brand just because "" < "A"); numbers sort
    // numerically. Ties fall back to name so the order is stable across
    // renders — without that, equal rows can swap places on every re-render.
    const compareRows = useCallback((a: ReorderRow, b: ReorderRow): number => compareReorderRows(a, b, sortKey, sortDir), [sortKey, sortDir]);

    // Sorted HERE rather than per-view, so the Group/Category/Brand section
    // views inherit the active header sort instead of overriding it.
    // `.sort()` mutates, so it runs on the array `.filter()` just produced.
    const itemRows = useMemo(
        () => (data?.rows ?? []).filter((r) =>
            r.signal !== "skipped" && r.signal !== "untouched" && (!lowOnly || r.isLow) && passesFilters(r))
            .sort(compareRows),
        [data, lowOnly, passesFilters, compareRows],
    );

    // Bulk-apply lead time / floor (POST /api/inventory/products/bulk-reorder).
    // Target = the ticked rows among those shown; nothing ticked = all shown.
    // clearLead=true resets the targets' lead override back to the org default.
    async function bulkApply(clearLead = false) {
        const shown = itemRows.map((r) => r.id);
        const ids = selected.size > 0 ? shown.filter((id) => selected.has(id)) : shown;
        if (ids.length === 0) { toast.error("No items to apply to"); return; }
        const lead = clearLead ? null
            : bulkLead.trim() === "" ? undefined
                : Math.max(0, parseInt(bulkLead, 10) || 0);
        const num = (raw: string) => (clearLead || raw.trim() === "" ? undefined : Math.max(0, parseInt(raw, 10) || 0));
        const floor = num(bulkFloor);
        const moq = num(bulkMoq);
        if (lead === undefined && floor === undefined && moq === undefined) {
            toast.error("Type a lead time, min floor or MOQ first");
            return;
        }
        const what = clearLead
            ? "reset lead time to org default"
            : [
                lead !== undefined ? `lead time ${lead}d` : null,
                floor !== undefined ? `min floor ${floor}` : null,
                moq !== undefined ? `MOQ ${moq}` : null,
            ].filter(Boolean).join(" + ");
        const scope = selected.size > 0 ? "selected" : "shown";
        if (!(await confirmAction({ title: `Apply ${what} to ${ids.length} ${scope} item(s)?`, confirmLabel: "Apply", destructive: false }))) return;
        setBulkApplying(true);
        try {
            const res = await axios.post<{ updated: number }>("/api/inventory/products/bulk-reorder", {
                productIds: ids,
                ...(lead !== undefined ? { leadTimeDays: lead } : {}),
                ...(floor !== undefined ? { lowStockThreshold: floor } : {}),
                ...(moq !== undefined ? { minOrderQty: moq } : {}),
            });
            toast.success(`Updated ${res.data.updated} item(s)`);
            setBulkLead(""); setBulkFloor(""); setBulkMoq("");
            setSelected(new Set());
            await load();
        } catch (err) {
            toast.error(extractApiError(err, "Bulk apply failed"));
        } finally {
            setBulkApplying(false);
        }
    }

    // Untouched — created but never used. Its own section, NOT merged into
    // Skipped: "Dead" would misname them (dead sold once and stopped).
    const untouchedRows = useMemo(
        () => (data?.rows ?? []).filter((r) => r.signal === "untouched" && passesFilters(r)),
        [data, passesFilters],
    );
    // Skipped rows (Dead / Non-moving / In-house) — stated, never silent.
    const skippedRows = useMemo(
        () => (data?.rows ?? []).filter((r) => r.signal === "skipped" && passesFilters(r)),
        [data, passesFilters],
    );

    // ── Row selection (bulk-apply target) ─────────────────────────────────────
    const shownSelectedCount = useMemo(
        () => itemRows.reduce((n, r) => n + (selected.has(r.id) ? 1 : 0), 0),
        [itemRows, selected],
    );
    const allShownSelected = itemRows.length > 0 && shownSelectedCount === itemRows.length;
    const toggleRowSelect = (id: number) =>
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    const toggleSelectAllShown = () =>
        setSelected((prev) => {
            const next = new Set(prev);
            if (allShownSelected) for (const r of itemRows) next.delete(r.id);
            else for (const r of itemRows) next.add(r.id);
            return next;
        });

    // ── Hierarchy sections (Item tab, view ≠ item) — stock-summary pattern ────
    const grouped = useMemo(() => groupItemRows(itemRows, view), [itemRows, view]);

    const bandRows = useMemo(
        () => (data?.bands ?? []).filter((b) =>
            (!lowOnly || b.isLow) &&
            (!(q || anyFilter) || b.productIds.some((id) => { const r = rowById.get(id); return r ? passesFilters(r) : false; })),
        ),
        [data, lowOnly, q, anyFilter, rowById, passesFilters],
    );

    // ── Smart-tab sections (view ≠ band-wise) ────────────────────────────────
    // Group view: a band has exactly one home (banding never crosses a group).
    // Brand / Category views: a band appears under EVERY value its members
    // carry — deliberate duplication, the supplier-order view ("ordering
    // Frontech today: which shortfalls can that order fill?"). Never sum
    // shortfall across sections — the same band repeats.
    const bandSections = useMemo(() => (tab !== "smart" ? [] : buildBandSections(bandRows, view, rowById)), [tab, view, bandRows, rowById]);

    // Auto-expand every section whenever the active section set changes
    // (stock-summary pattern) — collapse individually or via the global toggle.
    const activeSectionNames = useMemo(
        () => (tab === "items" ? grouped.map((g) => g.name) : bandSections.map((s) => s.name)),
        [tab, grouped, bandSections],
    );
    // Keyed on the names themselves, not the array: a recomputed list with the
    // same sections must not re-expand what the user just collapsed.
    if (useValueChange(activeSectionNames.join("\u0000"), "") && activeSectionNames.length > 0) {
        setSections(new Set(activeSectionNames));
    }

    const toggleSection = (name: string) =>
        setSections((prev) => {
            const next = new Set(prev);
            if (next.has(name)) next.delete(name); else next.add(name);
            return next;
        });
    const allExpanded = activeSectionNames.length > 0 && activeSectionNames.every((n) => sections.has(n));
    const toggleAllSections = () => {
        if (allExpanded) setSections(new Set());
        else setSections(new Set(activeSectionNames));
    };

    const toggleExpand = (key: string) =>
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });

    const bandLabel = (b: Band): string => {
        if (b.productIds.length === 1) return rowById.get(b.productIds[0])?.name ?? "—";
        const range = b.costMinPaise === b.costMaxPaise
            ? fmtCost(b.costMinPaise)
            : `${fmtCost(b.costMinPaise)}–${fmtCost(b.costMaxPaise)}`;
        return `${b.groupName ?? "Ungrouped"} · cost ${range}`;
    };

    const lowCount = tab === "smart"
        ? (data?.bands ?? []).filter((b) => b.isLow).length
        : data?.lowCount ?? 0;

    const renderItemRow = (r: ReorderRow, indent = false) => (
        <tr key={r.id} className={`border-b last:border-0 ${gridRowClass({ selected: selected.has(r.id), attention: r.isLow })}`}>
            <td className="w-8 px-2 py-2 text-center">
                <input
                    type="checkbox"
                    aria-label={`Select ${r.name}`}
                    checked={selected.has(r.id)}
                    onChange={() => toggleRowSelect(r.id)}
                />
            </td>
            <td className={`px-3 py-2 ${indent ? "pl-9" : ""}`}>
                <span className="font-medium text-foreground">{r.name}</span>
                <span className="ml-2 font-mono text-xs text-muted-foreground">{r.sku}</span>
                <ClassBadge movementClass={r.movementClass} blip={r.blip} />
                {r.inHouse && (
                    <span className="ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium bg-sky-500/15 text-sky-600" title="BOM output — produced in-house. LOW here means: go pack/assemble, not purchase.">
                        In-house
                    </span>
                )}
            </td>
            <td className="px-3 py-2 text-right font-mono">{fmtQty(r.stock)}{r.unit ? ` ${r.unit}` : ""}</td>
            <td className="px-3 py-2 text-right font-mono text-muted-foreground">{r.reserved > 0 ? fmtQty(r.reserved) : "—"}</td>
            <td className="px-3 py-2 text-right font-mono font-semibold">{fmtQty(r.available)}</td>
            <td
                className="px-3 py-2 text-right font-mono"
                title={r.usageWindowDays > 0
                    ? `Organic usage over ${r.usageWindowDays}d · ${r.activeDays} organic sale day(s)${r.clearanceDays > 0 ? ` · ${r.clearanceDays} clearance day(s) excluded` : ""}${r.daysSinceLastSale != null ? ` · last organic sale ${r.daysSinceLastSale}d ago` : ""}`
                    : undefined}
            >
                {r.avgDailyUsage > 0 ? r.avgDailyUsage.toFixed(2) : "—"}
                {r.clearanceDays > 0 && (
                    <span className="ml-1 rounded px-1 py-0.5 text-[10px] font-medium bg-purple-500/15 text-purple-600" title={`${r.clearanceDays} day(s) of clearance-priced sales in the window — excluded from demand`}>
                        clr
                    </span>
                )}
            </td>
            <td className="px-3 py-2 text-right">
                <Input
                    key={`lt-${r.id}-${r.ownLeadTimeDays ?? ""}`}
                    className="h-7 w-16 ml-auto text-right font-mono text-xs"
                    inputMode="numeric"
                    placeholder={String(r.leadTimeDays)}
                    defaultValue={r.ownLeadTimeDays ?? ""}
                    onBlur={(e) => void saveField(r.id, "leadTimeDays", e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                />
            </td>
            <td
                className="px-3 py-2 text-right font-mono"
                title={`${r.avgDailyUsage.toFixed(2)}/day × ${r.leadTimeDays}d = ${r.reorderLevel} · floor ${r.lowStockThreshold} → threshold ${r.threshold}`}
            >
                {fmtQty(r.reorderLevel)}
            </td>
            <td className="px-3 py-2 text-right">
                <Input
                    key={`fl-${r.id}-${r.lowStockThreshold}`}
                    className="h-7 w-16 ml-auto text-right font-mono text-xs"
                    inputMode="numeric"
                    defaultValue={r.lowStockThreshold}
                    onBlur={(e) => void saveField(r.id, "lowStockThreshold", e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                />
            </td>
            <td className="px-3 py-2 text-right font-mono text-destructive">
                {r.shortfall > 0 ? fmtQty(r.shortfall) : "—"}
            </td>
            {/* Supplier floor — what he will actually sell you. Blank = no floor.
                Pack/case input hidden for now (orderPackQty stays wired server-side —
                see saveField's "orderPackQty" branch — re-show the input when needed). */}
            <td className="px-3 py-2">
                <div className="flex items-center justify-end gap-1">
                    <Input
                        key={`mq-${r.id}-${r.minOrderQty ?? ""}`}
                        className="h-7 w-16 text-right font-mono text-xs"
                        inputMode="numeric"
                        placeholder="MOQ"
                        title="Minimum order qty — the supplier refuses anything smaller. Blank = no floor."
                        defaultValue={r.minOrderQty ?? ""}
                        onBlur={(e) => void saveField(r.id, "minOrderQty", e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    />
                </div>
            </td>
            <td
                className="px-3 py-2 text-right font-mono font-semibold"
                title={r.orderQty > 0
                    ? `Shortfall ${fmtQty(r.shortfall)}${r.minOrderQty ? ` → MOQ ${r.minOrderQty}` : ""}${r.orderPackQty ? ` → ${r.packs} pack(s) × ${r.orderPackQty}` : ""} = order ${r.orderQty}`
                    : undefined}
            >
                {r.orderQty > 0 ? (
                    <>
                        {fmtQty(r.orderQty)}
                        {r.packs != null && (
                            <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                                ({r.packs}×{r.orderPackQty})
                            </span>
                        )}
                        {r.orderQty > r.shortfall && (
                            <span className="ml-1 rounded px-1 py-0.5 text-[10px] font-medium bg-amber-500/15 text-amber-600" title={`Supplier terms force ${fmtQty(r.orderQty - r.shortfall)} more than the shelf needs — extra stock, your call.`}>
                                +{fmtQty(r.orderQty - r.shortfall)}
                            </span>
                        )}
                    </>
                ) : "—"}
            </td>
            <td className="px-3 py-2 text-center">
                {r.signal === "buy" ? (
                    <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-red-500/15 text-red-600">LOW</span>
                ) : r.signal === "review" ? (
                    <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/15 text-amber-600" title="Slow mover at/below level — the machine never pushes buying for slow movers; you judge.">REVIEW</span>
                ) : (
                    <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-emerald-500/15 text-emerald-600">OK</span>
                )}
            </td>
        </tr>
    );

    // One band (+ expanded member rows). In brand/category sections the member
    // matching the section value is highlighted — that's the SKU you'd put on
    // this supplier's order; the alternates dim.
    const renderBand = (b: Band, keyPrefix = "", highlightField?: FilterField, highlightValue?: string) => {
        const multi = b.productIds.length > 1;
        const isOpen = expanded.has(b.key);
        const indent = keyPrefix !== "";
        return (
            <Fragment key={`${keyPrefix}${b.key}`}>
                <tr
                    className={`border-b last:border-0 ${multi ? "cursor-pointer" : ""} ${gridRowClass({ attention: b.isLow })}`}
                    onClick={multi ? () => toggleExpand(b.key) : undefined}
                >
                    <td className={`px-3 py-2 ${indent ? "pl-7" : ""}`}>
                        <span className="inline-flex items-center gap-1.5">
                            {multi ? (
                                isOpen ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevronRight className="size-3.5 text-muted-foreground" />
                            ) : <span className="inline-block w-3.5" />}
                            <span className="font-medium text-foreground">{bandLabel(b)}</span>
                        </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{b.productIds.length}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">{fmtQty(b.available)}</td>
                    <td className="px-3 py-2 text-right font-mono">{b.avgDailyUsage > 0 ? b.avgDailyUsage.toFixed(2) : "—"}</td>
                    <td className="px-3 py-2 text-right font-mono">{b.leadTimeDays}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmtQty(b.threshold)}</td>
                    <td className="px-3 py-2 text-right font-mono text-destructive">{b.shortfall > 0 ? fmtQty(b.shortfall) : "—"}</td>
                    <td className="px-3 py-2 text-center">
                        {b.isLow ? (
                            <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-red-500/15 text-red-600">LOW</span>
                        ) : (
                            <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-emerald-500/15 text-emerald-600">OK</span>
                        )}
                    </td>
                </tr>
                {multi && isOpen && b.productIds.map((id) => {
                    const r = rowById.get(id);
                    if (!r) return null;
                    const isTarget = highlightField != null &&
                        (fieldValue(r, highlightField) ?? NONE_LABELS[highlightField]) === highlightValue;
                    const dim = highlightField != null && !isTarget;
                    return (
                        <tr
                            key={`${keyPrefix}${b.key}-${id}`}
                            className={`border-b last:border-0 text-xs ${isTarget ? "bg-primary/10" : "bg-muted/20"} ${dim ? "opacity-60" : ""}`}
                        >
                            <td className={`px-3 py-1.5 ${indent ? "pl-14" : "pl-9"}`}>
                                <span className="text-foreground">{r.name}</span>
                                <span className="ml-2 font-mono text-muted-foreground">{r.sku}</span>
                                {r.brand && <span className="ml-2 text-muted-foreground">{r.brand}</span>}
                                {isTarget && (
                                    <span className="ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium bg-primary/20 text-primary">this {FIELD_LABELS[highlightField!].toLowerCase()}</span>
                                )}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">
                                cost {fmtCost(r.costPaise)}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono">{fmtQty(r.available)}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{r.avgDailyUsage > 0 ? r.avgDailyUsage.toFixed(2) : "—"}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{r.leadTimeDays}</td>
                            <td className="px-3 py-1.5 text-right font-mono text-muted-foreground" colSpan={2}>
                                margin {r.marginPct != null ? `${r.marginPct.toFixed(1)}%` : "—"}
                            </td>
                            <td className="px-3 py-1.5 text-center">
                                {r.available <= 0 && <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-red-500/15 text-red-600">ZERO</span>}
                            </td>
                        </tr>
                    );
                })}
            </Fragment>
        );
    };

    const itemTableHead = (
        <thead className="sticky top-0 z-10 border-b bg-[color-mix(in_oklab,var(--muted)_85%,var(--background))] text-xs font-semibold text-foreground">
            <tr>
                <th className="w-8 px-2 py-2 text-center">
                    <input
                        type="checkbox"
                        aria-label="Select all shown"
                        checked={allShownSelected}
                        onChange={toggleSelectAllShown}
                    />
                </th>
                {/* firstDir: text columns open A→Z, quantity columns open
                    largest-first — clicking "Shortfall" means "show me the
                    worst", not "show me the zeros". */}
                <SortHeader k="name" label="Item" firstDir="asc" {...sortProps} />
                <SortHeader k="stock" label="Stock" align="right" firstDir="desc" {...sortProps} />
                <SortHeader k="reserved" label="Reserved" align="right" firstDir="desc" {...sortProps} />
                <SortHeader k="available" label="Available" align="right" firstDir="asc" title="Ascending first — most oversold at the top." {...sortProps} />
                <SortHeader k="avgDailyUsage" label="Avg use / day" align="right" firstDir="desc" {...sortProps} />
                <SortHeader k="leadTimeDays" label="Lead time (d)" align="right" firstDir="desc" {...sortProps} />
                <SortHeader k="reorderLevel" label="Reorder level" align="right" firstDir="desc" {...sortProps} />
                <SortHeader k="lowStockThreshold" label="Min floor" align="right" firstDir="desc" {...sortProps} />
                <SortHeader k="shortfall" label="Shortfall" align="right" firstDir="desc" {...sortProps} />
                <SortHeader k="minOrderQty" label="MOQ" align="right" firstDir="desc" title="Supplier minimum order qty — nothing below this." {...sortProps} />
                <SortHeader k="orderQty" label="Order" align="right" firstDir="desc" title="Shortfall lifted to the MOQ — the quantity you can actually place." {...sortProps} />
                <SortHeader k="signal" label="Status" align="center" firstDir="desc" title="The default order: buy → review → ok, biggest shortfall first." {...sortProps} />
            </tr>
        </thead>
    );

    return (
        <div className="flex h-full flex-col">
            {/* Breadcrumb bar — uniform with the other inventory pages */}
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
                            <BreadcrumbPage>Reorder</BreadcrumbPage>
                        </BreadcrumbItem>
                    </BreadcrumbList>
                </Breadcrumb>
            </BreadcrumbBar>

            <ScrollArea className="h-full min-h-0 flex-1" type="always">
            <div className=" mx-auto space-y-5 px-6 pt-3 pb-6">
                <div className="flex items-end justify-between gap-3 flex-wrap">
                    <div>
                        <h1 className="text-2xl font-bold text-foreground">Reorder Status</h1>
                        <p className="text-sm text-muted-foreground mt-0.5">
                            Level = avg daily usage × lead time, floored by the manual minimum. Movement class decides the
                            treatment: Regular → red LOW = buy; Slow → amber REVIEW; Dead / Non-moving / In-house → skipped
                            (reason stated). <span className="font-medium text-foreground">Order</span> = the shortfall lifted
                            to the supplier&rsquo;s MOQ — the quantity you can actually place. An item with no sale history
                            and no Min floor has no reorder point, so it stays silent rather than guessing — set a Min
                            floor to make it watch itself.
                            Bands per group/category in Masters; universal bands in Settings → Org defaults.
                        </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <Input
                            className="h-9 w-48"
                            placeholder="Search item / SKU…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                        <Select
                            value={branchId || ALL_BRANCHES}
                            onValueChange={(v) => setBranchId(v === ALL_BRANCHES ? "" : v)}
                        >
                            <SelectTrigger className="h-9 w-40">
                                <SelectValue placeholder="All branches" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ALL_BRANCHES}>All branches</SelectItem>
                                {(data?.branches ?? []).map((b) => (
                                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button variant="outline" size="sm" className="h-9" onClick={() => void load()}>
                            <RefreshCw className="size-4" />
                        </Button>
                    </div>
                </div>

                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                        <Tabs value={tab} onValueChange={(v) => setTab(v as "items" | "smart")}>
                            <TabsList>
                                <TabsTrigger value="items">Item wise</TabsTrigger>
                                <TabsTrigger value="smart">Smart (substitute bands)</TabsTrigger>
                            </TabsList>
                        </Tabs>
                        <div className="inline-flex items-center rounded-lg border border-border bg-muted/40 p-0.5">
                            {(["group", "category", "brand", "item"] as View[]).map((v) => (
                                <button
                                    key={v}
                                    type="button"
                                    onClick={() => setView(v)}
                                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                                        }`}
                                >
                                    {v === "item" ? (tab === "smart" ? "Band-Wise" : "Item-Wise") : FIELD_LABELS[v]}
                                </button>
                            ))}
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            className={`h-9 ${anyFilter ? "border-primary text-primary" : ""}`}
                            onClick={() => setFiltersOpen((o) => !o)}
                        >
                            <Filter className="size-4" />
                            Filters{anyFilter ? ` (${[...filters.values()].reduce((s, set) => s + set.size, 0)})` : ""}
                        </Button>
                        <span className="text-xs text-muted-foreground">
                            {tab === "items"
                                ? `${itemRows.length} / ${(data?.rows.length ?? 0) - (data?.counts.skipped ?? 0) - (data?.counts.untouched ?? 0)} shown · ${untouchedRows.length} untouched · ${skippedRows.length} skipped`
                                : `${bandRows.length} / ${data?.bands?.length ?? 0} bands shown`}
                        </span>
                        {/* Sorting is otherwise invisible state — say it out loud
                            and give a one-click way back to the default order. */}
                        {tab === "items" && !isDefaultSort && (
                            <button
                                type="button"
                                onClick={resetSort}
                                className="rounded border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] text-primary hover:bg-primary/20"
                                title="Back to the default order: buy → review → ok, biggest shortfall first."
                            >
                                sorted by {sortKey} {sortDir === "asc" ? "↑" : "↓"} — reset
                            </button>
                        )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        {view !== "item" && (
                            <Button variant="outline" size="sm" className="h-9" onClick={toggleAllSections}>
                                {allExpanded ? "Collapse all" : "Expand all"}
                            </Button>
                        )}
                        {tab === "smart" && (
                            <>
                                <span className="text-xs text-muted-foreground">Cost tolerance ±%</span>
                                <Input
                                    className="h-8 w-16 text-right font-mono text-xs"
                                    inputMode="numeric"
                                    defaultValue={tolerance}
                                    key={`tol-${tolerance}`}
                                    onBlur={(e) => {
                                        const v = Math.min(Math.max(parseInt(e.target.value, 10) || 20, 1), 100);
                                        if (v !== tolerance) setTolerance(v);
                                    }}
                                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                                />
                                <span className="text-[11px] text-muted-foreground">
                                    same group + cost within x% = substitutes, demand pooled
                                </span>
                            </>
                        )}
                    </div>
                </div>

                {filtersOpen && (
                    <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
                        <div className="mb-2 flex items-center justify-between text-xs">
                            <span className="font-medium text-foreground">Filters — tick values to narrow the list (applies to both tabs)</span>
                            {anyFilter && (
                                <button type="button" className="text-muted-foreground hover:underline" onClick={() => setFilters(new Map())}>
                                    clear all
                                </button>
                            )}
                        </div>
                        <div className="grid gap-3 sm:grid-cols-3">
                            {(["brand", "group", "category"] as FilterField[]).map((f) => (
                                <FilterBox
                                    key={f}
                                    field={f}
                                    values={filterOptions[f]?.values ?? []}
                                    hasNone={filterOptions[f]?.hasNone ?? false}
                                    selected={filters.get(f) ?? new Set()}
                                    onToggle={toggleFilter}
                                    onClear={clearFilter}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {loading && (
                    <div className="flex justify-center py-20">
                        <Loader2 className="animate-spin text-muted-foreground" size={28} />
                    </div>
                )}

                {!loading && data && (
                    <>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => setLowOnly((v) => !v)}
                                className={`rounded-lg border p-3 text-left shadow-sm transition-colors ${lowOnly ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-muted/40"
                                    }`}
                            >
                                <div className="flex items-center gap-2">
                                    <TriangleAlert className="size-4 text-destructive" />
                                    {tab === "smart" ? (
                                        <>
                                            <span className="text-lg font-mono font-semibold text-foreground">{lowCount}</span>
                                            <span className="text-xs text-muted-foreground">bands at / below reorder level</span>
                                        </>
                                    ) : (
                                        <>
                                            <span className="text-lg font-mono font-semibold text-foreground">{data.counts.buy}</span>
                                            <span className="text-xs text-muted-foreground">to buy</span>
                                            <span className="text-lg font-mono font-semibold text-amber-600">{data.counts.review}</span>
                                            <span className="text-xs text-muted-foreground">to review (slow movers)</span>
                                        </>
                                    )}
                                </div>
                                <div className="text-[11px] text-muted-foreground mt-0.5">
                                    {lowOnly ? "showing low only — click to show all" : "click to show low only"}
                                </div>
                            </button>
                            <p className="text-xs text-muted-foreground">
                                Default lead time: <span className="font-mono">{data.defaultLeadTimeDays}d</span> (Settings →
                                Org defaults). A blank Lead-time cell rides the default; type a value to override per item.
                            </p>
                            {tab === "items" && (
                                <div className="ml-auto flex items-center gap-2 rounded-lg border border-border bg-card p-2 shadow-sm">
                                    <span className="text-xs font-medium text-foreground">
                                        Bulk set ({shownSelectedCount > 0 ? `${shownSelectedCount} selected` : `${itemRows.length} shown`})
                                    </span>
                                    {shownSelectedCount > 0 && (
                                        <button
                                            type="button"
                                            className="text-xs text-muted-foreground hover:underline"
                                            onClick={() => setSelected(new Set())}
                                        >
                                            clear
                                        </button>
                                    )}
                                    <Input
                                        className="h-8 w-20 text-right font-mono text-xs"
                                        inputMode="numeric"
                                        placeholder="Lead d"
                                        value={bulkLead}
                                        onChange={(e) => setBulkLead(e.target.value.replace(/\D/g, ""))}
                                    />
                                    <Input
                                        className="h-8 w-20 text-right font-mono text-xs"
                                        inputMode="numeric"
                                        placeholder="Min floor"
                                        value={bulkFloor}
                                        onChange={(e) => setBulkFloor(e.target.value.replace(/\D/g, ""))}
                                    />
                                    <Input
                                        className="h-8 w-16 text-right font-mono text-xs"
                                        inputMode="numeric"
                                        placeholder="MOQ"
                                        title="Supplier minimum order qty."
                                        value={bulkMoq}
                                        onChange={(e) => setBulkMoq(e.target.value.replace(/\D/g, ""))}
                                    />
                                    <Button size="sm" className="h-8" disabled={bulkApplying} onClick={() => void bulkApply()}>
                                        {bulkApplying ? "Applying…" : "Apply"}
                                    </Button>
                                    <button
                                        type="button"
                                        className="text-xs text-muted-foreground hover:underline"
                                        disabled={bulkApplying}
                                        onClick={() => void bulkApply(true)}
                                        title="Clear the per-item lead-time override on all shown items — they ride the org default again."
                                    >
                                        reset lead
                                    </button>
                                </div>
                            )}
                        </div>

                        {tab === "items" ? (
                            <>
                                <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
                                    <table className="w-full text-sm">
                                        {itemTableHead}
                                        <tbody>
                                            {itemRows.length === 0 ? (
                                                <tr><td colSpan={13} className="py-12 text-center text-muted-foreground text-sm">
                                                    {lowOnly || anyFilter || q ? "Nothing matches the current filters." : "No active products."}
                                                </td></tr>
                                            ) : view === "item" ? (
                                                itemRows.map((r) => renderItemRow(r))
                                            ) : (
                                                grouped.map((g) => {
                                                    const isOpen = sections.has(g.name);
                                                    return (
                                                        <Fragment key={g.name}>
                                                            <tr
                                                                className="border-b bg-muted/50 cursor-pointer hover:bg-muted"
                                                                onClick={() => toggleSection(g.name)}
                                                            >
                                                                <td className="px-3 py-2" colSpan={9}>
                                                                    <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                                                                        {isOpen ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevronRight className="size-3.5 text-muted-foreground" />}
                                                                        {g.name}
                                                                        <span className="ml-1 text-xs font-normal text-muted-foreground">{g.items.length} items</span>
                                                                    </span>
                                                                </td>
                                                                <td className="px-3 py-2 text-right font-mono text-destructive">
                                                                    {g.totalShortfall > 0 ? fmtQty(g.totalShortfall) : "—"}
                                                                </td>
                                                                {/* No section-level order qty — pack/MOQ are per SKU, so
                                                        summing them across a group would be a fake number. */}
                                                                <td colSpan={2} />
                                                                <td className="px-3 py-2 text-center">
                                                                    {g.lowCount > 0 ? (
                                                                        <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-red-500/15 text-red-600">{g.lowCount} LOW</span>
                                                                    ) : (
                                                                        <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-emerald-500/15 text-emerald-600">OK</span>
                                                                    )}
                                                                </td>
                                                            </tr>
                                                            {isOpen && g.items.map((r) => renderItemRow(r, true))}
                                                        </Fragment>
                                                    );
                                                })
                                            )}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Untouched — created but never used. Deliberately its own
                                    section rather than folded into Skipped: these never
                                    started trading, so the fix is "start stocking it or
                                    delete the entry", not "clear out dead stock". */}
                                {untouchedRows.length > 0 && (
                                    <div className="rounded-lg border border-border bg-card shadow-sm">
                                        <button
                                            type="button"
                                            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted/40"
                                            onClick={() => setUntouchedOpen((o) => !o)}
                                        >
                                            {untouchedOpen ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
                                            <span className="font-medium text-foreground">Untouched — created but never used</span>
                                            <span className="text-xs text-muted-foreground">
                                                {untouchedRows.length} item(s): no transaction ever, no stock, no min floor — set a Min floor to start watching one
                                            </span>
                                        </button>
                                        {untouchedOpen && (
                                            <table className="w-full border-t text-sm">
                                                <thead className="sticky top-0 z-10 border-b bg-[color-mix(in_oklab,var(--muted)_85%,var(--background))] text-xs font-semibold text-foreground">
                                                    <tr>
                                                        <th className="px-3 py-2 text-left font-medium">Item</th>
                                                        <th className="px-3 py-2 text-left font-medium">Group</th>
                                                        <th className="px-3 py-2 text-left font-medium">Brand</th>
                                                        <th className="px-3 py-2 text-right font-medium">Min floor</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {untouchedRows.map((r) => (
                                                        <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                                                            <td className="px-3 py-2">
                                                                <span className="text-foreground">{r.name}</span>
                                                                <span className="ml-2 font-mono text-xs text-muted-foreground">{r.sku}</span>
                                                            </td>
                                                            <td className="px-3 py-2 text-xs text-muted-foreground">{r.group ?? "—"}</td>
                                                            <td className="px-3 py-2 text-xs text-muted-foreground">{r.brand ?? "—"}</td>
                                                            {/* Editable here too — typing a floor is exactly how an
                                                                item leaves this bucket and starts producing signals. */}
                                                            <td className="px-3 py-2 text-right">
                                                                <Input
                                                                    key={`ufl-${r.id}-${r.lowStockThreshold}`}
                                                                    className="h-7 w-16 ml-auto text-right font-mono text-xs"
                                                                    inputMode="numeric"
                                                                    defaultValue={r.lowStockThreshold}
                                                                    onBlur={(e) => void saveField(r.id, "lowStockThreshold", e.target.value)}
                                                                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                                                                />
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        )}
                                    </div>
                                )}

                                {/* Skipped — stated, never silent. */}
                                {skippedRows.length > 0 && (
                                    <div className="rounded-lg border border-border bg-card shadow-sm">
                                        <button
                                            type="button"
                                            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted/40"
                                            onClick={() => setSkippedOpen((o) => !o)}
                                        >
                                            {skippedOpen ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
                                            <span className="font-medium text-foreground">Skipped — not for reorder</span>
                                            <span className="text-xs text-muted-foreground">
                                                {skippedRows.length} item(s): dead / non-moving / in-house — no buy signal, reason stated per row
                                            </span>
                                        </button>
                                        {skippedOpen && (
                                            <table className="w-full border-t text-sm">
                                                <thead className="sticky top-0 z-10 border-b bg-[color-mix(in_oklab,var(--muted)_85%,var(--background))] text-xs font-semibold text-foreground">
                                                    <tr>
                                                        <th className="px-3 py-2 text-left font-medium">Item</th>
                                                        <th className="px-3 py-2 text-right font-medium">Last sale</th>
                                                        <th className="px-3 py-2 text-right font-medium">Stock</th>
                                                        <th className="px-3 py-2 text-left font-medium">Why skipped</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {skippedRows.map((r) => (
                                                        <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                                                            <td className="px-3 py-2">
                                                                <span className="text-foreground">{r.name}</span>
                                                                <span className="ml-2 font-mono text-xs text-muted-foreground">{r.sku}</span>
                                                                <ClassBadge movementClass={r.movementClass} blip={r.blip} />
                                                                {r.inHouse && (
                                                                    <span className="ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium bg-sky-500/15 text-sky-600">In-house</span>
                                                                )}
                                                            </td>
                                                            <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">
                                                                {r.daysSinceLastSale != null ? `${r.daysSinceLastSale}d ago` : "never"}
                                                            </td>
                                                            <td className="px-3 py-2 text-right font-mono">{fmtQty(r.stock)}{r.unit ? ` ${r.unit}` : ""}</td>
                                                            <td className="px-3 py-2 text-xs text-muted-foreground">{r.skipReason ?? "—"}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        )}
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
                                <table className="w-full text-sm">
                                    <thead className="sticky top-0 z-10 border-b bg-[color-mix(in_oklab,var(--muted)_85%,var(--background))] text-xs font-semibold text-foreground">
                                        <tr>
                                            <th className="px-3 py-2 text-left font-medium">Band (group · cost range)</th>
                                            <th className="px-3 py-2 text-right font-medium">Items</th>
                                            <th className="px-3 py-2 text-right font-medium">Available</th>
                                            <th className="px-3 py-2 text-right font-medium">Avg use / day</th>
                                            <th className="px-3 py-2 text-right font-medium">Lead (d)</th>
                                            <th className="px-3 py-2 text-right font-medium">Reorder level</th>
                                            <th className="px-3 py-2 text-right font-medium">Shortfall</th>
                                            <th className="px-3 py-2 text-center font-medium">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {bandRows.length === 0 ? (
                                            <tr><td colSpan={8} className="py-12 text-center text-muted-foreground text-sm">
                                                {lowOnly || anyFilter || q ? "No band matches the current filters." : "No active products."}
                                            </td></tr>
                                        ) : view === "item" ? (
                                            bandRows.map((b) => renderBand(b))
                                        ) : (
                                            bandSections.map((sec) => {
                                                const isOpen = sections.has(sec.name);
                                                return (
                                                    <Fragment key={sec.name}>
                                                        <tr
                                                            className="border-b bg-muted/50 cursor-pointer hover:bg-muted"
                                                            onClick={() => toggleSection(sec.name)}
                                                        >
                                                            <td className="px-3 py-2" colSpan={6}>
                                                                <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                                                                    {isOpen ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevronRight className="size-3.5 text-muted-foreground" />}
                                                                    {sec.name}
                                                                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                                                                        {sec.bands.length} band{sec.bands.length === 1 ? "" : "s"}
                                                                    </span>
                                                                </span>
                                                            </td>
                                                            <td className="px-3 py-2 text-right font-mono text-destructive" title={view !== "group" ? "Fillable by this section's order — the same band repeats under other sections, don't sum across them." : undefined}>
                                                                {sec.totalShortfall > 0 ? fmtQty(sec.totalShortfall) : "—"}
                                                            </td>
                                                            <td className="px-3 py-2 text-center">
                                                                {sec.lowCount > 0 ? (
                                                                    <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-red-500/15 text-red-600">{sec.lowCount} LOW</span>
                                                                ) : (
                                                                    <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-emerald-500/15 text-emerald-600">OK</span>
                                                                )}
                                                            </td>
                                                        </tr>
                                                        {isOpen && sec.bands.map((b) =>
                                                            renderBand(
                                                                b,
                                                                `${sec.name}::`,
                                                                view === "group" ? undefined : view,
                                                                view === "group" ? undefined : sec.name,
                                                            ),
                                                        )}
                                                    </Fragment>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </>
                )}
            </div>
            </ScrollArea>
        </div>
    );
}
