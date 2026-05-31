"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Strategies — /office/pricing-strategy/strategies
// Additive-margin model, DB-backed. You give POINTS to each dimension; a
// product's margin% is the SUM of the points of the values it falls under:
//   margin% = base + brand + category + group
//   price   = cost × (1 + margin/100)        (margin on cost; MRP ignored)
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
import type { PricingItem } from "@/app/api/pricing-strategy/items/route";
import type { StrategyPoints } from "@/shared/lib/schemas/pricingSchemas";

// Cap the preview table so a large catalogue stays responsive.
const PREVIEW_CAP = 300;

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
    brandId: number | null;
    categoryId: number | null;
    groupId: number | null;
    costPaise: number | null;
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
}: {
    title: string;
    icon: React.ComponentType<{ className?: string }>;
    rows: Row[];
    points: Points;
    onChange: (key: string, value: string) => void;
}) {
    const [open, setOpen] = useState(true);
    const [q, setQ] = useState("");
    const activeCount = rows.filter((r) => num(points[r.key] ?? "") !== 0).length;
    const needle = q.trim().toLowerCase();
    const shown = needle ? rows.filter((r) => r.label.toLowerCase().includes(needle)) : rows;
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
                )}
                <div className="divide-y">
                    {rows.length > 0 && shown.length === 0 ? (
                        <div className="px-3 py-2 text-xs italic text-muted-foreground">No matches.</div>
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
                                <span className="truncate">{r.label}</span>
                            </span>
                            <div className="flex shrink-0 items-center gap-1">
                                <Input
                                    inputMode="decimal"
                                    value={points[r.key] ?? ""}
                                    onChange={(e) => onChange(r.key, sanitize(e.target.value))}
                                    placeholder="0"
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

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PricingStrategiesPage() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const [brands, setBrands] = useState<Master[]>([]);
    const [categories, setCategories] = useState<Master[]>([]);
    const [groups, setGroups] = useState<Master[]>([]);
    const [products, setProducts] = useState<Product[]>([]);

    const [base, setBase] = useState("0");
    const [brandPts, setBrandPts] = useState<Points>({});
    const [catPts, setCatPts] = useState<Points>({});
    const [groupPts, setGroupPts] = useState<Points>({});

    const [query, setQuery] = useState("");
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [conditions, setConditions] = useState<MatchConditionsValue>(() => emptyMatchConditions());

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
                        brandId: it.brandId,
                        categoryId: it.categoryId,
                        groupId: it.groupId,
                        costPaise: it.resolvedCostPaise,
                        stock: it.stock,
                    })),
                );
                const p = pts.data;
                setBase(String(p.base ?? 0));
                setBrandPts(numMapToStr(p.brand ?? {}));
                setCatPts(numMapToStr(p.category ?? {}));
                setGroupPts(numMapToStr(p.group ?? {}));
            } catch {
                if (alive) toast.error("Failed to load strategy data.");
            } finally {
                if (alive) setLoading(false);
            }
        })();
        return () => { alive = false; };
    }, []);

    const baseN = num(base);

    const rows = useMemo(() => {
        return products.map((p) => {
            const pieces: Piece[] = [
                { label: "base", pts: baseN },
                { label: `brand · ${nameOf(brands, p.brandId)}`, pts: p.brandId != null ? num(brandPts[String(p.brandId)] ?? "") : 0 },
                { label: `category · ${nameOf(categories, p.categoryId)}`, pts: p.categoryId != null ? num(catPts[String(p.categoryId)] ?? "") : 0 },
                { label: `group · ${nameOf(groups, p.groupId)}`, pts: p.groupId != null ? num(groupPts[String(p.groupId)] ?? "") : 0 },
            ];
            const margin = pieces.reduce((a, x) => a + x.pts, 0);
            const price = p.costPaise != null ? Math.round(p.costPaise * (1 + margin / 100)) : null;
            return { p, pieces, margin, price };
        });
    }, [products, brands, categories, groups, baseN, brandPts, catPts, groupPts]);

    // Active facet count for the Filter button badge.
    const filterCount =
        (conditions.brandIds.size > 0 ? 1 : 0) +
        (conditions.groupIds.size > 0 ? 1 : 0) +
        (conditions.categoryIds.size > 0 ? 1 : 0) +
        (conditions.minCost.trim() || conditions.maxCost.trim() ? 1 : 0) +
        (conditions.minStock.trim() || conditions.maxStock.trim() ? 1 : 0);

    // Product filter — text search AND the Match-conditions filter.
    const visible = useMemo(() => {
        const q = query.trim().toLowerCase();
        return rows.filter(({ p }) => {
            const textOk =
                !q ||
                p.name.toLowerCase().includes(q) ||
                nameOf(brands, p.brandId).toLowerCase().includes(q) ||
                nameOf(categories, p.categoryId).toLowerCase().includes(q) ||
                nameOf(groups, p.groupId).toLowerCase().includes(q);
            if (!textOk) return false;
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
    }, [rows, query, conditions, brands, categories, groups]);

    const capped = visible.slice(0, PREVIEW_CAP);
    const truncated = visible.length > PREVIEW_CAP;

    const stats = useMemo(() => {
        const ms = visible.map((r) => r.margin);
        if (ms.length === 0) return { avg: 0, min: 0, max: 0 };
        const avg = ms.reduce((a, x) => a + x, 0) / ms.length;
        return { avg, min: Math.min(...ms), max: Math.max(...ms) };
    }, [visible]);

    const reset = () => {
        setBase("0");
        setBrandPts({});
        setCatPts({});
        setGroupPts({});
    };

    const save = async () => {
        setSaving(true);
        try {
            const payload: StrategyPoints = {
                base: baseN,
                brand: strMapToNum(brandPts),
                category: strMapToNum(catPts),
                group: strMapToNum(groupPts),
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
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(200px,250px)_1fr] lg:grid-rows-[minmax(0,1fr)]">
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
                                    placeholder="0"
                                    className="h-6 w-10 text-right font-mono text-xs"
                                />
                                <span className="text-[10px] text-muted-foreground">pts</span>
                            </div>
                        </div>
                    </div>

                    <PointSection title="Brands" icon={Tag} rows={flatRows(brands)} points={brandPts}
                        onChange={(k, v) => setBrandPts((s) => ({ ...s, [k]: v }))} />
                    <PointSection title="Categories" icon={FolderTree} rows={treeRows(categories)} points={catPts}
                        onChange={(k, v) => setCatPts((s) => ({ ...s, [k]: v }))} />
                    <PointSection title="Groups" icon={Boxes} rows={treeRows(groups)} points={groupPts}
                        onChange={(k, v) => setGroupPts((s) => ({ ...s, [k]: v }))} />
                </div>

                {/* ── Live preview ── */}
                <div className="flex min-h-0 flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <div className="relative w-56">
                                <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder="Filter products…"
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
                                variant={filtersOpen ? "secondary" : "outline"}
                                size="sm"
                                className="h-8"
                                onClick={() => setFiltersOpen((o) => !o)}
                            >
                                <Filter className="size-3.5" /> Filters
                                {filterCount > 0 ? (
                                    <span className="ml-1 rounded bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                                        {filterCount}
                                    </span>
                                ) : null}
                            </Button>
                            <Button type="button" variant="outline" size="sm" className="h-8" onClick={reset}>
                                <RotateCcw className="size-4" /> Reset
                            </Button>
                            <Button type="button" size="sm" className="h-8" onClick={save} disabled={saving}>
                                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save
                            </Button>
                        </div>
                    </div>

                    {filtersOpen ? (
                        <div className="rounded-md border bg-muted/30 p-3">
                            <div className="mb-3 flex items-center justify-between">
                                <span className="text-xs font-medium">Filters — all parameters &amp; ranges</span>
                                {filterCount > 0 ? (
                                    <button
                                        type="button"
                                        onClick={() => setConditions(emptyMatchConditions())}
                                        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                                    >
                                        Clear all ({filterCount})
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
                                />
                            </div>
                        </div>
                    ) : null}

                    {/* Flex-column table: thead is a fixed flex item, tbody is the only
                        scroll region. Every row shares one CSS-grid template so the
                        header and body columns stay aligned without table layout. */}
                    <div
                        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-sm border bg-card [&>div]:flex [&>div]:min-h-0 [&>div]:flex-1 [&>div]:flex-col [&>div]:overflow-hidden"
                        style={{ "--sbw": `${scrollbarW}px` } as React.CSSProperties}
                    >
                        <Table className="flex min-h-0 flex-1 flex-col [&_thead]:block [&_thead]:shrink-0 [&_thead]:pr-[var(--sbw)] [&_tbody]:block [&_tbody]:min-h-0 [&_tbody]:flex-1 [&_tbody]:overflow-y-auto [&_tbody]:[scrollbar-gutter:stable] [&_tr]:grid [&_tr]:grid-cols-[minmax(0,1fr)_160px_72px_104px_104px] [&_thead_tr]:items-center [&_tbody_tr]:items-start [&_th]:px-3 [&_th]:py-2 [&_th]:whitespace-normal [&_td]:px-3 [&_td]:py-2">
                            <TableHeader className="bg-muted [&_tr]:border-b [&_th]:shadow-[inset_0_-1px_0_var(--border)]">
                                <TableRow>
                                    <TableHead className="text-xs">Product</TableHead>
                                    <TableHead className="text-xs">Points breakdown</TableHead>
                                    <TableHead className="text-right text-xs">Margin %</TableHead>
                                    <TableHead className="text-right text-xs">Cost</TableHead>
                                    <TableHead className="text-right text-xs">Price</TableHead>
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
                                {capped.map(({ p, pieces, margin, price }) => (
                                    <TableRow key={p.id}>
                                        <TableCell className="whitespace-normal break-words text-sm font-medium leading-snug">{p.name}</TableCell>
                                        <TableCell className="whitespace-normal"><Breakdown pieces={pieces} margin={margin} /></TableCell>
                                        <TableCell className={`text-right font-mono text-xs font-semibold ${margin < 0 ? "text-red-600" : ""}`}>
                                            {margin.toFixed(1)}%
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-xs text-muted-foreground">
                                            {rupee(p.costPaise)}
                                        </TableCell>
                                        <TableCell className={`text-right font-mono text-xs font-semibold ${margin < 0 ? "text-red-600" : ""}`}>
                                            {rupee(price)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>

                        </Table>
                    </div>
                    {/* 
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                        {truncated ? `Showing first ${PREVIEW_CAP} of ${visible.length} matched products. ` : null}
                        Hover a number in the breakdown to see which dimension it came from. Cost is the
                        resolved cost basis; price = cost × (1 + margin%). Click <strong>Save</strong> to
                        store the points.
                    </p> */}
                </div>
            </div>
        </div>
    );
}
