"use client";

import { Fragment, Suspense, useEffect, useMemo, useRef, useState } from "react";
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
import ProductCard from "./ProductCard";
import ProductListRow from "./ProductListRow";
import {
    Search,
    SlidersHorizontal,
    LayoutGrid,
    LayoutList,
    X,
    ChevronDown,
} from "lucide-react";
import { cn } from "@/shared/lib/format/utils";
import { buildPriceBands, discountPct, DISCOUNT_OPTIONS, matchesQuery } from "@/shared/lib/shop/catalogFilters";
import { didYouMean, searchRelevance } from "@/shared/lib/shop/searchRank";
// Leaf import, NOT the inventory barrel — the barrel re-exports the Dexie
// catalogue, and none of that belongs in a public storefront bundle.
import AdUnit from "./ads/AdUnit";
import {
    AdPicker,
    CATALOG_BETWEEN_EVERY,
    CATALOG_BLOCK,
    adColumnSpan,
    type ResolvedAd,
    type ShopAdContext,
} from "@/shared/lib/shop/ads";

type SortKey = "featured" | "price-asc" | "price-desc" | "name";

/** Products revealed per "page" — also the initial render size and scroll-load chunk. */
const PAGE_SIZE = 24;
/** A result smaller than this gets "You may also like" groups below it. */
const RELATED_FILL = 12;
/** Most products one related group shows before its "See all". */
const RELATED_PER_GROUP = 6;

/** The facet axes a product can be narrowed by. Counts are computed per axis. */
type FacetKey =
    | "q"
    | "department"
    | "category"
    | "collection"
    | "price"
    | "discount"
    | "stock";

function norm(s: string) {
    return s.toLowerCase().trim();
}

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

/** Height an ad slot needs in the filter rail, gap included (300×250, 300×600). */
const RAIL_RECT_PX = 250 + 16;
const RAIL_TALL_PX = 600 + 16;
/** The rail's own padding and "Filters" header row. */
const RAIL_CHROME_PX = 64;

type FacetValue = { value: string; count: number };

/** A group in the facet tree; `own` is set when the group is itself a choice. */
type FacetNode = {
    key: string;
    label: string;
    own: FacetValue | null;
    children: FacetNode[];
    /** Products in the whole branch. */
    total: number;
    /** Every choice in the branch, `own` included. */
    values: string[];
};

/** A sub-group this small is not worth its own row until the shopper asks. */
const FACET_SMALL_SUBGROUP = 5;

function buildFacetTree(options: FacetValue[], pathOf: (value: string) => string[]): FacetNode[] {
    const root: FacetNode = { key: "", label: "", own: null, children: [], total: 0, values: [] };
    for (const o of options) {
        let node = root;
        for (const label of [...pathOf(o.value), o.value]) {
            let next = node.children.find((c) => c.label === label);
            if (!next) {
                next = { key: `${node.key}/${label}`, label, own: null, children: [], total: 0, values: [] };
                node.children.push(next);
            }
            next.total += o.count;
            next.values.push(o.value);
            node = next;
        }
        node.own = o;
    }
    const sort = (nodes: FacetNode[]) => {
        nodes.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
        nodes.forEach((n) => sort(n.children));
    };
    sort(root.children);
    return root.children;
}

function FacetTreeNode({
    node,
    idPrefix,
    selected,
    onToggle,
}: {
    node: FacetNode;
    idPrefix: string;
    selected: Set<string>;
    onToggle: (value: string) => void;
}) {
    // Small sub-groups fold into the parent behind a "+"; a ticked one shows.
    const [open, setOpen] = useState(
        () =>
            node.children.some((c) => c.total >= FACET_SMALL_SUBGROUP) ||
            node.values.some((v) => v !== node.own?.value && selected.has(v))
    );
    const id = `${idPrefix}-${node.key}`;
    if (node.children.length === 0 && node.own) {
        return (
            <FacetOption
                id={id}
                label={node.label}
                count={node.own.count}
                checked={selected.has(node.own.value)}
                onChange={() => onToggle(node.own!.value)}
            />
        );
    }
    // Ticking a group ticks its whole branch; it reads ticked once all are.
    const allTicked = node.values.every((v) => selected.has(v));
    const toggleBranch = () => node.values.forEach((v) => selected.has(v) === allTicked && onToggle(v));
    return (
        <div>
            <div className="flex items-center gap-1">
                <div className="min-w-0 flex-1">
                    <FacetOption id={id} label={node.label} count={node.total} checked={allTicked} onChange={toggleBranch} />
                </div>
                <button
                    type="button"
                    className="flex size-5 shrink-0 items-center justify-center rounded text-sm font-semibold text-muted-foreground hover:bg-muted"
                    onClick={() => setOpen((o) => !o)}
                    aria-label={open ? `Hide ${node.label} sub-groups` : `Show ${node.label} sub-groups`}
                    aria-expanded={open}
                >
                    {open ? "−" : "+"}
                </button>
            </div>
            {open ? (
                <div className="pl-3.5">
                    {node.children.map((c) => (
                        <FacetTreeNode key={c.key} node={c} idPrefix={idPrefix} selected={selected} onToggle={onToggle} />
                    ))}
                </div>
            ) : null}
        </div>
    );
}

