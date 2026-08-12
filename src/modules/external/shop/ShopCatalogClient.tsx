"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import type { ShopProductPublic } from "@/shared/lib/shop/productPublic";
import { demoRating } from "@/shared/lib/shop/productPublic";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import ProductCard from "./ProductCard";
import ProductListRow from "./ProductListRow";
import {
    Search,
    SlidersHorizontal,
    LayoutGrid,
    LayoutList,
    X,
    ChevronDown,
    Star,
} from "lucide-react";
import { cn } from "@/shared/lib/format/utils";
import { Suspense } from "react";

type SortKey = "featured" | "price-asc" | "price-desc" | "name" | "rating";

/** Products revealed per "page" — also the initial render size and scroll-load chunk. */
const PAGE_SIZE = 24;

/** The facet axes a product can be narrowed by. Counts are computed per axis. */
type FacetKey =
    | "q"
    | "department"
    | "category"
    | "collection"
    | "price"
    | "discount"
    | "stock"
    | "rating";

type PriceBand = { id: string; label: string; minPaise: number; maxPaise: number | null };

function norm(s: string) {
    return s.toLowerCase().trim();
}

function matchesQuery(p: ShopProductPublic, q: string) {
    if (!q) return true;
    const n = norm(q);
    return (
        norm(p.displayName).includes(n) ||
        (p.description && norm(p.description).includes(n)) ||
        norm(p.category).includes(n)
    );
}

function discountPct(p: ShopProductPublic) {
    if (!p.mrpPaise || p.mrpPaise <= p.pricePaise) return 0;
    return Math.round((1 - p.pricePaise / p.mrpPaise) * 100);
}

/** Round up to the nearest 1 / 2 / 5 × 10ⁿ so band edges read as round rupees. */
function niceStep(raw: number) {
    if (raw <= 0) return 1;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const unit = raw / mag;
    const nice = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10;
    return nice * mag;
}

/** Price brackets derived from the real catalog spread, not hardcoded slabs. */
function buildPriceBands(products: ShopProductPublic[]): PriceBand[] {
    if (products.length === 0) return [];
    const prices = products.map((p) => p.pricePaise);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    if (max <= min) return [];
    const step = niceStep((max - min) / 4);
    const start = Math.floor(min / step) * step;
    const bands: PriceBand[] = [];
    for (let edge = start; edge < max && bands.length < 5; edge += step) {
        const isLast = bands.length === 4 || edge + step >= max;
        bands.push({
            id: `p${edge}`,
            label: isLast
                ? `${formatRupeesFromPaise(edge)} & above`
                : `${formatRupeesFromPaise(edge)} – ${formatRupeesFromPaise(edge + step)}`,
            minPaise: edge,
            maxPaise: isLast ? null : edge + step,
        });
        if (isLast) break;
    }
    return bands;
}

const DISCOUNT_OPTIONS = [10, 20, 30, 50];
const RATING_OPTIONS = [4.5, 4.4, 4.3];

function toggle(set: Set<string>, value: string) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
}

function FacetSection({
    title,
    defaultOpen = true,
    children,
}: {
    title: string;
    defaultOpen?: boolean;
    children: React.ReactNode;
}) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="border-b border-border/60 pb-3 last:border-b-0 last:pb-0">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="flex w-full items-center justify-between py-2 text-left"
            >
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {title}
                </span>
                <ChevronDown
                    className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")}
                />
            </button>
            {open ? <div className="space-y-1.5 pt-1">{children}</div> : null}
        </div>
    );
}

function FacetOption({
    id,
    label,
    count,
    checked,
    onChange,
}: {
    id: string;
    label: React.ReactNode;
    count: number;
    checked: boolean;
    onChange: () => void;
}) {
    const disabled = count === 0 && !checked;
    return (
        <div className={cn("flex items-center gap-2", disabled && "opacity-40")}>
            <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
            <Label
                htmlFor={id}
                className={cn(
                    "flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 py-1 font-normal",
                    disabled && "cursor-not-allowed"
                )}
            >
                <span className="truncate">{label}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{count}</span>
            </Label>
        </div>
    );
}

