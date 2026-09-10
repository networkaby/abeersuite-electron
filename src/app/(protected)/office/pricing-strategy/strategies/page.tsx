"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Strategies — /office/pricing-strategy/strategies
// Additive-margin model, DB-backed. You give POINTS to each dimension; a
// product's margin% is the SUM of the points of the values it falls under:
//   margin% = base + brand + category + group
//   price   = cost_incl × (1 + margin/100)   (margin on cost; MRP ignored)
// Cost + Price are shown GST-INCLUSIVE (cost_incl = cost × (1 + gst/100)), so the
// preview matches the engine's tax-inclusive sell price.
//
// Data is real:
//   • masters  — /api/inventory/brands | categories | product-groups
//   • products — /api/pricing-strategy/items (uses resolvedCostPaise for cost)
//   • points   — GET/PUT /api/pricing-strategy/points (the single org-wide set)
// Stock / idle-age / movement band points exist in the backend but are not
// edited here yet.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import {
    Calculator,
    RotateCcw,
    Tag,
    FolderTree,
    Boxes,
    ChevronDown,
    Search,
    Filter,
    Save,
    Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    MatchConditions,
    matchesConditions,
    emptyMatchConditions,
    buildHierarchy,
    type Master,
    type MatchConditionsValue,
    type ConditionProduct,
} from "@/modules/pricing-strategy/components/MatchConditions";
import { PaginationBar } from "@/shared/components/PaginationBar";
import type { PricingItem } from "@/modules/pricing-strategy/lib/pricingItem";
import type { StrategyPoints } from "@/shared/lib/schemas/pricingSchemas";
import { sumGroupPointsWithAncestors } from "@/modules/pricing-strategy/lib/groupPointsHierarchy";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { productMatchesSearch, searchableText } from "@/shared/lib/inventory";

// Default rows-per-page for the preview table (full list is paginated, not capped).
const DEFAULT_PAGE_SIZE = 50;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Parse a points field → number; empty/invalid → 0. Negatives allowed. */
const num = (s: string): number => {
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
};

/** Keep only digits, one leading "-", and a single ".". */
const sanitize = (raw: string): string => {
    let s = raw.replace(/[^0-9.-]/g, "");
    const neg = s.startsWith("-");
    s = s.replace(/-/g, "");
    const firstDot = s.indexOf(".");
    if (firstDot !== -1) {
        s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, "");
    }
    return (neg ? "-" : "") + s;
};

const rupee = (paise: number | null): string =>
    paise == null
        ? "—"
        : `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

const nameOf = (list: Master[], id: number | null): string =>
    id == null ? "—" : list.find((m) => m.id === id)?.name ?? `#${id}`;

// Min/max range filter over a points/margin value (blank bound = unbounded).
type Range = { min: string; max: string };
type RangeKey = "brand" | "category" | "group" | "product" | "margin";
const emptyRange = (): Range => ({ min: "", max: "" });
const emptyRanges = (): Record<RangeKey, Range> => ({
    brand: emptyRange(), category: emptyRange(), group: emptyRange(), product: emptyRange(), margin: emptyRange(),
});
const rangeActive = (r: Range): boolean => r.min.trim() !== "" || r.max.trim() !== "";
const inRange = (v: number, r: Range): boolean => {
    const lo = r.min.trim() === "" ? -Infinity : num(r.min);
    const hi = r.max.trim() === "" ? Infinity : num(r.max);
    return v >= lo && v <= hi;
};

// Points state (string-keyed by master id).
type Points = Record<string, string>;
const numMapToStr = (m: Record<string, number>): Points =>
    Object.fromEntries(Object.entries(m).map(([k, v]) => [k, String(v)]));
const strMapToNum = (m: Points): Record<string, number> =>
    Object.fromEntries(Object.entries(m).map(([k, v]) => [k, num(v)]));

// Product shape the preview needs (mapped from the items API).
type Product = {
    id: number;
    name: string;
    sku: string;
    brandId: number | null;
    categoryId: number | null;
    groupId: number | null;
    costPaise: number | null;
    gstPct: number;
    stock: number | null;
};

// ── Editable section ─────────────────────────────────────────────────────────

type Row = { key: string; label: string; depth: number };