/** A facet list that grows a filter box once it is long enough to need one. */
function FacetList({
    idPrefix,
    options: allOptions,
    selected,
    onToggle,
    pathOf,
}: {
    idPrefix: string;
    options: FacetValue[];
    selected: Set<string>;
    onToggle: (value: string) => void;
    /** Parent groups of a choice, top-first — turns the list into a tree. */
    pathOf?: (value: string) => string[];
}) {
    // Hide choices that would give zero products under the other filters,
    // but keep a ticked one so the shopper can still untick it.
    const options = useMemo(
        () => allOptions.filter((o) => o.value && (o.count > 0 || selected.has(o.value))),
        [allOptions, selected],
    );
    const [needle, setNeedle] = useState("");
    const searchable = options.length > 8;
    // Every choice is listed: the rail itself is screen-tall and scrolls.
    const visible = useMemo(() => {
        const n = norm(needle);
        return n ? options.filter((o) => norm(o.value).includes(n)) : options;
    }, [options, needle]);

    // With `pathOf`, the choices become a tree of groups. A search shows a flat list.
    const tree = useMemo(
        () => (pathOf && !needle ? buildFacetTree(visible, pathOf) : null),
        [visible, pathOf, needle]
    );

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
            {tree
                ? tree.map((n) => (
                      <FacetTreeNode
                          key={n.key}
                          node={n}
                          idPrefix={idPrefix}
                          selected={selected}
                          onToggle={onToggle}
                      />
                  ))
                : visible.map((o) => (
                      <FacetOption
                          key={o.value}
                          id={`${idPrefix}-${o.value}`}
                          label={o.value}
                          count={o.count}
                          checked={selected.has(o.value)}
                          onChange={() => onToggle(o.value)}
                      />
                  ))}
        </>
    );
}

