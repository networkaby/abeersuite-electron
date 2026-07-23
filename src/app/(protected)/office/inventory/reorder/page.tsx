"use client";

// Reorder Status — Tally's "Reorder Levels" screen done with the complete
// formula (sampling window and coverage horizon kept separate):
//
//   reorder level = avg daily usage (class-driven window) × lead time (days)
//   threshold     = max(reorder level, manual floor)
//   LOW           = available (stock − reserved) <= threshold
//
// The movement class (movementClass.ts: recency vs group→category→org bands)
// decides the treatment — Regular = red LOW (buy), Slow = amber REVIEW, New =
// floor only, Dead / Non-moving / In-house = the collapsed "Skipped" section
// with per-row reasons. Skipped is stated, never silent.
//
// Two tabs:
//   • Item wise — one row per product; lead time + floor edited inline
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
import axios from "axios";
import { toast } from "sonner";
import {
    ChevronDown, ChevronRight, Filter, Loader2, RefreshCw, TriangleAlert,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { extractApiError } from "@/shared/lib/api";
import { fmt } from "@/utils/constants";

type MovementClass = "NEW" | "REGULAR" | "SLOW" | "NON_MOVING" | "DEAD";
type Signal = "buy" | "review" | "ok" | "skipped";

interface ReorderRow {
    id: number;
    sku: string;
    name: string;
    /** BOM output — made in-house; hidden from Smart bands, badged here. */
    inHouse: boolean;
    movementClass: MovementClass;
    daysSinceLastSale: number | null;
    activeDays: number;
    clearanceDays: number;
    blip: boolean;
    usageWindowDays: number;
    bandSource: string;
    signal: Signal;
    skipReason: string | null;
    unit: string | null;
    group: string | null;
    groupId: number | null;
    brand: string | null;
    category: string | null;
    stock: number;
    reserved: number;
    available: number;
    avgDailyUsage: number;
    leadTimeDays: number;
    ownLeadTimeDays: number | null;
    reorderLevel: number;
    lowStockThreshold: number;
    threshold: number;
    isLow: boolean;
    shortfall: number;
    costPaise: number | null;
    marginPct: number | null;
}

interface Band {
    key: string;
    groupName: string | null;
    costMinPaise: number | null;
    costMaxPaise: number | null;
    productIds: number[];
    available: number;
    avgDailyUsage: number;
    leadTimeDays: number;
    reorderLevel: number;
    threshold: number;
    isLow: boolean;
    shortfall: number;
}

interface Report {
    defaultLeadTimeDays: number;
    tolerancePct: number;
    branches: { id: string; name: string }[];
    counts: { buy: number; review: number; skipped: number };
    lowCount: number;
    rows: ReorderRow[];
    bands: Band[] | null;
}

type FilterField = "group" | "category" | "brand";
type View = "item" | FilterField;

const ALL_BRANCHES = "__all__";
const NONE_KEY = "__none__";

const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const fmtCost = (paise: number | null) => (paise == null ? "—" : fmt(paise / 100));

const FIELD_LABELS: Record<FilterField, string> = { group: "Group", category: "Category", brand: "Brand" };
const NONE_LABELS: Record<FilterField, string> = { group: "Ungrouped", category: "Uncategorised", brand: "No brand" };

/// Movement-class badges — Regular stays silent (only exceptions get ink).
const CLASS_BADGES: Record<MovementClass, { label: string; cls: string } | null> = {
    REGULAR: null,
    NEW: { label: "New", cls: "bg-blue-500/15 text-blue-600" },
    SLOW: { label: "Slow", cls: "bg-amber-500/15 text-amber-600" },
    NON_MOVING: { label: "Non-moving", cls: "bg-orange-500/15 text-orange-600" },
    DEAD: { label: "Dead", cls: "bg-red-500/15 text-red-600" },
};

function ClassBadge({ movementClass, blip }: { movementClass: MovementClass; blip?: boolean }) {
    const b = CLASS_BADGES[movementClass];
    if (!b) return null;
    return (
        <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${b.cls}`}>
            {b.label}{blip ? " · blip" : ""}
        </span>
    );
}

/// One checklist box inside the Filters panel (Strategies-page pattern):
/// searchable multi-select of unique values derived from the rows, with a
/// "(none)" entry when any row lacks the relation.
function FilterBox({
    field, values, hasNone, selected, onToggle, onClear,
}: {
    field: FilterField;
    values: string[];
    hasNone: boolean;
    selected: Set<string>;
    onToggle: (field: FilterField, key: string) => void;
    onClear: (field: FilterField) => void;
}) {
    const [query, setQuery] = useState("");
    const items: { key: string; label: string }[] = [
        ...(hasNone ? [{ key: NONE_KEY, label: `(${NONE_LABELS[field].toLowerCase()})` }] : []),
        ...values.map((v) => ({ key: v, label: v })),
    ];
    const q = query.trim().toLowerCase();
    const visible = !q ? items : items.filter((it) => it.label.toLowerCase().includes(q));

    return (
        <div className="rounded-md border border-border bg-background p-2">
            <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="font-medium text-foreground">{FIELD_LABELS[field]}s</span>
                {selected.size > 0 && (
                    <button type="button" className="text-muted-foreground hover:underline" onClick={() => onClear(field)}>
                        clear ({selected.size})
                    </button>
                )}
            </div>
            <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Filter ${FIELD_LABELS[field].toLowerCase()}s…`}
                className="mb-1.5 h-7 w-full rounded border border-input bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <ul className="max-h-44 overflow-auto space-y-1">
                {visible.length === 0 ? (
                    <li className="px-1 py-0.5 text-xs text-muted-foreground">No matches</li>
                ) : visible.map((it) => (
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
            </ul>
        </div>
    );
}

export default function ReorderPage() {
    const [data, setData] = useState<Report | null>(null);
    const [loading, setLoading] = useState(true);
    const [branchId, setBranchId] = useState("");
    const [lowOnly, setLowOnly] = useState(false);
    const [search, setSearch] = useState("");
    const [tab, setTab] = useState<"items" | "smart">("items");
    const [tolerance, setTolerance] = useState(20);
    const [skippedOpen, setSkippedOpen] = useState(false);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [view, setView] = useState<View>("item");
    const [sections, setSections] = useState<Set<string>>(new Set());
    const [filters, setFilters] = useState<Map<FilterField, Set<string>>>(new Map());
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [bulkLead, setBulkLead] = useState("");
    const [bulkFloor, setBulkFloor] = useState("");
    const [bulkApplying, setBulkApplying] = useState(false);
    /// Manually ticked rows. Empty = bulk targets ALL shown rows; ticking
    /// narrows the target (filter → select all → untick the exceptions).
    const [selected, setSelected] = useState<Set<number>>(new Set());

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (branchId) params.set("branchId", branchId);
            if (tab === "smart") { params.set("grouped", "1"); params.set("tolerance", String(tolerance)); }
            const qs = params.toString();
            const res = await axios.get<Report>(`/api/inventory/reports/reorder${qs ? `?${qs}` : ""}`);
            setData(res.data);
        } catch (err) {
            toast.error(extractApiError(err, "Failed to load reorder report"));
        } finally {
            setLoading(false);
        }
    }, [branchId, tab, tolerance]);

    useEffect(() => { void load(); }, [load]);

    // Inline edit of leadTimeDays / lowStockThreshold — PATCH then reload so
    // the computed level/threshold columns stay server-authoritative.
    async function saveField(id: number, field: "leadTimeDays" | "lowStockThreshold", raw: string) {
        const trimmed = raw.trim();
        // Lead time: blank = clear override (back to org default). Floor: blank = ignore.
        const value = trimmed === ""
            ? (field === "leadTimeDays" ? null : undefined)
            : Math.max(0, parseInt(trimmed, 10) || 0);
        if (value === undefined) return;
        const current = data?.rows.find((r) => r.id === id);
        if (current && (field === "leadTimeDays" ? current.ownLeadTimeDays : current.lowStockThreshold) === value) return;
        try {
            await axios.patch(`/api/inventory/products/${id}`, { [field]: value });
            toast.success("Saved");
            await load();
        } catch (err) {
            toast.error(extractApiError(err, "Failed to save"));
        }
    }

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
        const floor = clearLead ? undefined
            : bulkFloor.trim() === "" ? undefined
            : Math.max(0, parseInt(bulkFloor, 10) || 0);
        if (lead === undefined && floor === undefined) {
            toast.error("Type a lead time and/or min floor first");
            return;
        }
        const what = clearLead
            ? "reset lead time to org default"
            : [lead !== undefined ? `lead time ${lead}d` : null, floor !== undefined ? `min floor ${floor}` : null].filter(Boolean).join(" + ");
        const scope = selected.size > 0 ? "selected" : "shown";
        if (!window.confirm(`Apply ${what} to ${ids.length} ${scope} item(s)?`)) return;
        setBulkApplying(true);
        try {
            const res = await axios.post<{ updated: number }>("/api/inventory/products/bulk-reorder", {
                productIds: ids,
                ...(lead !== undefined ? { leadTimeDays: lead } : {}),
                ...(floor !== undefined ? { lowStockThreshold: floor } : {}),
            });
            toast.success(`Updated ${res.data.updated} item(s)`);
            setBulkLead(""); setBulkFloor("");
            setSelected(new Set());
            await load();
        } catch (err) {
            toast.error(extractApiError(err, "Bulk apply failed"));
        } finally {
            setBulkApplying(false);
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

    const fieldValue = (r: ReorderRow, field: FilterField): string | null =>
        field === "group" ? r.group : field === "category" ? r.category : r.brand;

    const filterOptions = useMemo(() => {
        const out = {} as Record<FilterField, { values: string[]; hasNone: boolean }>;
        for (const field of ["group", "category", "brand"] as FilterField[]) {
            const set = new Set<string>();
            let hasNone = false;
            for (const r of data?.rows ?? []) {
                const v = fieldValue(r, field);
                if (v) set.add(v); else hasNone = true;
            }
            out[field] = { values: [...set].sort((a, b) => a.localeCompare(b)), hasNone };
        }
        return out;
    }, [data]);

    const rowById = useMemo(() => new Map((data?.rows ?? []).map((r) => [r.id, r])), [data]);

    const q = search.trim().toLowerCase();
    const passesFilters = useCallback((r: ReorderRow): boolean => {
        if (q && !r.name.toLowerCase().includes(q) && !r.sku.toLowerCase().includes(q)) return false;
        for (const [field, set] of filters) {
            const v = fieldValue(r, field);
            if (!set.has(v ?? NONE_KEY)) return false;
        }
        return true;
    }, [q, filters]);

    // Considered rows (Regular / New / Slow) — the main table.
    const itemRows = useMemo(
        () => (data?.rows ?? []).filter((r) => r.signal !== "skipped" && (!lowOnly || r.isLow) && passesFilters(r)),
        [data, lowOnly, passesFilters],
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
    const grouped = useMemo(() => {
        if (view === "item") return [];
        const map = new Map<string, ReorderRow[]>();
        for (const r of itemRows) {
            const k = fieldValue(r, view) ?? NONE_LABELS[view];
            const arr = map.get(k);
            if (arr) arr.push(r); else map.set(k, [r]);
        }
        return [...map.entries()]
            .map(([name, items]) => ({
                name,
                items: items.sort((a, b) => Number(b.isLow) - Number(a.isLow) || a.name.localeCompare(b.name)),
                lowCount: items.filter((r) => r.isLow).length,
                totalShortfall: items.reduce((s, r) => s + r.shortfall, 0),
            }))
            .sort((a, b) => b.lowCount - a.lowCount || a.name.localeCompare(b.name));
    }, [itemRows, view]);

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
    const bandSections = useMemo(() => {
        if (tab !== "smart" || view === "item") return [];
        const map = new Map<string, Band[]>();
        const add = (name: string, b: Band) => {
            const arr = map.get(name);
            if (arr) arr.push(b); else map.set(name, [b]);
        };
        for (const b of bandRows) {
            if (view === "group") {
                add(b.groupName ?? NONE_LABELS.group, b);
            } else {
                const names = new Set<string>();
                for (const id of b.productIds) {
                    const r = rowById.get(id);
                    if (r) names.add(fieldValue(r, view) ?? NONE_LABELS[view]);
                }
                for (const n of names) add(n, b);
            }
        }
        return [...map.entries()]
            .map(([name, bands]) => ({
                name,
                bands,
                lowCount: bands.filter((x) => x.isLow).length,
                totalShortfall: bands.reduce((s, x) => s + x.shortfall, 0),
            }))
            .sort((a, b) => b.lowCount - a.lowCount || b.totalShortfall - a.totalShortfall || a.name.localeCompare(b.name));
    }, [tab, view, bandRows, rowById]);

    // Auto-expand every section whenever the active section set changes
    // (stock-summary pattern) — collapse individually or via the global toggle.
    const activeSectionNames = useMemo(
        () => (tab === "items" ? grouped.map((g) => g.name) : bandSections.map((s) => s.name)),
        [tab, grouped, bandSections],
    );
    useEffect(() => {
        if (activeSectionNames.length === 0) return;
        setSections(new Set(activeSectionNames));
    }, [activeSectionNames]);

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
        <tr key={r.id} className={`border-b last:border-0 hover:bg-muted/40 ${r.isLow ? "bg-amber-500/5" : ""} ${selected.has(r.id) ? "bg-primary/5" : ""}`}>
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
                    <span className="ml-1 rounded px-1 py-0.5 text-[9px] font-medium bg-purple-500/15 text-purple-600" title={`${r.clearanceDays} day(s) of clearance-priced sales in the window — excluded from demand`}>
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
                className={`border-b last:border-0 hover:bg-muted/40 ${b.isLow ? "bg-amber-500/5" : ""} ${multi ? "cursor-pointer" : ""}`}
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
        <thead className="border-b bg-muted text-xs text-muted-foreground">
            <tr>
                <th className="w-8 px-2 py-2 text-center">
                    <input
                        type="checkbox"
                        aria-label="Select all shown"
                        checked={allShownSelected}
                        onChange={toggleSelectAllShown}
                    />
                </th>
                <th className="px-3 py-2 text-left font-medium">Item</th>
                <th className="px-3 py-2 text-right font-medium">Stock</th>
                <th className="px-3 py-2 text-right font-medium">Reserved</th>
                <th className="px-3 py-2 text-right font-medium">Available</th>
                <th className="px-3 py-2 text-right font-medium">Avg use / day</th>
                <th className="px-3 py-2 text-right font-medium">Lead time (d)</th>
                <th className="px-3 py-2 text-right font-medium">Reorder level</th>
                <th className="px-3 py-2 text-right font-medium">Min floor</th>
                <th className="px-3 py-2 text-right font-medium">Shortfall</th>
                <th className="px-3 py-2 text-center font-medium">Status</th>
            </tr>
        </thead>
    );

    return (
        <ScrollArea className="h-full" type="always">
        <div className="max-w-7xl mx-auto space-y-5 px-6 pt-3 pb-6">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Reorder Status</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Level = avg daily usage × lead time, floored by the manual minimum. Movement class decides the
                        treatment: Regular → red LOW = buy; Slow → amber REVIEW; Dead / Non-moving / In-house → skipped
                        (reason stated). Bands per group/category in Masters; universal bands in Settings → Org defaults.
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
                                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                                    view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
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
                            ? `${itemRows.length} / ${(data?.rows.length ?? 0) - (data?.counts.skipped ?? 0)} shown · ${skippedRows.length} skipped`
                            : `${bandRows.length} / ${data?.bands?.length ?? 0} bands shown`}
                    </span>
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
                            className={`rounded-lg border p-3 text-left shadow-sm transition-colors ${
                                lowOnly ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-muted/40"
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
                                    <tr><td colSpan={11} className="py-12 text-center text-muted-foreground text-sm">
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
                                    <thead className="border-b bg-muted text-xs text-muted-foreground">
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
                            <thead className="border-b bg-muted text-xs text-muted-foreground">
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
    );
}