/** A facet list that grows a filter box once it is long enough to need one. */
function FacetList({
    idPrefix,
    options,
    selected,
    onToggle,
}: {
    idPrefix: string;
    options: { value: string; count: number }[];
    selected: Set<string>;
    onToggle: (value: string) => void;
}) {
    const [needle, setNeedle] = useState("");
    const [expanded, setExpanded] = useState(false);
    const searchable = options.length > 8;
    const visible = useMemo(() => {
        const n = norm(needle);
        const hits = n ? options.filter((o) => norm(o.value).includes(n)) : options;
        return expanded || needle ? hits : hits.slice(0, 6);
    }, [options, needle, expanded]);
    const hiddenCount = options.length - visible.length;

    return (
        <>
            {searchable ? (
                <Input
                    value={needle}
                    onChange={(e) => setNeedle(e.target.value)}
                    placeholder="Search…"
                    className="mb-2 h-8 text-xs"
                />
            ) : null}
            <div className={cn(searchable && "max-h-56 overflow-y-auto pr-1")}>
                {visible.map((o) => (
                    <FacetOption
                        key={o.value}
                        id={`${idPrefix}-${o.value}`}
                        label={o.value}
                        count={o.count}
                        checked={selected.has(o.value)}
                        onChange={() => onToggle(o.value)}
                    />
                ))}
            </div>
            {!needle && hiddenCount > 0 ? (
                <button
                    type="button"
                    className="pt-1 text-xs font-medium text-primary hover:underline"
                    onClick={() => setExpanded(true)}
                >
                    + {hiddenCount} more
                </button>
            ) : null}
            {!needle && expanded && options.length > 6 ? (
                <button
                    type="button"
                    className="pt-1 text-xs font-medium text-primary hover:underline"
                    onClick={() => setExpanded(false)}
                >
                    Show less
                </button>
            ) : null}
        </>
    );
}