function ShopCatalogInner({
    products,
    allCategories,
    initialQuery,
    initialCategory,
    initialCollection,
    title = "Catalog",
    adContext,
}: {
    products: ShopProductPublic[];
    allCategories: string[];
    initialQuery: string;
    initialCategory: string;
    initialCollection?: string;
    title?: string;
    /** The ad pool and visit seed — absent means no ads on this render. */
    adContext?: ShopAdContext;
}) {
    const router = useRouter();
    const [q, setQ] = useState(initialQuery);
    // The header search box pushes a new ?q= onto this same page, which keeps
    // this component mounted: take the new search when it arrives.
    const [seenQuery, setSeenQuery] = useState(initialQuery);
    if (initialQuery !== seenQuery) {
        setSeenQuery(initialQuery);
        setQ(initialQuery);
    }
    const [departments, setDepartments] = useState<Set<string>>(new Set());
    const [cats, setCats] = useState<Set<string>>(
        // "A|B" = several categories ticked at once (a combined home-page tile).
        () => new Set(initialCategory && initialCategory !== "all" ? initialCategory.split("|") : [])
    );
    const [collections, setCollections] = useState<Set<string>>(
        () => new Set(initialCollection ? [initialCollection] : [])
    );
    // Category → its parent groups below the department, top-first, for the
    // Category tree. The department (root) has its own facet, so it is left out.
    const categoryPathOf = useMemo(() => {
        const paths = new Map<string, string[]>();
        for (const p of products) {
            if (p.category && !paths.has(p.category)) {
                paths.set(p.category, [...p.categoryPath].reverse().slice(1));
            }
        }
        return (v: string) => paths.get(v) ?? [];
    }, [products]);
    const [priceIds, setPriceIds] = useState<Set<string>>(new Set());
    const [discountMin, setDiscountMin] = useState<number | null>(null);
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
            [...new Set(products.flatMap((p) => p.collections))].sort((a, b) =>
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
                collections.size === 0 || p.collections.some((c) => collections.has(c)),
            price: (p: ShopProductPublic) =>
                priceIds.size === 0 ||
                [...priceIds].some((id) => {
                    const b = bandById.get(id);
                    if (!b) return false;
                    return p.pricePaise >= b.minPaise && (b.maxPaise == null || p.pricePaise < b.maxPaise);
                }),
            discount: (p: ShopProductPublic) => discountMin == null || discountPct(p) >= discountMin,
            stock: (p: ShopProductPublic) => !inStockOnly || p.stockStatus === "in_stock",
        } satisfies Record<FacetKey, (p: ShopProductPublic) => boolean>;
    }, [q, departments, cats, collections, priceIds, discountMin, inStockOnly, priceBands]);

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
            case "featured":
            default:
                // With a search, "Featured" is relevance: the best title match first.
                if (q.trim()) {
                    list.sort((a, b) => searchRelevance(b, q) - searchRelevance(a, q) || a.displayName.localeCompare(b.displayName));
                    break;
                }
                list.sort((a, b) => {
                    const ba = a.badge ? 1 : 0;
                    const bb = b.badge ? 1 : 0;
                    if (bb !== ba) return bb - ba;
                    return a.displayName.localeCompare(b.displayName);
                });
                break;
        }
        return list;
    }, [products, predicates, sort, q]);

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

    // One flat grid, like Flipkart / Amazon listings: no per-group headings, so a
    // one-item group never leaves a half-empty row. Products still arrive grouped by
    // category (catalogue order) and every card names its own category. The grid is
    // cut into blocks of CATALOG_BLOCK (a whole number of rows at 2 and 3 columns)
    // so a strip ad can sit between blocks.
    const blocks = useMemo(() => {
        const out: ShopProductPublic[][] = [];
        for (let i = 0; i < visible.length; i += CATALOG_BLOCK) out.push(visible.slice(i, i + CATALOG_BLOCK));
        return out;
    }, [visible]);

    // A thin result (one small group, a short collection) leaves the page
    // half empty. Fill it with related groups: siblings under the same parent
    // group first, then the same department — in-stock first, a few per group,
    // until the page holds about RELATED_FILL products. Only once every match
    // is on screen, so it never sits between pages of the real result.
    const related = useMemo(() => {
        if (hasMore || filtered.length === 0 || filtered.length >= RELATED_FILL) return [];
        const shown = new Set(filtered.map((p) => p.id));
        const shownCats = new Set(filtered.map((p) => p.category));
        const parents = new Set(filtered.map((p) => p.categoryPath[0]).filter(Boolean));
        const depts = new Set(filtered.map((p) => p.department).filter(Boolean));
        const byCat = new Map<string, { rank: number; items: ShopProductPublic[] }>();
        for (const p of products) {
            if (shown.has(p.id) || !p.category || shownCats.has(p.category)) continue;
            const rank = parents.has(p.categoryPath[0]) ? 0 : depts.has(p.department) ? 1 : -1;
            if (rank < 0) continue;
            const e = byCat.get(p.category) ?? { rank, items: [] };
            e.items.push(p);
            byCat.set(p.category, e);
        }
        const inStockFirst = (a: ShopProductPublic, b: ShopProductPublic) =>
            Number(b.stockStatus === "in_stock") - Number(a.stockStatus === "in_stock") ||
            a.displayName.localeCompare(b.displayName);
        const out: { category: string; total: number; items: ShopProductPublic[] }[] = [];
        let room = RELATED_FILL - filtered.length;
        for (const [category, e] of [...byCat].sort(
            (a, b) => a[1].rank - b[1].rank || b[1].items.length - a[1].items.length
        )) {
            if (room <= 0) break;
            const items = [...e.items].sort(inStockFirst).slice(0, Math.max(3, Math.min(RELATED_PER_GROUP, room)));
            out.push({ category, total: e.items.length, items });
            room -= items.length;
        }
        return out;
    }, [products, filtered, hasMore]);

    // One picker per render, walked in reading order: the top strip, then
    // every group's row gap and the strip after each third group, then the
    // sidebar. Row gaps are worked out for the 3-column (xl) and 2-column (sm)
    // grids separately — a group of four leaves two boxes at xl and none at
    // sm — and rendered as two sets the CSS switches between, so a shared tile
    // appears once at either width. Phone width has one column: no gaps.
    const adPlan = useMemo(() => {
        if (!adContext) return null;
        const picker = new AdPicker(adContext.ads, {
            todayIso: adContext.todayIso,
            products,
            onPageProductIds: visible.map((p) => p.id),
            seed: adContext.adSeed,
            showPlaceholders: adContext.adPreview,
        });
        const top = picker.pick("catalogTop");
        const mobileTop = picker.pick("catalogMobileTop");
        // Only the last row can have empty boxes; ads fill them. A strip sits
        // after every CATALOG_BETWEEN_EVERY blocks.
        const between = new Map<number, ResolvedAd>();
        blocks.forEach((_, i) => {
            if ((i + 1) % CATALOG_BETWEEN_EVERY === 0 && i < blocks.length - 1) {
                const strip = picker.pick("catalogBetween");
                if (strip) between.set(i, strip);
            }
        });
        let tail: { xl: ResolvedAd[]; sm: ResolvedAd[] } = { xl: [], sm: [] };
        if (viewMode === "grid" && visible.length > 0) {
            const lastCategory = visible[visible.length - 1]!.category;
            const xl = picker.fillGap((3 - (visible.length % 3)) % 3, lastCategory);
            let sm: ResolvedAd[] = [];
            if (visible.length % 2 === 1) {
                const tile = xl.find((a) => a.size === "tile");
                sm = tile ? [tile] : picker.fillGap(1, lastCategory);
            }
            tail = { xl, sm };
        }
        const sidebarRect = picker.pick("sidebarRect");
        const sidebarTall = picker.pick("sidebarTall");
        return { top, mobileTop, tail, between, sidebarRect, sidebarTall };
    }, [adContext, products, visible, blocks, viewMode]);

    // Rail ads only fill the space the product column leaves below the filters,
    // so a short result list never gets a rail that runs on past it.
    const railPanelRef = useRef<HTMLDivElement>(null);
    const mainColRef = useRef<HTMLDivElement>(null);
    const [railRoom, setRailRoom] = useState(0);
    useEffect(() => {
        const panelEl = railPanelRef.current;
        const mainEl = mainColRef.current;
        if (!panelEl || !mainEl) return;
        const measure = () => setRailRoom(mainEl.offsetHeight - panelEl.offsetHeight - RAIL_CHROME_PX);
        const ro = new ResizeObserver(measure);
        ro.observe(panelEl);
        ro.observe(mainEl);
        measure();
        return () => ro.disconnect();
    }, []);

    // A banner pill links to ?collection= on this same page, which keeps this
    // component mounted: pick that collection alone, clearing the other filters
    // so the pill never lands on an empty list.
    const [pillCollection, setPillCollection] = useState(initialCollection);
    if (initialCollection !== pillCollection) {
        setPillCollection(initialCollection);
        if (initialCollection && !(collections.size === 1 && collections.has(initialCollection))) {
            setDepartments(new Set());
            setCats(new Set());
            setPriceIds(new Set());
            setDiscountMin(null);
            setCollections(new Set([initialCollection]));
        }
    }

    // Keep the shareable URL in step with the search box and a single-category
    // and single-collection pick (the server page reads `q`, `category`, `collection`).
    useEffect(() => {
        const t = setTimeout(() => {
            const url = new URL(window.location.href);
            if (q) url.searchParams.set("q", q);
            else url.searchParams.delete("q");
            if (cats.size === 1) url.searchParams.set("category", [...cats][0]);
            else url.searchParams.delete("category");
            if (collections.size === 1) url.searchParams.set("collection", [...collections][0]);
            else url.searchParams.delete("collection");
            // On /shop the bare URL is the browse hub, so the grid keeps `view=all`
            // — clearing the search must not swap the page out from under the user.
            if (url.pathname === "/shop") url.searchParams.set("view", "all");
            const next = url.pathname + url.search;
            if (next !== window.location.pathname + window.location.search) router.replace(next, { scroll: false });
        }, 400);
        return () => clearTimeout(t);
    }, [q, cats, collections, router]);

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
        ...(inStockOnly ? [{ key: "stock", label: "In stock", clear: () => setInStockOnly(false) }] : []),
    ];

    const clearAll = () => {
        setDepartments(new Set());
        setCats(new Set());
        setCollections(new Set());
        setPriceIds(new Set());
        setDiscountMin(null);
        setInStockOnly(false);
    };

    // Empty choices are hidden (a ticked one stays so it can be unticked), and
    // a section with nothing left to offer is hidden with them.
    const priceOpts =
        priceBands.length > 1
            ? priceBands
                  .map((b) => ({
                      b,
                      count: countBy(
                          "price",
                          (p) => p.pricePaise >= b.minPaise && (b.maxPaise == null || p.pricePaise < b.maxPaise)
                      ),
                  }))
                  .filter(({ b, count }) => count > 0 || priceIds.has(b.id))
            : [];
    const discountOpts = DISCOUNT_OPTIONS.map((d) => ({
        d,
        count: countBy("discount", (p) => discountPct(p) >= d),
    })).filter(({ d, count }) => count > 0 || discountMin === d);
    const inStockCount = countBy("stock", (p) => p.stockStatus === "in_stock");

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
                        pathOf={categoryPathOf}
                        selected={cats}
                        onToggle={(v) => setCats((s) => toggle(s, v))}
                    />
                </FacetSection>
            ) : null}

            {priceOpts.length > 0 ? (
                <FacetSection title="Price">
                    {priceOpts.map(({ b, count }) => (
                        <FacetOption
                            key={b.id}
                            id={`price-${b.id}`}
                            label={b.label}
                            count={count}
                            checked={priceIds.has(b.id)}
                            onChange={() => setPriceIds((s) => toggle(s, b.id))}
                        />
                    ))}
                </FacetSection>
            ) : null}

            {discountOpts.length > 0 ? (
                <FacetSection title="Discount">
                    {discountOpts.map(({ d, count }) => (
                        <FacetOption
                            key={d}
                            id={`disc-${d}`}
                            label={`${d}% off or more`}
                            count={count}
                            checked={discountMin === d}
                            onChange={() => setDiscountMin((cur) => (cur === d ? null : d))}
                        />
                    ))}
                </FacetSection>
            ) : null}

            {collectionValues.length > 1 ? (
                <FacetSection title="Collection" defaultOpen={Boolean(initialCollection)}>
                    <FacetList
                        idPrefix="col"
                        options={collectionValues.map((v) => ({
                            value: v,
                            count: countBy("collection", (p) => p.collections.includes(v)),
                        }))}
                        selected={collections}
                        onToggle={(v) => setCollections((s) => toggle(s, v))}
                    />
                </FacetSection>
            ) : null}

            {inStockCount > 0 || inStockOnly ? (
                <FacetSection title="Availability">
                    <FacetOption
                        id="in-stock"
                        label="In stock only"
                        count={inStockCount}
                        checked={inStockOnly}
                        onChange={() => setInStockOnly((v) => !v)}
                    />
                </FacetSection>
            ) : null}
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
                    <div ref={railPanelRef}>{panel}</div>
                    {adPlan?.sidebarRect && railRoom >= RAIL_RECT_PX ? (
                        <AdUnit ad={adPlan.sidebarRect} className="mt-4" />
                    ) : null}
                    {adPlan?.sidebarTall && railRoom >= RAIL_RECT_PX + RAIL_TALL_PX ? (
                        <AdUnit ad={adPlan.sidebarTall} className="mt-4" />
                    ) : null}
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

                <div ref={mainColRef} className="min-w-0 flex-1 space-y-8">
                    {adPlan?.top ? <AdUnit ad={adPlan.top} className="hidden sm:flex" /> : null}
                    {adPlan?.mobileTop ? <AdUnit ad={adPlan.mobileTop} className="sm:hidden" /> : null}
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <h2 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h2>
                            <p className="mt-1 text-sm text-muted-foreground">
                                {/* No "24 of 49" — the total stays a surprise while there is more to load. */}
                                {hasMore ? "" : `${filtered.length} product${filtered.length === 1 ? "" : "s"} · `}
                                Filter, compare, and checkout securely
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
                                        <SelectItem value="featured">{q.trim() ? "Relevance" : "Featured"}</SelectItem>
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
                            <NoResults
                                q={q}
                                products={products}
                                hasFilters={activeChips.length > 0}
                                onSearch={setQ}
                                onClearFilters={clearAll}
                            />
                        </div>
                    ) : (
                        blocks.map((items, i) => {
                            const isLast = i === blocks.length - 1;
                            const strip = adPlan?.between.get(i);
                            return (
                                <Fragment key={`block-${i}`}>
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
                                            {isLast
                                                ? adPlan?.tail.xl.map((ad) => (
                                                      <li
                                                          key={`ad-xl-${ad.key}`}
                                                          className={cn(
                                                              "hidden min-h-0 h-full flex-col xl:flex",
                                                              adColumnSpan(ad.size) === 2 && "xl:col-span-2"
                                                          )}
                                                      >
                                                          <AdUnit ad={ad} className="min-h-0 flex-1" />
                                                      </li>
                                                  ))
                                                : null}
                                            {isLast
                                                ? adPlan?.tail.sm.map((ad) => (
                                                      <li
                                                          key={`ad-sm-${ad.key}`}
                                                          className="hidden min-h-0 h-full flex-col sm:flex xl:hidden"
                                                      >
                                                          <AdUnit ad={ad} className="min-h-0 flex-1" />
                                                      </li>
                                                  ))
                                                : null}
                                        </ul>
                                    )}
                                    {strip ? <AdUnit ad={strip} /> : null}
                                </Fragment>
                            );
                        })
                    )}

                    {related.length > 0 ? (
                        <div className="space-y-8 border-t border-border/60 pt-8">
                            <h3 className="text-xl font-semibold tracking-tight">You may also like</h3>
                            {related.map(({ category, total, items }) => (
                                <section key={`rel-${category}`} className="space-y-4">
                                    <div className="flex items-end justify-between gap-4 border-b border-border/60 pb-2">
                                        <h4 className="text-lg font-semibold">{category}</h4>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setCats(new Set([category]));
                                                setCollections(new Set());
                                                window.scrollTo({ top: 0, behavior: "smooth" });
                                            }}
                                            className="text-xs font-medium text-primary hover:underline"
                                        >
                                            See all {total}
                                        </button>
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
                            ))}
                        </div>
                    ) : null}

                    {hasMore ? (
                        <div ref={loadMoreRef} className="flex justify-center pt-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="lg"
                                className="h-11 touch-manipulation"
                                onClick={() => setVisibleCount((c) => Math.min(c + PAGE_SIZE, filtered.length))}
                            >
                                Load more
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
    /** A collection to start ticked — the banner's collection pills. */
    initialCollection?: string;
    title?: string;
    adContext?: ShopAdContext;
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

/**
 * Never a dead end: offer a corrected spelling (a link the shopper chooses —
 * the list itself stays strict), a way out of the filters, and the biggest
 * categories to browse instead.
 */
function NoResults({
    q,
    products,
    hasFilters,
    onSearch,
    onClearFilters,
}: {
    q: string;
    products: ShopProductPublic[];
    hasFilters: boolean;
    onSearch: (q: string) => void;
    onClearFilters: () => void;
}) {
    const suggestion = useMemo(
        () => (q.trim() ? didYouMean(q, products.flatMap((p) => [p.displayName, p.category])) : null),
        [q, products]
    );
    const topCategories = useMemo(() => {
        const counts = new Map<string, number>();
        for (const p of products) if (p.category) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
        return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name]) => name);
    }, [products]);

    return (
        <div className="space-y-4 px-4">
            <p className="text-base font-medium text-foreground">
                {q.trim() ? <>No products found for “{q.trim()}”</> : "No products match these filters"}
            </p>
            {suggestion ? (
                <p>
                    Did you mean{" "}
                    <button type="button" onClick={() => onSearch(suggestion)} className="font-semibold text-primary hover:underline">
                        {suggestion}
                    </button>
                    ?
                </p>
            ) : null}
            {hasFilters ? (
                <button type="button" onClick={onClearFilters} className="text-sm font-medium text-primary hover:underline">
                    Clear all filters
                </button>
            ) : null}
            {topCategories.length > 0 ? (
                <div>
                    <p className="pb-2 text-sm">Or browse a popular category:</p>
                    <div className="flex flex-wrap justify-center gap-2">
                        {topCategories.map((c) => (
                            <a
                                key={c}
                                href={`/shop?view=all&category=${encodeURIComponent(c)}`}
                                className="rounded-full border border-border/80 bg-card px-3 py-1.5 text-sm text-foreground hover:border-primary/50"
                            >
                                {c}
                            </a>
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
}
