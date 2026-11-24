// Reorder report rows: types, labels and the pure row maths (filter options,
// sort order, Group / Category / Brand sections, Smart-tab band sections).
// Moved out of page.tsx unchanged, so it can be unit-tested.

import { fmt } from "@/shared/lib/format/moneyInr";

export type MovementClass = "NEW" | "REGULAR" | "SLOW" | "NON_MOVING" | "DEAD";
export type Signal = "buy" | "review" | "ok" | "untouched" | "skipped";

export interface ReorderRow {
    id: number;
    sku: string;
    name: string;
    codes: { kind: string; value: string }[];
    /** BOM output — made in-house; hidden from Smart bands, badged here. */
    inHouse: boolean;
    /** Never transacted, no stock, no opening, no floor — its own section. */
    untouched: boolean;
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
    orderPackQty: number | null;
    minOrderQty: number | null;
    orderQty: number;
    packs: number | null;
    costPaise: number | null;
    marginPct: number | null;
}

export interface Band {
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

export interface Report {
    defaultLeadTimeDays: number;
    tolerancePct: number;
    branches: { id: string; name: string }[];
    counts: { buy: number; review: number; untouched: number; skipped: number };
    lowCount: number;
    rows: ReorderRow[];
    bands: Band[] | null;
}

export type FilterField = "group" | "category" | "brand";
export type View = "item" | FilterField;

/** "signal" is the table default — the server's buy → review → ok triage. */
export type SortKey =
    | "signal" | "name" | "group" | "brand"
    | "stock" | "reserved" | "available" | "avgDailyUsage"
    | "leadTimeDays" | "reorderLevel" | "lowStockThreshold"
    | "shortfall" | "minOrderQty" | "orderQty";

/** Rank for the "signal" sort — mirrors the server's own ordering. */
export const SIGNAL_RANK: Record<Signal, number> = { buy: 0, review: 1, ok: 2, untouched: 3, skipped: 4 };

export const ALL_BRANCHES = "__all__";
export const NONE_KEY = "__none__";

export const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
export const fmtCost = (paise: number | null) => (paise == null ? "—" : fmt(paise / 100));

export const FIELD_LABELS: Record<FilterField, string> = { group: "Group", category: "Collection", brand: "Brand" };
export const NONE_LABELS: Record<FilterField, string> = { group: "Ungrouped", category: "No collection", brand: "No brand" };

/// Movement-class badges — Regular stays silent (only exceptions get ink).
export const CLASS_BADGES: Record<MovementClass, { label: string; cls: string } | null> = {
    REGULAR: null,
    NEW: { label: "New", cls: "bg-blue-500/15 text-blue-600" },
    SLOW: { label: "Slow", cls: "bg-amber-500/15 text-amber-600" },
    NON_MOVING: { label: "Non-moving", cls: "bg-orange-500/15 text-orange-600" },
    DEAD: { label: "Dead", cls: "bg-red-500/15 text-red-600" },
};

export const fieldValue = (r: ReorderRow, field: FilterField): string | null =>
    field === "group" ? r.group : field === "category" ? r.category : r.brand;

/** The Group / Collection / Brand filter lists, from every row of the report. */
export function buildFilterOptions(rows: ReorderRow[]) {
    const out = {} as Record<FilterField, { values: string[]; hasNone: boolean }>;
    for (const field of ["group", "category", "brand"] as FilterField[]) {
        const set = new Set<string>();
        let hasNone = false;
        for (const r of rows) {
            const v = fieldValue(r, field);
            if (v) set.add(v); else hasNone = true;
        }
        out[field] = { values: [...set].sort((a, b) => a.localeCompare(b)), hasNone };
    }
    return out;
}

// Row comparator for the clickable headers. Text sorts case-insensitively
// with nulls LAST in both directions (an item with no brand shouldn't
// outrank one that has a brand just because "" < "A"); numbers sort
// numerically. Ties fall back to name so the order is stable across
// renders — without that, equal rows can swap places on every re-render.
export function compareReorderRows(a: ReorderRow, b: ReorderRow, sortKey: SortKey, sortDir: "asc" | "desc"): number {
    const dir = sortDir === "asc" ? 1 : -1;
    const text = (x: string | null, y: string | null) =>
        x == null && y == null ? 0 : x == null ? 1 : y == null ? -1
            : x.localeCompare(y, undefined, { sensitivity: "base" }) * dir;
    const num = (x: number | null, y: number | null) =>
        ((x ?? -Infinity) - (y ?? -Infinity)) * dir;

    let d = 0;
    switch (sortKey) {
        // Default view: triage order, biggest shortfall first inside each band.
        case "signal": d = (SIGNAL_RANK[b.signal] - SIGNAL_RANK[a.signal]) * dir
            || (a.shortfall - b.shortfall) * dir; break;
        case "name": d = text(a.name, b.name); break;
        case "group": d = text(a.group, b.group); break;
        case "brand": d = text(a.brand, b.brand); break;
        case "minOrderQty": d = num(a.minOrderQty, b.minOrderQty); break;
        default: d = num(a[sortKey] as number, b[sortKey] as number); break;
    }
    return d || a.name.localeCompare(b.name);
}

/** Hierarchy sections (Item tab, view ≠ item) — stock-summary pattern. */
export function groupItemRows(itemRows: ReorderRow[], view: View) {
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
            // Already ordered by the active header sort (itemRows is sorted
            // upstream) — re-sorting here would silently override whichever
            // column the user clicked.
            items,
            lowCount: items.filter((r) => r.isLow).length,
            totalShortfall: items.reduce((s, r) => s + r.shortfall, 0),
        }))
        .sort((a, b) => b.lowCount - a.lowCount || a.name.localeCompare(b.name));
}

// Smart-tab sections (view ≠ band-wise).
// Group view: a band has exactly one home (banding never crosses a group).
// Brand / Category views: a band appears under EVERY value its members
// carry — deliberate duplication, the supplier-order view ("ordering
// Frontech today: which shortfalls can that order fill?"). Never sum
// shortfall across sections — the same band repeats.
export function buildBandSections(bandRows: Band[], view: View, rowById: Map<number, ReorderRow>) {
    if (view === "item") return [];
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
}