function PointSection({
    title,
    icon: Icon,
    rows,
    points,
    onChange,
    relevantKeys,
}: {
    title: string;
    icon: React.ComponentType<{ className?: string }>;
    rows: Row[];
    points: Points;
    onChange: (key: string, value: string) => void;
    /** Keys worth showing — those carried by the products currently in view (plus
     *  their ancestors). Rows outside it are hidden unless "Show all" is on. */
    relevantKeys: Set<string>;
}) {
    const [open, setOpen] = useState(true);
    const [showAll, setShowAll] = useState(false);
    const [q, setQ] = useState("");
    const activeCount = rows.filter((r) => num(points[r.key] ?? "") !== 0).length;
    // Hide entries no product in view belongs to. A row that already carries
    // points stays visible regardless — otherwise a stray value would be
    // unreachable (invisible but still priced into every product under it).
    const relevant = showAll
        ? rows
        : rows.filter((r) => relevantKeys.has(r.key) || num(points[r.key] ?? "") !== 0);
    const hiddenCount = rows.length - relevant.length;
    const needle = q.trim().toLowerCase();
    const shown = needle ? relevant.filter((r) => r.label.toLowerCase().includes(needle)) : relevant;
    return (
        <div className="rounded-md border bg-card">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/40"
            >
                <Icon className="size-4 text-muted-foreground" />
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {title}
                </span>
                {activeCount > 0 ? (
                    <span className="rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">
                        {activeCount}
                    </span>
                ) : null}
                <ChevronDown
                    className={`ml-auto size-4 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`}
                />
            </button>
            <div className={`border-t ${open ? "" : "hidden"}`}>
                {rows.length === 0 ? (
                    <div className="px-3 py-2 text-xs italic text-muted-foreground">None yet.</div>
                ) : (
                    <>
                        <div className="flex items-center gap-1.5 border-b px-2.5 py-1.5">
                            <Search className="size-3.5 text-muted-foreground" />
                            <input
                                type="text"
                                value={q}
                                onChange={(e) => setQ(e.target.value)}
                                placeholder={`Filter ${title.toLowerCase()}…`}
                                className="flex-1 bg-transparent text-xs outline-none"
                            />
                        </div>
                        {hiddenCount > 0 || showAll ? (
                            <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-2.5 py-1 text-[10px] text-muted-foreground">
                                <span>
                                    {showAll
                                        ? `All ${rows.length} shown`
                                        : `${hiddenCount} hidden — no product in view`}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setShowAll((s) => !s)}
                                    className="underline-offset-2 hover:text-foreground hover:underline"
                                >
                                    {showAll ? "Only in view" : "Show all"}
                                </button>
                            </div>
                        ) : null}
                    </>
                )}
                <div className="divide-y">
                    {rows.length > 0 && shown.length === 0 ? (
                        <div className="px-3 py-2 text-xs italic text-muted-foreground">
                            {needle ? "No matches." : "Nothing in view."}
                        </div>
                    ) : null}
                    {shown.map((r) => (
                        <div key={r.key} className="flex items-center justify-between gap-3 py-1.5 pr-3"
                            style={{ paddingLeft: 12 + r.depth * 14 }}>
                            <span className="flex min-w-0 items-baseline gap-1.5 text-sm">
                                {r.depth > 0 ? (
                                    <span className="select-none font-mono text-[10px] leading-none text-muted-foreground/60" aria-hidden>
                                        {depthBullets(r.depth)}
                                    </span>
                                ) : null}
                                {/* The panel is narrow, so long names truncate — the
                                    title carries the full one on hover. */}
                                <span className="truncate" title={r.label}>{r.label}</span>
                            </span>
                            <div className="flex shrink-0 items-center gap-1">
                                <Input
                                    inputMode="decimal"
                                    value={points[r.key] ?? ""}
                                    onChange={(e) => onChange(r.key, sanitize(e.target.value))}
                                    onFocus={(e) => e.currentTarget.select()}
                                    placeholder="–"
                                    className="h-6 w-10 text-right font-mono text-xs"
                                />
                                <span className="text-[10px] text-muted-foreground">pts</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

/** Flat list (no hierarchy) — used for brands. */
const flatRows = (list: Master[]): Row[] =>
    list.map((m) => ({ key: String(m.id), label: m.name, depth: 0 }));

/** Parent→child ordered rows with depth — used for categories & groups. */
const treeRows = (list: Master[]): Row[] =>
    buildHierarchy(list).map((m) => ({ key: String(m.id), label: m.name, depth: m.depth }));

/** Depth bullets: depth 1 → "•", depth 2 → "• •", … (empty for parents). */
const depthBullets = (depth: number): string => Array(depth).fill("•").join(" ");

// ── Breakdown cell ───────────────────────────────────────────────────────────

type Piece = { label: string; pts: number };

function Breakdown({ pieces, margin }: { pieces: Piece[]; margin: number }) {
    return (
        <span className="font-mono text-[11px] text-muted-foreground">
            {pieces.map((pc, i) => {
                const sign = i === 0 ? "" : pc.pts < 0 ? " − " : " + ";
                const val = i === 0 ? pc.pts : Math.abs(pc.pts);
                return (
                    <span key={i} title={pc.label} className={pc.pts !== 0 ? "text-foreground" : undefined}>
                        {sign}
                        {val}
                    </span>
                );
            })}
            <span className="text-muted-foreground"> = {margin.toFixed(1)}</span>
        </span>
    );
}

// ── Range filter row ───────────────────────────────────────────────────────────

function RangeRow({
    label,
    value,
    onChange,
}: {
    label: string;
    value: Range;
    onChange: (v: Range) => void;
}) {
    return (
        <div className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
            <Input
                inputMode="decimal"
                value={value.min}
                onChange={(e) => onChange({ ...value, min: sanitize(e.target.value) })}
                onFocus={(e) => e.currentTarget.select()}
                placeholder="min"
                className="h-7 w-16 text-right font-mono text-xs"
            />
            <span className="text-xs text-muted-foreground">–</span>
            <Input
                inputMode="decimal"
                value={value.max}
                onChange={(e) => onChange({ ...value, max: sanitize(e.target.value) })}
                onFocus={(e) => e.currentTarget.select()}
                placeholder="max"
                className="h-7 w-16 text-right font-mono text-xs"
            />
        </div>
    );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PricingStrategiesPage() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const { data: session } = useSession();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];

    const [brands, setBrands] = useState<Master[]>([]);
    const [categories, setCategories] = useState<Master[]>([]);
    const [groups, setGroups] = useState<Master[]>([]);
    const [products, setProducts] = useState<Product[]>([]);

    const [base, setBase] = useState("");
    const [brandPts, setBrandPts] = useState<Points>({});
    const [catPts, setCatPts] = useState<Points>({});
    const [groupPts, setGroupPts] = useState<Points>({});
    // Per-product additive override, keyed by product id (as string).
    const [productPts, setProductPts] = useState<Points>({});

    const [query, setQuery] = useState("");
    // Two independent toggles instead of one — a combined taxonomy + range panel
    // grew tall enough to cover the page.
    const [taxonomyOpen, setTaxonomyOpen] = useState(false);
    const [rangesOpen, setRangesOpen] = useState(false);
    const [conditions, setConditions] = useState<MatchConditionsValue>(() => emptyMatchConditions());
    // Points / margin range filters (find products by their per-dimension points or total margin).
    const [ptRanges, setPtRanges] = useState<Record<RangeKey, Range>>(() => emptyRanges());

    // Pagination over the filtered preview rows.
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

    // Vertical scrollbar width — the tbody is the only scroll region, so we
    // reserve a matching gutter on the header to keep the columns aligned.
    const [scrollbarW, setScrollbarW] = useState(0);
    useEffect(() => {
        const el = document.createElement("div");
        el.style.cssText = "overflow:scroll;position:absolute;top:-9999px;width:50px;height:50px";
        document.body.appendChild(el);
        setScrollbarW(el.offsetWidth - el.clientWidth);
        el.remove();
    }, []);

    // Load masters + products + saved points on mount.
    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const [b, c, g, items, pts] = await Promise.all([
                    axios.get<Master[]>("/api/inventory/brands"),
                    axios.get<Master[]>("/api/inventory/categories"),
                    axios.get<Master[]>("/api/inventory/product-groups"),
                    axios.get<PricingItem[]>("/api/pricing-strategy/items"),
                    axios.get<StrategyPoints>("/api/pricing-strategy/points"),
                ]);
                if (!alive) return;
                setBrands(b.data.map((m) => ({ id: m.id, name: m.name })));
                setCategories(c.data.map((m) => ({ id: m.id, name: m.name, parentId: m.parentId ?? null })));
                setGroups(g.data.map((m) => ({ id: m.id, name: m.name, parentId: m.parentId ?? null })));
                setProducts(
                    items.data.map((it) => ({
                        id: it.id,
                        name: it.name,
                        sku: it.sku,
                        brandId: it.brandId,
                        categoryId: it.categoryId,
                        groupId: it.groupId,
                        costPaise: it.resolvedCostPaise,
                        gstPct: it.gstRatePct ?? 0,
                        stock: it.stock,
                    })),
                );
                const p = pts.data;
                setBase(p.base ? String(p.base) : "");
                setBrandPts(numMapToStr(p.brand ?? {}));
                setCatPts(numMapToStr(p.category ?? {}));
                setGroupPts(numMapToStr(p.group ?? {}));
                setProductPts(numMapToStr(p.product ?? {}));
            } catch {
                if (alive) toast.error("Failed to load strategy data.");
            } finally {
                if (alive) setLoading(false);
            }
        })();
        return () => { alive = false; };
    }, []);

    const baseN = num(base);

    // Group id → parentId, for cascading a group's points up to its ancestors
    // (mirrors the server engine in additiveMargin.ts).
    const groupParentById = useMemo(
        () => Object.fromEntries(groups.map((g) => [String(g.id), g.parentId ?? null])),
        [groups],
    );
    const groupPtsN = useMemo(() => strMapToNum(groupPts), [groupPts]);

    const rows = useMemo(() => {
        return products.map((p) => {
            const groupPtsTotal = p.groupId != null
                ? sumGroupPointsWithAncestors(p.groupId, groupPtsN, groupParentById)
                : 0;
            const pieces: Piece[] = [
                { label: "base", pts: baseN },
                { label: `brand · ${nameOf(brands, p.brandId)}`, pts: p.brandId != null ? num(brandPts[String(p.brandId)] ?? "") : 0 },
                { label: `category · ${nameOf(categories, p.categoryId)}`, pts: p.categoryId != null ? num(catPts[String(p.categoryId)] ?? "") : 0 },
                { label: `group · ${nameOf(groups, p.groupId)} (incl. parent)`, pts: groupPtsTotal },
                { label: "product (per-SKU override)", pts: num(productPts[String(p.id)] ?? "") },
            ];
            const margin = pieces.reduce((a, x) => a + x.pts, 0);
            // Cost + price are shown GST-INCLUSIVE: cost_incl = cost × (1 + gst/100),
            // price = cost_incl × (1 + margin/100) — matches the engine's inclusive price.
            const costIncl = p.costPaise != null ? Math.round(p.costPaise * (1 + p.gstPct / 100)) : null;
            const price = costIncl != null ? Math.round(costIncl * (1 + margin / 100)) : null;
            // Profit stays excl-vs-excl (tax-adjusted): priceExcl − costExcl =
            // cost × margin/100. Matches the items page's profit convention.
            const profit = p.costPaise != null ? Math.round(p.costPaise * (margin / 100)) : null;
            return { p, pieces, margin, costIncl, price, profit };
        });
    }, [products, brands, categories, groups, baseN, brandPts, catPts, groupPtsN, groupParentById, productPts]);

    // Active facet counts for the two Filter button badges — split so each
    // toggle's badge only counts what its own panel holds.
    const taxonomyFilterCount =
        (conditions.brandIds.size > 0 ? 1 : 0) +
        (conditions.groupIds.size > 0 ? 1 : 0) +
        (conditions.categoryIds.size > 0 ? 1 : 0);
    const rangeFilterCount =
        (conditions.minCost.trim() || conditions.maxCost.trim() ? 1 : 0) +
        (conditions.minStock.trim() || conditions.maxStock.trim() ? 1 : 0) +
        (Object.values(ptRanges).filter(rangeActive).length);

    // Product filter — text search AND the Match-conditions filter.
    const visible = useMemo(() => {
        const q = query.trim().toLowerCase();
        return rows.filter(({ p, pieces, margin }) => {
            // Brand / category / group are ids on the row, so their names have
            // to be resolved before they can be searched.
            const textOk = productMatchesSearch(p, q, {
                text: (x) => searchableText(
                    x.name, x.sku,
                    nameOf(brands, x.brandId), nameOf(categories, x.categoryId), nameOf(groups, x.groupId),
                ),
            });
            if (!textOk) return false;
            // Points / margin ranges. pieces = [base, brand, category, group, product].
            if (!inRange(pieces[1].pts, ptRanges.brand)) return false;
            if (!inRange(pieces[2].pts, ptRanges.category)) return false;
            if (!inRange(pieces[3].pts, ptRanges.group)) return false;
            if (!inRange(pieces[4].pts, ptRanges.product)) return false;
            if (!inRange(margin, ptRanges.margin)) return false;
            const cp: ConditionProduct = {
                brandId: p.brandId,
                groupId: p.groupId,
                categoryId: p.categoryId,
                costRupees: p.costPaise != null ? p.costPaise / 100 : null,
                stock: p.stock,
                staleDays: Infinity,
                attrs: null,
            };
            return matchesConditions(cp, conditions);
        });
    }, [rows, query, conditions, ptRanges, brands, categories, groups]);

    // Which brands / categories / groups the products currently in view actually
    // belong to. The point editors are trimmed to these, so the panel shows what
    // is worth editing instead of the whole master list — and it narrows further
    // as filters are applied. Ancestors are kept: a parent group prices its
    // children (points cascade), so it must stay reachable even when no product
    // sits on the parent itself.
    const relevant = useMemo(() => {
        const catParentById = Object.fromEntries(categories.map((c) => [String(c.id), c.parentId ?? null]));
        const addWithAncestors = (
            set: Set<string>,
            id: number | null,
            parentById: Record<string, number | null>,
        ) => {
            let cur: number | null = id;
            while (cur != null && !set.has(String(cur))) {
                set.add(String(cur));
                cur = parentById[String(cur)] ?? null;
            }
        };
        const brand = new Set<string>();
        const category = new Set<string>();
        const group = new Set<string>();
        for (const { p } of visible) {
            if (p.brandId != null) brand.add(String(p.brandId));
            addWithAncestors(category, p.categoryId, catParentById);
            addWithAncestors(group, p.groupId, groupParentById);
        }
        return { brand, category, group };
    }, [visible, categories, groupParentById]);

    // Reset to page 1 whenever the filtered result set changes size (new search /
    // filter), so the user never lands on an out-of-range page.
    useEffect(() => {
        setPage(1);
    }, [visible.length, pageSize]);

    const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
    const safePage = Math.min(page, pageCount);
    const pageRows = visible.slice((safePage - 1) * pageSize, safePage * pageSize);

    const stats = useMemo(() => {
        const ms = visible.map((r) => r.margin);
        if (ms.length === 0) return { avg: 0, min: 0, max: 0 };
        const avg = ms.reduce((a, x) => a + x, 0) / ms.length;
        return { avg, min: Math.min(...ms), max: Math.max(...ms) };
    }, [visible]);

    // Reset clears every point at once, which reprices the whole catalogue on the
    // next Save. Kept behind its own permission (not pricing:strategy:set) so the
    // people who tune points day to day aren't one stray click from wiping them,
    // and confirmed even for those who hold it.
    const canReset = hasPermissionWithScope(permissions, PERMISSIONS.PRICING_STRATEGY_RESET);
    const reset = () => {
        if (!canReset) return;
        const filled =
            (baseN !== 0 ? 1 : 0) +
            [brandPts, catPts, groupPts, productPts]
                .reduce((a, m) => a + Object.values(m).filter((v) => num(v) !== 0).length, 0);
        if (filled > 0 && !window.confirm(
            `Clear all ${filled} strategy point value${filled === 1 ? "" : "s"}? Every product falls back to base only.`,
        )) return;
        setBase("");
        setBrandPts({});
        setCatPts({});
        setGroupPts({});
        setProductPts({});
    };

    const save = async () => {
        setSaving(true);
        try {
            const payload: StrategyPoints = {
                base: baseN,
                brand: strMapToNum(brandPts),
                category: strMapToNum(catPts),
                group: strMapToNum(groupPts),
                product: strMapToNum(productPts),
                stockBand: {},
                ageBand: {},
                moveBand: {},
            };
            const r = await axios.put<{ saved: number }>("/api/pricing-strategy/points", payload);
            toast.success(`Saved — ${r.data.saved} point value${r.data.saved === 1 ? "" : "s"} stored.`);
        } catch {
            toast.error("Failed to save points.");
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading strategy points…
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col px-2 pt-2 pb-1">
            {/* <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(300px,360px)_1fr] lg:grid-rows-[minmax(0,1fr)]"> */}
            {/* Preview track is minmax(0,1fr), NOT 1fr: a bare 1fr keeps
                min-width:auto, so the track grows to the table's min-width instead
                of letting the table scroll sideways inside it. */}
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(200px,250px)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
                {/* ── Point editors ── */}
                <div className="space-y-3 overflow-y-auto pb-2 lg:min-h-0">
                    <div className="flex items-center gap-2">
                        <Calculator className="size-5" aria-hidden />
                        <h2 className="text-lg font-semibold tracking-tight">Strategy points</h2>
                    </div>

                    <div className="rounded-md border bg-card">
                        <div className="flex items-center justify-between gap-3 px-3 py-2">
                            <Label htmlFor="base-pts" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Base points
                            </Label>
                            <div className="flex items-center gap-1">
                                <Input
                                    id="base-pts"
                                    inputMode="decimal"
                                    value={base}
                                    onChange={(e) => setBase(sanitize(e.target.value))}
                                    onFocus={(e) => e.currentTarget.select()}
                                    placeholder="–"
                                    className="h-6 w-10 text-right font-mono text-xs"
                                />
                                <span className="text-[10px] text-muted-foreground">pts</span>
                            </div>
                        </div>
                    </div>

                    <PointSection title="Brands" icon={Tag} rows={flatRows(brands)} points={brandPts}
                        relevantKeys={relevant.brand}
                        onChange={(k, v) => setBrandPts((s) => ({ ...s, [k]: v }))} />
                    <PointSection title="Categories" icon={FolderTree} rows={treeRows(categories)} points={catPts}
                        relevantKeys={relevant.category}
                        onChange={(k, v) => setCatPts((s) => ({ ...s, [k]: v }))} />
                    <PointSection title="Groups" icon={Boxes} rows={treeRows(groups)} points={groupPts}
                        relevantKeys={relevant.group}
                        onChange={(k, v) => setGroupPts((s) => ({ ...s, [k]: v }))} />
                </div>

                {/* ── Live preview ── */}
                {/* min-w-0 for the same reason as the track above — without it this
                    flex column reports the table's min-width as its own minimum. */}
                <div className="flex min-h-0 min-w-0 flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <div className="relative w-56">
                                <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder="Filter products or SKU…"
                                    className="h-8 pl-7 text-xs"
                                />
                            </div>
                            <span className="text-xs text-muted-foreground">
                                {visible.length} / {rows.length}
                            </span>
                        </div>

                        <div className="flex flex-wrap gap-2 text-xs">
                            <span className="rounded border bg-card px-2 py-1">
                                Avg margin <strong className="font-mono">{stats.avg.toFixed(1)}%</strong>
                            </span>
                            <span className="rounded border bg-card px-2 py-1">
                                Range <strong className="font-mono">{stats.min.toFixed(1)}%</strong> –{" "}
                                <strong className="font-mono">{stats.max.toFixed(1)}%</strong>
                            </span>
                        </div>

                        <div className="ml-auto flex items-center gap-2">
                            <Button
                                type="button"
                                variant={taxonomyOpen ? "secondary" : "outline"}
                                size="sm"
                                className="h-8"
                                onClick={() => setTaxonomyOpen((o) => !o)}
                            >
                                <Tag className="size-3.5" /> Filter
                                {taxonomyFilterCount > 0 ? (
                                    <span className="ml-1 rounded bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                                        {taxonomyFilterCount}
                                    </span>
                                ) : null}
                            </Button>
                            <Button
                                type="button"
                                variant={rangesOpen ? "secondary" : "outline"}
                                size="sm"
                                className="h-8"
                                onClick={() => setRangesOpen((o) => !o)}
                            >
                                <Filter className="size-3.5" /> Range filter
                                {rangeFilterCount > 0 ? (
                                    <span className="ml-1 rounded bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                                        {rangeFilterCount}
                                    </span>
                                ) : null}
                            </Button>
                            {canReset ? (
                                <Button type="button" variant="outline" size="sm" className="h-8" onClick={reset}>
                                    <RotateCcw className="size-4" /> Reset
                                </Button>
                            ) : null}
                            <Button type="button" size="sm" className="h-8" onClick={save} disabled={saving}>
                                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save
                            </Button>
                        </div>
                    </div>

                    {/* Split into two panels — combined they grew tall enough to cover
                        the page. Each opens independently and only carries its own
                        clear-all count. */}
                    {taxonomyOpen ? (
                        <div className="rounded-md border bg-muted/30 p-3">
                            <div className="mb-3 flex items-center justify-between">
                                <span className="text-xs font-medium">Filter</span>
                                {taxonomyFilterCount > 0 ? (
                                    <button
                                        type="button"
                                        onClick={() => setConditions((c) => ({
                                            ...c, brandIds: new Set(), groupIds: new Set(), categoryIds: new Set(),
                                        }))}
                                        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                                    >
                                        Clear ({taxonomyFilterCount})
                                    </button>
                                ) : null}
                            </div>
                            <MatchConditions
                                brands={brands}
                                groups={groups}
                                categories={categories}
                                value={conditions}
                                onChange={(patch) => setConditions((c) => ({ ...c, ...patch }))}
                                sections={["taxonomy"]}
                            />
                        </div>
                    ) : null}

                    {rangesOpen ? (
                        <div className="rounded-md border bg-muted/30 p-3">
                            <div className="mb-3 flex items-center justify-between">
                                <span className="text-xs font-medium">Range filter</span>
                                {rangeFilterCount > 0 ? (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setConditions((c) => ({
                                                ...c, minCost: "", maxCost: "", minStock: "", maxStock: "",
                                            }));
                                            setPtRanges(emptyRanges());
                                        }}
                                        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                                    >
                                        Clear ({rangeFilterCount})
                                    </button>
                                ) : null}
                            </div>
                            <div className="space-y-4">
                                <MatchConditions
                                    brands={brands}
                                    groups={groups}
                                    categories={categories}
                                    value={conditions}
                                    onChange={(patch) => setConditions((c) => ({ ...c, ...patch }))}
                                    showStaleDays={false}
                                    sections={["ranges"]}
                                />
                                <div className="space-y-2 border-t pt-3">
                                    <span className="text-xs font-medium">Points &amp; margin ranges</span>
                                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                        <RangeRow label="Brand pts" value={ptRanges.brand}
                                            onChange={(v) => setPtRanges((s) => ({ ...s, brand: v }))} />
                                        <RangeRow label="Category pts" value={ptRanges.category}
                                            onChange={(v) => setPtRanges((s) => ({ ...s, category: v }))} />
                                        <RangeRow label="Group pts" value={ptRanges.group}
                                            onChange={(v) => setPtRanges((s) => ({ ...s, group: v }))} />
                                        <RangeRow label="Product pts" value={ptRanges.product}
                                            onChange={(v) => setPtRanges((s) => ({ ...s, product: v }))} />
                                        <RangeRow label="Total margin %" value={ptRanges.margin}
                                            onChange={(v) => setPtRanges((s) => ({ ...s, margin: v }))} />
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : null}

                    {/* Flex-column table: thead is a fixed flex item, tbody is the only
                        vertical scroll region. Every row shares one CSS-grid template
                        so the header and body columns stay aligned without table layout.
                        Horizontal overflow is handled by the shadcn table container
                        (one level in), so thead and tbody slide together — and the
                        columns keep their widths instead of the product name being
                        squeezed to one letter per line on a narrow pane.
                        tbody must pin overflow-x to hidden: with overflow-y auto the
                        CSS spec computes a `visible` x-axis to `auto`, which would
                        give tbody its own sideways scrollbar and leave thead behind. */}
                    <div
                        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-sm border bg-card [&>div]:flex [&>div]:min-h-0 [&>div]:flex-1 [&>div]:flex-col [&>div]:overflow-x-auto [&>div]:overflow-y-hidden"
                        style={{ "--sbw": `${scrollbarW}px` } as React.CSSProperties}
                    >
                        <Table className="flex min-h-0 min-w-205 flex-1 flex-col [&_thead]:block [&_thead]:shrink-0 [&_thead]:pr-(--sbw) [&_tbody]:block [&_tbody]:min-h-0 [&_tbody]:flex-1 [&_tbody]:overflow-y-auto [&_tbody]:overflow-x-hidden [&_tbody]:[scrollbar-gutter:stable] [&_tr]:grid [&_tr]:grid-cols-[minmax(180px,1fr)_minmax(150px,170px)_84px_72px_88px_88px_88px] [&_thead_tr]:items-center [&_tbody_tr]:items-start [&_th]:px-3 [&_th]:py-2 [&_th]:whitespace-normal [&_td]:px-3 [&_td]:py-2">
                            <TableHeader className="bg-muted [&_tr]:border-b [&_th]:shadow-[inset_0_-1px_0_var(--border)]">
                                <TableRow>
                                    <TableHead className="text-xs">Product</TableHead>
                                    <TableHead className="text-xs">Points breakdown</TableHead>
                                    <TableHead className="text-right text-xs">Product pts</TableHead>
                                    <TableHead className="text-right text-xs">Margin %</TableHead>
                                    <TableHead className="text-right text-xs">Cost</TableHead>
                                    <TableHead className="text-right text-xs">Price</TableHead>
                                    <TableHead className="text-right text-xs">Profit</TableHead>
                                </TableRow>
                            </TableHeader>

                            <TableBody>
                                {visible.length === 0 ? (
                                    <TableRow>
                                        <TableCell className="col-span-full py-8 text-center text-sm text-muted-foreground">
                                            {products.length === 0 ? "No active products found." : `No products match “${query}”.`}
                                        </TableCell>
                                    </TableRow>
                                ) : null}
                                {pageRows.map(({ p, pieces, margin, costIncl, price, profit }) => (
                                    <TableRow key={p.id}>
                                        <TableCell className="whitespace-normal wrap-break-word text-sm font-medium leading-snug">{p.name}</TableCell>
                                        <TableCell className="whitespace-normal"><Breakdown pieces={pieces} margin={margin} /></TableCell>
                                        <TableCell className="flex items-center justify-end gap-1">
                                            <Input
                                                inputMode="decimal"
                                                value={productPts[String(p.id)] ?? ""}
                                                onChange={(e) =>
                                                    setProductPts((s) => ({ ...s, [String(p.id)]: sanitize(e.target.value) }))
                                                }
                                                onFocus={(e) => e.currentTarget.select()}
                                                placeholder="–"
                                                title="Per-SKU points — added to the brand/category/group sum (negative lowers price)"
                                                className="h-6 w-12 text-right font-mono text-xs"
                                            />
                                            <span className="text-[10px] text-muted-foreground">pts</span>
                                        </TableCell>
                                        <TableCell className={`text-right font-mono text-xs font-semibold ${margin < 0 ? "text-red-600" : ""}`}>
                                            {margin.toFixed(1)}%
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-xs text-muted-foreground">
                                            {rupee(costIncl)}
                                        </TableCell>
                                        <TableCell className={`text-right font-mono text-xs font-semibold ${margin < 0 ? "text-red-600" : ""}`}>
                                            {rupee(price)}
                                        </TableCell>
                                        <TableCell className={`text-right font-mono text-xs font-semibold ${profit != null && profit < 0 ? "text-red-600" : "text-emerald-700"}`}>
                                            {rupee(profit)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>

                        </Table>
                    </div>
                    <PaginationBar
                        total={visible.length}
                        page={safePage}
                        pageSize={pageSize}
                        onPageChange={setPage}
                        onPageSizeChange={setPageSize}
                        unitLabel="product"
                    />
                </div>
            </div>
        </div>
    );
}