function ShopCatalogInner({
    products,
    allCategories,
    initialQuery,
    initialCategory,
    title = "Catalog",
}: {
    products: ShopProductPublic[];
    allCategories: string[];
    initialQuery: string;
    initialCategory: string;
    title?: string;
}) {
    const router = useRouter();
    const [q, setQ] = useState(initialQuery);
    const [departments, setDepartments] = useState<Set<string>>(new Set());
    const [cats, setCats] = useState<Set<string>>(
        () => new Set(initialCategory && initialCategory !== "all" ? [initialCategory] : [])
    );
    const [collections, setCollections] = useState<Set<string>>(new Set());
    const [priceIds, setPriceIds] = useState<Set<string>>(new Set());
    const [discountMin, setDiscountMin] = useState<number | null>(null);
    const [ratingMin, setRatingMin] = useState<number | null>(null);
    const [inStockOnly, setInStockOnly] = useState(false);
    const [sort, setSort] = useState<SortKey>("featured");
    const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
    const [showFilters, setShowFilters] = useState(false);

    const priceBands = useMemo(() => buildPriceBands(products), [products]);

    const categoryValues = useMemo(
        () =>
            [...new Set([...allCategories.filter(Boolean), ...products.map((p) => p.category)])].sort(
                (a, b) => a.localeCompare(b)
            ),
        [allCategories, products]
    );
    const departmentValues = useMemo(
        () =>
            [...new Set(products.map((p) => p.department).filter((d): d is string => !!d))].sort((a, b) =>
                a.localeCompare(b)
            ),
        [products]
    );
    const collectionValues = useMemo(
        () =>
            [...new Set(products.map((p) => p.collection).filter((c): c is string => !!c))].sort((a, b) =>
                a.localeCompare(b)
            ),
        [products]
    );

    /**
     * One predicate per axis. `matchesExcept` powers faceted counts: an option's
     * count is how many products it would yield with every OTHER filter applied.
     */
    const predicates = useMemo(() => {
        const bandById = new Map(priceBands.map((b) => [b.id, b]));
        return {
            q: (p: ShopProductPublic) => matchesQuery(p, q),
            department: (p: ShopProductPublic) =>
                departments.size === 0 || (p.department != null && departments.has(p.department)),
            category: (p: ShopProductPublic) => cats.size === 0 || cats.has(p.category),
            collection: (p: ShopProductPublic) =>
                collections.size === 0 || (p.collection != null && collections.has(p.collection)),
            price: (p: ShopProductPublic) =>
                priceIds.size === 0 ||
                [...priceIds].some((id) => {
                    const b = bandById.get(id);
                    if (!b) return false;
                    return p.pricePaise >= b.minPaise && (b.maxPaise == null || p.pricePaise < b.maxPaise);
                }),
            discount: (p: ShopProductPublic) => discountMin == null || discountPct(p) >= discountMin,
            stock: (p: ShopProductPublic) => !inStockOnly || p.stockStatus === "in_stock",
            rating: (p: ShopProductPublic) => ratingMin == null || demoRating(p.id).stars >= ratingMin,
        } satisfies Record<FacetKey, (p: ShopProductPublic) => boolean>;
    }, [q, departments, cats, collections, priceIds, discountMin, inStockOnly, ratingMin, priceBands]);

    const matchesExcept = useMemo(() => {
        const keys = Object.keys(predicates) as FacetKey[];
        return (p: ShopProductPublic, except: FacetKey) =>
            keys.every((k) => k === except || predicates[k](p));
    }, [predicates]);

    const countBy = useMemo(
        () => (except: FacetKey, extra: (p: ShopProductPublic) => boolean) =>
            products.reduce((n, p) => (matchesExcept(p, except) && extra(p) ? n + 1 : n), 0),
        [products, matchesExcept]
    );

    const filtered = useMemo(() => {
        const list = products.filter((p) => (Object.keys(predicates) as FacetKey[]).every((k) => predicates[k](p)));
        switch (sort) {
            case "price-asc":
                list.sort((a, b) => a.pricePaise - b.pricePaise);
                break;
            case "price-desc":
                list.sort((a, b) => b.pricePaise - a.pricePaise);
                break;
            case "name":
                list.sort((a, b) => a.displayName.localeCompare(b.displayName));
                break;
            case "rating":
                list.sort((a, b) => demoRating(b.id).stars - demoRating(a.id).stars);
                break;
            case "featured":
            default:
                list.sort((a, b) => {
                    const ba = a.badge ? 1 : 0;
                    const bb = b.badge ? 1 : 0;
                    if (bb !== ba) return bb - ba;
                    return a.displayName.localeCompare(b.displayName);
                });
                break;
        }
        return list;
    }, [products, predicates, sort]);

    // Reveal `filtered` in pages instead of rendering the whole result set at
    // once — resets to the first page whenever the result set itself changes
    // (a new filter/sort/search). Derived during render (not an effect) so the
    // reset lands in the same commit as the new `filtered` array.
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    const [pagedFor, setPagedFor] = useState(filtered);
    if (pagedFor !== filtered) {
        setPagedFor(filtered);
        setVisibleCount(PAGE_SIZE);
    }

    const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
    const hasMore = visibleCount < filtered.length;

    const loadMoreRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        const el = loadMoreRef.current;
        if (!el || !hasMore) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0]?.isIntersecting) {
                    setVisibleCount((c) => Math.min(c + PAGE_SIZE, filtered.length));
                }
            },
            { rootMargin: "600px" }
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [hasMore, filtered.length]);

    const grouped = useMemo(() => {
        const map = new Map<string, ShopProductPublic[]>();
        for (const p of visible) {
            const arr = map.get(p.category) ?? [];
            arr.push(p);
            map.set(p.category, arr);
        }
        return map;
    }, [visible]);

    // Keep the shareable URL in step with the search box and a single-category
    // pick (the server page reads only `q` and `category`).
    useEffect(() => {
        const t = setTimeout(() => {
            const url = new URL(window.location.href);
            if (q) url.searchParams.set("q", q);
            else url.searchParams.delete("q");
            if (cats.size === 1) url.searchParams.set("category", [...cats][0]);
            else url.searchParams.delete("category");
            const next = url.pathname + url.search;
            if (next !== window.location.pathname + window.location.search) router.replace(next);
        }, 400);
        return () => clearTimeout(t);
    }, [q, cats, router]);

    const activeChips = [
        ...[...departments].map((v) => ({ key: `dep-${v}`, label: v, clear: () => setDepartments((s) => toggle(s, v)) })),
        ...[...cats].map((v) => ({ key: `cat-${v}`, label: v, clear: () => setCats((s) => toggle(s, v)) })),
        ...[...collections].map((v) => ({ key: `col-${v}`, label: v, clear: () => setCollections((s) => toggle(s, v)) })),
        ...[...priceIds].map((id) => ({
            key: `price-${id}`,
            label: priceBands.find((b) => b.id === id)?.label ?? id,
            clear: () => setPriceIds((s) => toggle(s, id)),
        })),
        ...(discountMin != null
            ? [{ key: "disc", label: `${discountMin}% off or more`, clear: () => setDiscountMin(null) }]
            : []),
        ...(ratingMin != null
            ? [{ key: "rate", label: `${ratingMin}★ & above`, clear: () => setRatingMin(null) }]
            : []),
        ...(inStockOnly ? [{ key: "stock", label: "In stock", clear: () => setInStockOnly(false) }] : []),
    ];

    const clearAll = () => {
        setDepartments(new Set());
        setCats(new Set());
        setCollections(new Set());
        setPriceIds(new Set());
        setDiscountMin(null);
        setRatingMin(null);
        setInStockOnly(false);
    };

    const panel = (
        <div className="space-y-1">
            <div className="relative pb-3">
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input
                    className="pl-9"
                    value={q}
                    placeholder="Search catalog…"
                    onChange={(e) => setQ(e.target.value)}
                />
            </div>

            {departmentValues.length > 1 ? (
                <FacetSection title="Department">
                    <FacetList
                        idPrefix="dep"
                        options={departmentValues.map((v) => ({
                            value: v,
                            count: countBy("department", (p) => p.department === v),
                        }))}
                        selected={departments}
                        onToggle={(v) => setDepartments((s) => toggle(s, v))}
                    />
                </FacetSection>
            ) : null}

            {categoryValues.length > 1 ? (
                <FacetSection title="Category">
                    <FacetList
                        idPrefix="cat"
                        options={categoryValues.map((v) => ({
                            value: v,
                            count: countBy("category", (p) => p.category === v),
                        }))}
                        selected={cats}
                        onToggle={(v) => setCats((s) => toggle(s, v))}
                    />
                </FacetSection>
            ) : null}

            {priceBands.length > 1 ? (
                <FacetSection title="Price">
                    {priceBands.map((b) => (
                        <FacetOption
                            key={b.id}
                            id={`price-${b.id}`}
                            label={b.label}
                            count={countBy(
                                "price",
                                (p) => p.pricePaise >= b.minPaise && (b.maxPaise == null || p.pricePaise < b.maxPaise)
                            )}
                            checked={priceIds.has(b.id)}
                            onChange={() => setPriceIds((s) => toggle(s, b.id))}
                        />
                    ))}
                </FacetSection>
            ) : null}

            <FacetSection title="Discount">
                {DISCOUNT_OPTIONS.map((d) => (
                    <FacetOption
                        key={d}
                        id={`disc-${d}`}
                        label={`${d}% off or more`}
                        count={countBy("discount", (p) => discountPct(p) >= d)}
                        checked={discountMin === d}
                        onChange={() => setDiscountMin((cur) => (cur === d ? null : d))}
                    />
                ))}
            </FacetSection>

            <FacetSection title="Customer rating">
                {RATING_OPTIONS.map((r) => (
                    <FacetOption
                        key={r}
                        id={`rate-${r}`}
                        label={
                            <span className="flex items-center gap-1">
                                {r}
                                <Star className="size-3.5 fill-amber-400 text-amber-400" />
                                &amp; above
                            </span>
                        }
                        count={countBy("rating", (p) => demoRating(p.id).stars >= r)}
                        checked={ratingMin === r}
                        onChange={() => setRatingMin((cur) => (cur === r ? null : r))}
                    />
                ))}
            </FacetSection>

            {collectionValues.length > 1 ? (
                <FacetSection title="Collection" defaultOpen={false}>
                    <FacetList
                        idPrefix="col"
                        options={collectionValues.map((v) => ({
                            value: v,
                            count: countBy("collection", (p) => p.collection === v),
                        }))}
                        selected={collections}
                        onToggle={(v) => setCollections((s) => toggle(s, v))}
                    />
                </FacetSection>
            ) : null}

            <FacetSection title="Availability">
                <FacetOption
                    id="in-stock"
                    label="In stock only"
                    count={countBy("stock", (p) => p.stockStatus === "in_stock")}
                    checked={inStockOnly}
                    onChange={() => setInStockOnly((v) => !v)}
                />
            </FacetSection>
        </div>
    );

    return (
        <div
            id="catalog"
            className="mx-auto max-w-6xl scroll-mt-28 px-3 py-10 sm:scroll-mt-24 sm:px-4 sm:py-12 lg:scroll-mt-20"
        >
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
                {/* Desktop rail */}
                <aside className="hidden lg:block lg:w-64 lg:shrink-0 rounded-2xl border border-border/80 bg-card/50 p-4 backdrop-blur-sm">
                    <div className="mb-2 flex items-center justify-between">
                        <span className="font-semibold">Filters</span>
                        {activeChips.length > 0 ? (
                            <button
                                type="button"
                                className="text-xs font-medium text-primary hover:underline"
                                onClick={clearAll}
                            >
                                Clear all
                            </button>
                        ) : null}
                    </div>
                    {panel}
                </aside>

                {/* Mobile bottom sheet */}
                {showFilters ? (
                    <div className="fixed inset-0 z-50 flex flex-col bg-background lg:hidden">
                        <div className="flex items-center justify-between border-b border-border px-4 py-3">
                            <span className="font-semibold">Filters</span>
                            <div className="flex items-center gap-2">
                                {activeChips.length > 0 ? (
                                    <button
                                        type="button"
                                        className="text-xs font-medium text-primary"
                                        onClick={clearAll}
                                    >
                                        Clear all
                                    </button>
                                ) : null}
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setShowFilters(false)}
                                    aria-label="Close filters"
                                >
                                    <X className="size-5" />
                                </Button>
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto px-4 py-3">{panel}</div>
                        <div className="border-t border-border p-3">
                            <Button
                                type="button"
                                className="h-12 w-full touch-manipulation text-base"
                                onClick={() => setShowFilters(false)}
                            >
                                Show {filtered.length} product{filtered.length === 1 ? "" : "s"}
                            </Button>
                        </div>
                    </div>
                ) : null}

                <div className="min-w-0 flex-1 space-y-8">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <h2 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h2>
                            <p className="mt-1 text-sm text-muted-foreground">
                                {hasMore
                                    ? `Showing ${visible.length} of ${filtered.length} products`
                                    : `${filtered.length} product${filtered.length === 1 ? "" : "s"}`}{" "}
                                · filter, compare, and checkout securely
                            </p>
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="lg"
                                className="h-11 w-full touch-manipulation lg:hidden sm:h-10 sm:w-auto"
                                onClick={() => setShowFilters(true)}
                            >
                                <SlidersHorizontal className="mr-1 size-4" />
                                Filters
                                {activeChips.length > 0 ? (
                                    <span className="ml-1.5 rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
                                        {activeChips.length}
                                    </span>
                                ) : null}
                            </Button>
                            <div className="w-full sm:w-[200px]">
                                <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
                                    <SelectTrigger className="h-11 w-full touch-manipulation sm:h-10">
                                        <SelectValue placeholder="Sort" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="featured">Featured</SelectItem>
                                        <SelectItem value="rating">Top rated</SelectItem>
                                        <SelectItem value="price-asc">Price · Low to high</SelectItem>
                                        <SelectItem value="price-desc">Price · High to low</SelectItem>
                                        <SelectItem value="name">Name A–Z</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="flex justify-end rounded-lg border border-border p-0.5 sm:justify-start">
                                <Button
                                    type="button"
                                    variant={viewMode === "grid" ? "secondary" : "ghost"}
                                    size="icon"
                                    className="size-11 touch-manipulation sm:size-9"
                                    onClick={() => setViewMode("grid")}
                                    aria-label="Grid view"
                                >
                                    <LayoutGrid className="size-4" />
                                </Button>
                                <Button
                                    type="button"
                                    variant={viewMode === "list" ? "secondary" : "ghost"}
                                    size="icon"
                                    className="size-11 touch-manipulation sm:size-9"
                                    onClick={() => setViewMode("list")}
                                    aria-label="List view"
                                >
                                    <LayoutList className="size-4" />
                                </Button>
                            </div>
                        </div>
                    </div>

                    {activeChips.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-2">
                            {activeChips.map((c) => (
                                <button
                                    key={c.key}
                                    type="button"
                                    onClick={c.clear}
                                    className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium hover:bg-accent"
                                >
                                    {c.label}
                                    <X className="size-3" />
                                </button>
                            ))}
                            <button
                                type="button"
                                onClick={clearAll}
                                className="text-xs font-medium text-primary hover:underline"
                            >
                                Clear all
                            </button>
                        </div>
                    ) : null}

                    {filtered.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-border py-20 text-center text-muted-foreground">
                            No matches — try another search or clear filters.
                        </div>
                    ) : (
                        Array.from(grouped.entries()).map(([category, items]) => (
                            <section
                                key={category}
                                id={`cat-${encodeURIComponent(category)}`}
                                className="scroll-mt-24 space-y-4"
                            >
                                <div className="flex items-end justify-between gap-4 border-b border-border/60 pb-2">
                                    <h3 className="text-lg font-semibold">{category}</h3>
                                    <span className="text-xs uppercase tracking-wide text-muted-foreground">
                                        {items.length} item{items.length === 1 ? "" : "s"}
                                    </span>
                                </div>
                                {viewMode === "list" ? (
                                    <ul className="flex flex-col gap-4">
                                        {items.map((p) => (
                                            <li key={p.id}>
                                                <ProductListRow product={p} />
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <ul className="grid auto-rows-fr gap-6 sm:grid-cols-2 xl:grid-cols-3">
                                        {items.map((p) => (
                                            <li key={p.id} className="flex min-h-0 h-full flex-col">
                                                <ProductCard product={p} className="min-h-0 flex-1" />
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </section>
                        ))
                    )}

                    {hasMore ? (
                        <div ref={loadMoreRef} className="flex justify-center pt-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="lg"
                                className="h-11 touch-manipulation"
                                onClick={() => setVisibleCount((c) => Math.min(c + PAGE_SIZE, filtered.length))}
                            >
                                Load more ({filtered.length - visible.length} left)
                            </Button>
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

export default function ShopCatalogClient(props: {
    products: ShopProductPublic[];
    allCategories: string[];
    initialQuery: string;
    initialCategory: string;
    title?: string;
}) {
    return (
        <Suspense
            fallback={
                <div className="mx-auto max-w-6xl px-4 py-16 text-sm text-muted-foreground">Loading catalog…</div>
            }
        >
            <ShopCatalogInner {...props} />
        </Suspense>
    );
}
