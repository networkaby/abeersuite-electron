"use client";

// ─────────────────────────────────────────────────────────────────────────────
// MatchConditions — the shared "Match conditions" filter block. Currently used
// by the strategy creation page (strategies/create); kept as the single source
// of truth so any future strategy editor stays visually + behaviourally identical.
//
// Controlled: parent owns a MatchConditionsValue and receives a partial patch on
// every change. Taxonomy multi-selects + three numeric range cards + free-form
// attribute-filter rows (attrsJson).
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import { Search, Tag, FolderTree, Boxes, IndianRupee, Package, CalendarClock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

// ── Types ───────────────────────────────────────────────────────────────────

export type AttrOp = "eq" | "in" | "gte" | "lte" | "between";

export interface AttrFilterEntry {
    op: AttrOp;
    value: string | number | boolean | (string | number)[];
}

// AttrRow is the editable form representation — value is always a string for the
// user to type freely; we parse to the right shape on save.
export type AttrRow = { key: string; op: AttrOp; value: string };

export type Master = { id: number; name: string; parentId?: number | null };

export type MatchConditionsValue = {
    brandIds: Set<number>;
    groupIds: Set<number>;
    categoryIds: Set<number>;
    attrs: AttrRow[];
    minCost: string; // rupees decimal (user-facing); paise on save
    maxCost: string;
    minStock: string;
    maxStock: string;
    minStaleDays: string;
    maxStaleDays: string;
};

export const emptyMatchConditions = (): MatchConditionsValue => ({
    brandIds: new Set(),
    groupIds: new Set(),
    categoryIds: new Set(),
    attrs: [],
    minCost: "",
    maxCost: "",
    minStock: "",
    maxStock: "",
    minStaleDays: "",
    maxStaleDays: "",
});

export const ATTR_OP_LABEL: Record<AttrOp, string> = {
    eq: "equals",
    in: "in",
    gte: "≥",
    lte: "≤",
    between: "between",
};

// ── Hierarchy helper ─────────────────────────────────────────────────────────

/// Depth-first sort with depth markers so the list shows parents above their
/// children. Items with a missing parent (parentId pointing to nothing in the
/// list) surface at the end so they remain pickable.
export function buildHierarchy(rows: Master[]): (Master & { depth: number })[] {
    const byParent = new Map<number | null, Master[]>();
    for (const r of rows) {
        const pid: number | null = r.parentId ?? null;
        const arr = byParent.get(pid) ?? [];
        arr.push(r);
        byParent.set(pid, arr);
    }
    const out: (Master & { depth: number })[] = [];
    const seen = new Set<number>();
    function walk(parent: number | null, depth: number) {
        const kids = (byParent.get(parent) ?? [])
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name));
        for (const k of kids) {
            if (seen.has(k.id)) continue;
            seen.add(k.id);
            out.push({ ...k, depth });
            walk(k.id, depth + 1);
        }
    }
    walk(null, 0);
    for (const r of rows) {
        if (!seen.has(r.id)) out.push({ ...r, depth: 0 });
    }
    return out;
}

// ── Multi-select checkbox group ──────────────────────────────────────────────
// Inline searchable checkbox list. Renders compact chips for selected ids on
// top, then a search input, then a scrollable checkbox list. No popover —
// keeps the form behaviour boring and predictable.
//
// Hierarchical lists (groups, categories) also get an "Include child" toggle.
// It is purely a TICKING AID: with it on, ticking a parent also ticks every
// descendant, so the boxes on screen are exactly the ids that will be matched.
// Matching itself never expands anything — the ticks do their own job.

/** id → its direct children ids, from the parentId links already on `items`. */
function childrenMapOf(items: Master[]): Map<number, number[]> {
    const m = new Map<number, number[]>();
    for (const it of items) {
        const pid = it.parentId ?? null;
        if (pid == null) continue;
        const arr = m.get(pid) ?? [];
        arr.push(it.id);
        m.set(pid, arr);
    }
    return m;
}

/** The id itself plus every descendant beneath it (cycle-safe). */
function withDescendants(id: number, children: Map<number, number[]>): number[] {
    const out: number[] = [];
    const seen = new Set<number>();
    const stack = [id];
    while (stack.length) {
        const cur = stack.pop()!;
        if (seen.has(cur)) continue;
        seen.add(cur);
        out.push(cur);
        for (const k of children.get(cur) ?? []) stack.push(k);
    }
    return out;
}

function MultiSelectGroup({
    label, helper, items, selected, onChange, icon: Icon, hierarchical = false,
}: {
    label: string;
    helper?: string;
    items: (Master & { depth?: number })[];
    selected: Set<number>;
    onChange: (next: Set<number>) => void;
    icon: React.ComponentType<{ className?: string }>;
    /** Show the "Include child" toggle — only meaningful for parent/child lists. */
    hierarchical?: boolean;
}) {
    const [q, setQ] = useState("");
    const [includeChildren, setIncludeChildren] = useState(false);
    const filtered = useMemo(() => {
        const needle = q.trim().toLowerCase();
        if (!needle) return items;
        return items.filter((m) => m.name.toLowerCase().includes(needle));
    }, [items, q]);

    const children = useMemo(() => childrenMapOf(items), [items]);

    const toggle = (id: number) => {
        const next = new Set(selected);
        // With the toggle on, a parent carries its whole subtree in/out with it.
        const ids = hierarchical && includeChildren ? withDescendants(id, children) : [id];
        if (next.has(id)) for (const i of ids) next.delete(i);
        else for (const i of ids) next.add(i);
        onChange(next);
    };

    // Turning the toggle ON tops up whatever is already ticked, so the screen
    // immediately shows the full subtree rather than waiting for a re-tick.
    // Turning it OFF leaves existing ticks alone — the user can untick freely.
    const setIncludeChildrenAndTopUp = (on: boolean) => {
        setIncludeChildren(on);
        if (!on || selected.size === 0) return;
        const next = new Set(selected);
        for (const id of selected) for (const i of withDescendants(id, children)) next.add(i);
        if (next.size !== selected.size) onChange(next);
    };

    const clearAll = () => onChange(new Set());

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
                <Label className="flex items-center gap-1.5">
                    <Icon className="size-3.5 text-muted-foreground" />
                    {label}
                    {selected.size > 0 ? (
                        <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0">
                            {selected.size}
                        </Badge>
                    ) : null}
                </Label>
                {selected.size > 0 ? (
                    <button
                        type="button"
                        onClick={clearAll}
                        className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                    >
                        Clear
                    </button>
                ) : null}
            </div>
            {helper ? <p className="text-[11px] text-muted-foreground -mt-1">{helper}</p> : null}
            <div className="border border-border rounded-sm bg-card">
                {hierarchical ? (
                    <label className="flex cursor-pointer items-center gap-2 border-b border-border px-2 py-1.5 text-[11px] hover:bg-muted/50">
                        <Checkbox
                            checked={includeChildren}
                            onCheckedChange={(c) => setIncludeChildrenAndTopUp(c === true)}
                        />
                        <span>Include child</span>
                        {/* <span className="text-muted-foreground">— ticking a parent ticks its sub-{label.toLowerCase()}</span> */}
                    </label>
                ) : null}
                <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
                    <Search className="size-3.5 text-muted-foreground" />
                    <input
                        type="text"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder={`Filter ${label.toLowerCase()}…`}
                        className="flex-1 bg-transparent outline-none text-xs"
                    />
                </div>
                <div className="max-h-40 overflow-y-auto">
                    {filtered.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic px-3 py-2">No matches.</p>
                    ) : (
                        filtered.map((m) => (
                            <label
                                key={m.id}
                                className="flex items-center gap-2 px-2 py-1 text-xs hover:bg-muted/50 cursor-pointer"
                                style={m.depth ? { paddingLeft: 8 + m.depth * 14 } : undefined}
                            >
                                <Checkbox
                                    checked={selected.has(m.id)}
                                    onCheckedChange={() => toggle(m.id)}
                                />
                                {m.depth ? (
                                    <span className="select-none font-mono text-[10px] leading-none text-muted-foreground/60" aria-hidden>
                                        {Array(m.depth).fill("•").join(" ")}
                                    </span>
                                ) : null}
                                <span className="truncate">{m.name}</span>
                            </label>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}

// ── Range filter segment ──────────────────────────────────────────────────────
// Bordered card with title + helper + min/max inputs. Each range concept (cost,
// stock, last-sale-age) gets one segment so the visual grouping matches the
// semantics instead of being one undifferentiated 5-column grid.

function RangeSegment({
    icon: Icon, title, helper,
    minLabel, maxLabel,
    minValue, maxValue,
    onMin, onMax,
    inputMode = "decimal",
    placeholderMin, placeholderMax,
}: {
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    helper?: string;
    minLabel: string;
    maxLabel: string;
    minValue: string;
    maxValue: string;
    onMin: (v: string) => void;
    onMax: (v: string) => void;
    inputMode?: "decimal" | "numeric";
    placeholderMin?: string;
    placeholderMax?: string;
}) {
    return (
        <div className="border border-border rounded-sm bg-muted/20 p-3 space-y-2">
            <div className="flex items-center gap-1.5">
                <Icon className="size-3.5 text-muted-foreground" />
                <p className="text-xs font-semibold uppercase tracking-wide">{title}</p>
            </div>
            {helper ? <p className="text-[11px] text-muted-foreground leading-snug">{helper}</p> : null}
            <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">{minLabel}</Label>
                    <Input
                        inputMode={inputMode}
                        placeholder={placeholderMin}
                        value={minValue}
                        onChange={(e) => onMin(e.target.value)}
                        className="h-8 font-mono text-xs"
                    />
                </div>
                <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">{maxLabel}</Label>
                    <Input
                        inputMode={inputMode}
                        placeholder={placeholderMax}
                        value={maxValue}
                        onChange={(e) => onMax(e.target.value)}
                        className="h-8 font-mono text-xs"
                    />
                </div>
            </div>
        </div>
    );
}

// ── The composed Match-conditions block ───────────────────────────────────────

export function MatchConditions({
    brands, groups, categories, value, onChange, showStaleDays = true,
}: {
    brands: Master[];
    groups: Master[];
    categories: Master[];
    value: MatchConditionsValue;
    onChange: (patch: Partial<MatchConditionsValue>) => void;
    /** Hide the "Days since last sale" range when the data source can't supply staleness. */
    showStaleDays?: boolean;
}) {
    return (
        <>
            {/* Taxonomy filters (multi-select) */}
            <div className="space-y-2">
                {/* <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Match conditions <span className="font-normal normal-case">(empty = matches every product)</span>
                </p> */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <MultiSelectGroup
                        label="Brands" icon={Tag}
                        items={brands}
                        selected={value.brandIds}
                        onChange={(ids) => onChange({ brandIds: ids })}
                    />
                    <MultiSelectGroup
                        label="Groups" icon={FolderTree}
                        hierarchical
                        items={buildHierarchy(groups)}
                        selected={value.groupIds}
                        onChange={(ids) => onChange({ groupIds: ids })}
                    />
                    <MultiSelectGroup
                        label="Categories" icon={Boxes}
                        hierarchical
                        items={buildHierarchy(categories)}
                        selected={value.categoryIds}
                        onChange={(ids) => onChange({ categoryIds: ids })}
                    />
                </div>
            </div>

            {/* Range filters — three segments */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <RangeSegment
                    icon={IndianRupee}
                    title="Cost range"
                    // helper="Applied to InvProduct.costPaise (last-purchase snapshot). Both bounds optional."
                    minLabel="Min ₹"
                    maxLabel="Max ₹"
                    minValue={value.minCost}
                    maxValue={value.maxCost}
                    onMin={(v) => onChange({ minCost: v })}
                    onMax={(v) => onChange({ maxCost: v })}
                    inputMode="decimal"
                    placeholderMin="0.00"
                    placeholderMax="∞"
                />
                <RangeSegment
                    icon={Package}
                    title="Stock range"
                    // helper="Units on hand (InvProduct.stock). Products with stock not tracked are excluded when this filter is set."
                    minLabel="Min units"
                    maxLabel="Max units"
                    minValue={value.minStock}
                    maxValue={value.maxStock}
                    onMin={(v) => onChange({ minStock: v })}
                    onMax={(v) => onChange({ maxStock: v })}
                    inputMode="numeric"
                    placeholderMin="0"
                    placeholderMax="∞"
                />
                {showStaleDays ? (
                    <RangeSegment
                        icon={CalendarClock}
                        title="Days since last sale"
                        // helper="Window for staleness. Never-sold products have infinite age — they match the lower bound and fail the upper bound."
                        minLabel="From (days)"
                        maxLabel="To (days)"
                        minValue={value.minStaleDays}
                        maxValue={value.maxStaleDays}
                        onMin={(v) => onChange({ minStaleDays: v })}
                        onMax={(v) => onChange({ maxStaleDays: v })}
                        inputMode="numeric"
                        placeholderMin="0"
                        placeholderMax="∞"
                    />
                ) : null}
            </div>

            {/* Attribute filters */}
            {/* <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        Attribute filters (attrsJson)
                    </p>
                    <Button type="button" variant="outline" size="sm" onClick={addAttrRow}>
                        <Plus className="size-3" />
                        Add row
                    </Button>
                </div>
                {value.attrs.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground italic">
                        No attribute filters. Click <strong>Add row</strong> to gate on values in <code>InvProduct.attrsJson</code>.
                    </p>
                ) : (
                    <div className="space-y-1.5">
                        {value.attrs.map((row, i) => (
                            <div key={i} className="grid grid-cols-[1fr_auto_1.5fr_auto] gap-2 items-start">
                                <Input
                                    placeholder="key (e.g. ram, color)"
                                    value={row.key}
                                    onChange={(e) => updateAttrRow(i, { key: e.target.value })}
                                    className="h-8 text-xs font-mono"
                                />
                                <Select
                                    value={row.op}
                                    onValueChange={(v) => updateAttrRow(i, { op: v as AttrOp })}
                                >
                                    <SelectTrigger className="h-8 w-[110px] text-xs">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {(Object.keys(ATTR_OP_LABEL) as AttrOp[]).map((op) => (
                                            <SelectItem key={op} value={op}>{ATTR_OP_LABEL[op]}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Input
                                    placeholder={attrValuePlaceholder(row.op)}
                                    value={row.value}
                                    onChange={(e) => updateAttrRow(i, { value: e.target.value })}
                                    className="h-8 text-xs font-mono"
                                />
                                <Button
                                    type="button" variant="ghost" size="icon-sm"
                                    aria-label="Remove"
                                    onClick={() => removeAttrRow(i)}
                                >
                                    <X className="size-4" />
                                </Button>
                            </div>
                        ))}
                    </div>
                )}
            </div> */}
        </>
    );
}

// ── Attribute value parsing ───────────────────────────────────────────────────

export function attrValuePlaceholder(op: AttrOp): string {
    switch (op) {
        case "eq": return "Black";
        case "in": return "Black, White, Silver";
        case "gte":
        case "lte": return "100";
        case "between": return "100, 500";
    }
}

export function parseAttrValue(op: AttrOp, raw: string): AttrFilterEntry {
    if (op === "in") {
        const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
        if (parts.length === 0) throw new Error("'in' needs at least one value (comma-separated)");
        // `in` lists only hold scalars (string | number); a "true"/"false" entry
        // stays a literal string rather than coercing to boolean.
        const value: (string | number)[] = parts.map((p) => {
            const c = coerce(p);
            return typeof c === "boolean" ? p : c;
        });
        return { op, value };
    }
    if (op === "between") {
        const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
        if (parts.length !== 2) throw new Error("'between' needs exactly two values (min, max)");
        const lo = coerce(parts[0]);
        const hi = coerce(parts[1]);
        if (typeof lo !== "number" || typeof hi !== "number")
            throw new Error("'between' values must be numeric");
        if (hi < lo) throw new Error("max must be ≥ min");
        return { op, value: [lo, hi] };
    }
    // eq / gte / lte — single scalar.
    return { op, value: coerce(raw) };
}

/** "123" → 123, "Black" → "Black", "true"/"false" → boolean. */
export function coerce(s: string): string | number | boolean {
    const lower = s.toLowerCase();
    if (lower === "true") return true;
    if (lower === "false") return false;
    const n = Number(s);
    return Number.isFinite(n) && s.trim() !== "" ? n : s;
}

// ── Client-side matcher (UI-only test page) ───────────────────────────────────
// Mirrors the server matcher's shape closely enough for a sample-data preview.
// NOTE: taxonomy membership is DIRECT — a product matches only if its own
// group/category id is ticked. Descendants are never expanded here; the
// "Include child" toggle in MultiSelectGroup does that expansion at tick time,
// so what you see ticked is exactly what matches.

export type ConditionProduct = {
    brandId: number | null;
    groupId: number | null;
    categoryId: number | null;
    /** Cost in rupees (decimal), or null when not known. */
    costRupees: number | null;
    /** Units on hand, or null when stock isn't tracked. */
    stock: number | null;
    /** Days since last sale; Infinity = never sold. */
    staleDays: number;
    attrs?: Record<string, unknown> | null;
};

function numOrNull(s: string): number | null {
    const t = s.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
}

function matchAttr(entry: AttrFilterEntry, raw: unknown): boolean {
    if (raw === undefined || raw === null) return false;
    switch (entry.op) {
        case "eq":
            return String(raw) === String(entry.value);
        case "in":
            return (entry.value as (string | number)[]).some((v) => String(v) === String(raw));
        case "gte":
            return Number(raw) >= Number(entry.value);
        case "lte":
            return Number(raw) <= Number(entry.value);
        case "between": {
            const [lo, hi] = entry.value as number[];
            const n = Number(raw);
            return n >= lo && n <= hi;
        }
    }
}

export function matchesConditions(p: ConditionProduct, v: MatchConditionsValue): boolean {
    if (v.brandIds.size > 0 && (p.brandId == null || !v.brandIds.has(p.brandId))) return false;
    if (v.groupIds.size > 0 && (p.groupId == null || !v.groupIds.has(p.groupId))) return false;
    if (v.categoryIds.size > 0 && (p.categoryId == null || !v.categoryIds.has(p.categoryId))) return false;

    const minCost = numOrNull(v.minCost);
    const maxCost = numOrNull(v.maxCost);
    if (minCost != null || maxCost != null) {
        if (p.costRupees == null) return false;
        if (minCost != null && p.costRupees < minCost) return false;
        if (maxCost != null && p.costRupees > maxCost) return false;
    }

    const minStock = numOrNull(v.minStock);
    const maxStock = numOrNull(v.maxStock);
    if (minStock != null || maxStock != null) {
        if (p.stock == null) return false; // not tracked → excluded when filter set
        if (minStock != null && p.stock < minStock) return false;
        if (maxStock != null && p.stock > maxStock) return false;
    }

    const minStale = numOrNull(v.minStaleDays);
    const maxStale = numOrNull(v.maxStaleDays);
    if (minStale != null && p.staleDays < minStale) return false;
    if (maxStale != null && p.staleDays > maxStale) return false; // Infinity fails any finite upper bound

    for (const row of v.attrs) {
        const key = row.key.trim();
        if (!key) continue;
        const raw = row.value.trim();
        if (raw === "") continue;
        let entry: AttrFilterEntry;
        try {
            entry = parseAttrValue(row.op, raw);
        } catch {
            continue; // invalid filter expression → ignore (don't exclude)
        }
        if (!matchAttr(entry, p.attrs?.[key])) return false;
    }

    return true;
}
