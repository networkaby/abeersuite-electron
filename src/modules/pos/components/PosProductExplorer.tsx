"use client";

// ── PosProductExplorer ────────────────────────────────────────────────────────
// A browsable catalogue panel for when the cashier doesn't know the exact
// name/SKU to type into the scan box. A thin hint strip sits on the left edge
// of the screen — hover it (or press F3) to slide the panel out. Because the
// panel covers the cart/product column underneath it, it carries its own
// narrow mini-cart list (+ an "already in cart" badge on each tile) so the
// cashier can see what's been added and avoid adding it twice.
//
// Open behaviour: a hover-only open auto-hides the moment the mouse leaves
// before the cashier has touched the panel ("preview"). Moving the mouse
// into the panel — or opening via F3 — "pins" it open; it then closes only
// on Esc, a click outside, or F3 again. Fully self-contained: no open state
// lives in the parent screen.
//
// Speed: while closed the panel filters nothing (it reads an empty list), and
// while open the search + all three facet rails come out of ONE memoised pass
// over the catalogue, fed a deferred query so typing never waits on the grid.

import { type Nested, buildNestedTree, flattenNested, nestedIds, treeLabel } from "@/shared/lib/tree";
import { memo, useDeferredValue, useEffect, useMemo, useRef, useState, useEffectEvent } from "react";
import { ChevronRight, PackageSearch, X, Plus } from "lucide-react";
import { useValueChange } from "@/shared/hooks";
import { Input } from "@/components/ui/input";
import { formatInr } from "@/shared/lib/format";
import { productMatchesSearch, readCachedMasters, syncMasters } from "@/shared/lib/inventory";
import type { ProductOption, CartLine } from "@/modules/pos/lib/posDraftTypes";
import { cloudinaryThumb } from "@/shared/lib/cloudinaryImage";

const NO_PRODUCTS: ProductOption[] = [];

/** Number of products to show in the grid before the next scroll-triggered batch. */
const PAGE_SIZE = 50;

// The old "pos-product-thumbs" Cache API store was written but never read (every
// photo was fetched twice for nothing). Removed 2026-11-24; this drops what older
// builds left in the browser. Best-effort, once per page load.
if (typeof caches !== "undefined") void caches.delete("pos-product-thumbs").catch(() => {});

/** Loose shape shared by the cached brand/category/group master rows —
 *  matching the `Opt`-style cast other master consumers already use. */
type MasterOpt = { id: number; name?: string; parentId?: number | null; isActive?: boolean };
type GroupNode = Nested<{ id: number; name: string; parentId?: number | null }>;

/** Group and Category are both self-referential trees (see InvProductGroup /
 *  InvCategory) — this builds either into a nested tree, active rows only. */
function buildTree(rows: MasterOpt[]): GroupNode[] {
    return buildNestedTree(
        rows.filter((r) => r.isActive !== false).map((r) => ({ id: r.id, name: r.name ?? "—", parentId: r.parentId })),
    );
}

/** Keep only nodes that (directly or via a descendant) have a matching
 *  product, or are still selected — so an emptied-out branch drops out of
 *  the rail instead of leading to a dead end, but picking a facet never
 *  makes its own current selection vanish out from under it. */
function pruneTree(nodes: GroupNode[], keepIds: Set<number>): GroupNode[] {
    return nodes
        .map((n) => ({ ...n, children: pruneTree(n.children, keepIds) }))
        .filter((n) => keepIds.has(n.id) || n.children.length > 0);
}

function GroupTree({ nodes, depth, selectedId, onSelect }: {
    nodes: GroupNode[];
    depth: number;
    selectedId: number | null;
    onSelect: (node: GroupNode | null) => void;
}) {
    return (
        <>
            {nodes.map((n) => (
                <div key={n.id}>
                    <button
                        type="button"
                        onClick={() => onSelect(selectedId === n.id ? null : n)}
                        style={{ paddingLeft: 8 + depth * 12 }}
                        className={`flex w-full items-center gap-1 rounded px-2 py-1 text-left text-[11px] leading-tight ${selectedId === n.id ? "bg-violet-600 font-semibold text-white shadow-sm" : "hover:bg-violet-100/70 dark:hover:bg-violet-500/10"}`}
                    >
                        {n.children.length > 0 && <ChevronRight size={9} className="shrink-0 opacity-50" />}
                        <span className="truncate">{n.name}</span>
                    </button>
                    {n.children.length > 0 && (
                        <GroupTree nodes={n.children} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />
                    )}
                </div>
            ))}
        </>
    );
}

export const PosProductExplorer = memo(function PosProductExplorer({
    products,
    cart,
    addToCart,
    onHoverProduct,
}: {
    products: ProductOption[];
    cart: CartLine[];
    addToCart: (p: ProductOption) => void;
    /** Mouse resting on a tile — mirrored to the customer-facing DQ11 ("Add this
     *  item?") so the customer can see and agree before it's actually added.
     *  null clears the preview back to the real cart/idle view. */
    onHoverProduct: (p: ProductOption | null) => void;
}) {
    const [open, setOpen] = useState(false);
    const [pinned, setPinned] = useState(false);
    const [query, setQuery] = useState("");
    const [groupTree, setGroupTree] = useState<GroupNode[]>([]);
    const [categoryTree, setCategoryTree] = useState<GroupNode[]>([]);
    const [brands, setBrands] = useState<MasterOpt[]>([]);
    const [selectedGroup, setSelectedGroup] = useState<GroupNode | null>(null);
    const [selectedCategoryId, setSelectedCategoryId] = useState<number | "">("");
    const [selectedBrand, setSelectedBrand] = useState("");
    const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    const sentinelRef = useRef<HTMLDivElement | null>(null);

    // Brand / group / category — same cached-then-synced masters every product
    // form already reads, so opening the explorer never waits on a fresh fetch.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const apply = (m: Awaited<ReturnType<typeof readCachedMasters>>) => {
                if (!m || cancelled) return;
                setGroupTree(buildTree(m.groups as MasterOpt[]));
                setCategoryTree(buildTree(m.categories as MasterOpt[]));
                setBrands((m.brands as MasterOpt[]).filter((b) => b.isActive !== false));
            };
            apply(await readCachedMasters());
            apply(await syncMasters());
        })();
        return () => { cancelled = true; };
    }, []);

    const cancelClose = () => {
        if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    };
    const close = () => { cancelClose(); setOpen(false); setPinned(false); setQuery(""); onHoverProduct(null); };
    // Only a hover-preview (not yet pinned) auto-hides on mouse-leave.
    const scheduleClose = () => {
        if (pinned) return;
        cancelClose();
        closeTimer.current = setTimeout(() => setOpen(false), 150);
    };

    // F3 toggles the explorer from anywhere — a keyboard open has no "leave"
    // to auto-hide on, so it opens pinned. Esc closes it while open.
    const closeFromKey = useEffectEvent(() => close());
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "F3") {
                e.preventDefault();
                if (open) closeFromKey();
                else { setOpen(true); setPinned(true); }
            } else if (e.key === "Escape" && open) {
                closeFromKey();
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [open]);

    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount-only cleanup, onHoverProduct is stable enough that re-running this on every render would be pointless churn
    useEffect(() => () => { cancelClose(); onHoverProduct(null); }, []);

    // Group drill-down includes the selected node's descendants; category
    // stays flat (it's a cross-cutting merchandising tag more than a browse
    // hierarchy — see InvCategory's schema comment). Brand is flat too. All
    // three AND together with the text filter.
    const allowedGroupIds = useMemo(() => selectedGroup ? new Set(nestedIds(selectedGroup)) : null, [selectedGroup]);
    const q = useDeferredValue(query.trim());
    const source = open ? products : NO_PRODUCTS;

    /** One pass: each product is tested once per facet, then lands in the grid
     *  (passes all four) and in each rail whose OTHER three facets it passes —
     *  so picking a group empties out brands with nothing in it and vice versa,
     *  instead of the two filters fighting each other silently. */
    const { filtered, availableGroupIds, availableCategoryIds, availableBrandNames } = useMemo(() => {
        const filtered: ProductOption[] = [];
        const groups = new Set<number>();
        const categories = new Set<number>();
        const brandNames = new Set<string>();
        for (const p of source) {
            if (q && !productMatchesSearch(p, q)) continue;
            const g = !allowedGroupIds || (p.groupId != null && allowedGroupIds.has(p.groupId));
            const c = selectedCategoryId === "" || p.categoryId === selectedCategoryId;
            const b = !selectedBrand || p.brand?.name === selectedBrand;
            if (g && c && b) filtered.push(p);
            if (c && b && p.groupId != null) groups.add(p.groupId);
            if (g && b && p.categoryId != null) categories.add(p.categoryId);
            if (g && c && p.brand?.name) brandNames.add(p.brand.name);
        }
        if (selectedGroup) groups.add(selectedGroup.id);
        if (selectedCategoryId !== "") categories.add(selectedCategoryId);
        if (selectedBrand) brandNames.add(selectedBrand);
        return { filtered, availableGroupIds: groups, availableCategoryIds: categories, availableBrandNames: brandNames };
    }, [source, q, allowedGroupIds, selectedGroup, selectedCategoryId, selectedBrand]);

    const cartQty = useMemo(() => new Map(cart.map((l) => [l.productId, l.qty])), [cart]);

    const visibleGroupTree = useMemo(() => pruneTree(groupTree, availableGroupIds), [groupTree, availableGroupIds]);
    const visibleCategoryTree = useMemo(() => pruneTree(categoryTree, availableCategoryIds), [categoryTree, availableCategoryIds]);
    const visibleBrands = useMemo(
        () => brands.filter((b) => !!b.name && availableBrandNames.has(b.name)),
        [brands, availableBrandNames],
    );

    // Reset the visible window whenever the filtered count changes (new query,
    // facet selection, or products array update).
    if (useValueChange(filtered.length)) setVisibleCount(PAGE_SIZE);

    const visibleProducts = filtered.slice(0, visibleCount);
    const hasMore = visibleCount < filtered.length;

    // Infinite scroll — when the sentinel div enters the viewport, load the
    // next page.  Uses the same IntersectionObserver pattern as day-book and
    // tickets registers.
    useEffect(() => {
        const node = sentinelRef.current;
        if (!node) return;
        const io = new IntersectionObserver(
            (entries) => { if (entries.some((e) => e.isIntersecting)) setVisibleCount((c) => c + PAGE_SIZE); },
            { root: node.closest("[class*='overflow-y-auto']"), threshold: 0.1 },
        );
        io.observe(node);
        return () => io.disconnect();
    }, [filtered.length, visibleCount]);

    const facetsActive = !!selectedGroup || selectedCategoryId !== "" || !!selectedBrand;

    return (
        <>
            {/* Thin hint strip — always visible on the left edge. Hover previews
            the panel; click pins it open (mouse-less/touch friendly). */}
            <div
                onMouseEnter={() => { cancelClose(); setOpen(true); }}
                onMouseLeave={scheduleClose}
                onClick={() => { setOpen(true); setPinned(true); }}
                title="Browse products (F3)"
                className="fixed left-0 top-1/2 z-30 flex h-24 w-3 -translate-y-1/2 cursor-pointer items-center justify-center rounded-r-md bg-linear-to-b from-violet-500 to-fuchsia-500 shadow-md shadow-violet-500/30 transition-all hover:w-4 hover:shadow-lg hover:shadow-violet-500/40"
            >
                <PackageSearch size={11} className="rotate-90 text-white" />
            </div>

            {/* Backdrop — only once pinned; a hover-preview shouldn't trap clicks
            before the cashier has actually committed to the panel. */}
            {pinned && (
                <div onClick={close} className="fixed inset-0 z-40 bg-black/40 transition-opacity duration-200" />
            )}

            <aside
                onMouseEnter={() => { cancelClose(); setPinned(true); }}
                onMouseLeave={scheduleClose}
                className={`fixed inset-y-0 left-0 z-50 flex w-245 max-w-[97vw] border-r-2 border-violet-400/60 bg-background shadow-2xl shadow-violet-950/20 transition-transform duration-200 ease-out dark:border-violet-500/40 ${open ? "translate-x-0" : "-translate-x-full"}`}
                aria-hidden={!open}
                inert={!open}
            >
                {/* Narrow mini-cart — this panel covers the real cart list, so keep
                a compact reminder of what's already been added. */}
                <div className="flex w-37.5 shrink-0 flex-col border-r border-border bg-linear-to-b from-emerald-50/70 to-transparent dark:from-emerald-950/20">
                    <div className="shrink-0 border-b border-border px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                        In cart ({cart.length})
                    </div>
                    <ul className="min-h-0 flex-1 overflow-y-auto">
                        {cart.length === 0 ? (
                            <li className="px-2 py-3 text-[11px] text-muted-foreground">Empty</li>
                        ) : (
                            cart.map((l) => (
                                <li key={l.productId} className="border-b border-border/50 px-2 py-1.5 text-[11px] leading-tight">
                                    <div className="truncate font-medium">{l.name}</div>
                                    <div className="font-semibold text-emerald-700 dark:text-emerald-300">× {l.qty}</div>
                                </li>
                            ))
                        )}
                    </ul>
                </div>

                {/* Group tree — the storefront navigation hierarchy (self-referential
                InvProductGroup). Selecting a node also matches its descendants.
                Empties out to whatever the Brand/Category picks still allow. */}
                <div className="flex w-40 shrink-0 flex-col border-r border-border">
                    <div className="shrink-0 border-b border-border bg-violet-50/70 px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
                        Groups
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto p-1">
                        <button
                            type="button"
                            onClick={() => setSelectedGroup(null)}
                            className={`mb-0.5 w-full rounded px-2 py-1 text-left text-[11px] ${!selectedGroup ? "bg-violet-600 font-semibold text-white shadow-sm" : "hover:bg-violet-100/70 dark:hover:bg-violet-500/10"}`}
                        >
                            All groups
                        </button>
                        <GroupTree nodes={visibleGroupTree} depth={0} selectedId={selectedGroup?.id ?? null} onSelect={setSelectedGroup} />
                    </div>
                </div>

                {/* Brand — a flat rail, same pane treatment as Groups. Reduces to
                whichever brands still have a product under the current
                Group/Category pick, and vice versa (both read the same
                available-id sets computed above). */}
                <div className="flex w-37.5 shrink-0 flex-col border-r border-border">
                    <div className="shrink-0 border-b border-border bg-fuchsia-50/70 px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-fuchsia-700 dark:bg-fuchsia-500/10 dark:text-fuchsia-300">
                        Brands
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto p-1">
                        <button
                            type="button"
                            onClick={() => setSelectedBrand("")}
                            className={`mb-0.5 w-full rounded px-2 py-1 text-left text-[11px] ${!selectedBrand ? "bg-fuchsia-600 font-semibold text-white shadow-sm" : "hover:bg-fuchsia-100/70 dark:hover:bg-fuchsia-500/10"}`}
                        >
                            All brands
                        </button>
                        {visibleBrands.map((b) => (
                            <button
                                key={b.id}
                                type="button"
                                onClick={() => setSelectedBrand(selectedBrand === b.name ? "" : (b.name ?? ""))}
                                className={`mb-0.5 w-full truncate rounded px-2 py-1 text-left text-[11px] ${selectedBrand === b.name ? "bg-fuchsia-600 font-semibold text-white shadow-sm" : "hover:bg-fuchsia-100/70 dark:hover:bg-fuchsia-500/10"}`}
                            >
                                {b.name}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Product grid */}
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                    <div className="flex shrink-0 items-center gap-2 border-b-2 border-violet-300/50 bg-linear-to-r from-violet-50/70 via-fuchsia-50/40 to-transparent px-3 py-2 dark:border-violet-500/30 dark:from-violet-500/10 dark:via-fuchsia-500/5">
                        <PackageSearch size={14} className="shrink-0 text-violet-600 dark:text-violet-300" />
                        <Input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Filter products…"
                            className="h-8 flex-1 border-violet-300/70 bg-background text-sm focus-visible:border-violet-500 focus-visible:ring-2 focus-visible:ring-violet-500/30 dark:border-violet-500/40"
                            autoFocus={open}
                        />
                        <button type="button" onClick={close} className="shrink-0 rounded p-1 text-violet-600 hover:bg-violet-100/70 dark:text-violet-300 dark:hover:bg-violet-500/10" title="Close (Esc)">
                            <X size={14} />
                        </button>
                    </div>
                    {/* Category — the remaining flat facet, also reduced to what the
                    Group/Brand pick still allows. */}
                    <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
                        <select
                            value={selectedCategoryId}
                            onChange={(e) => setSelectedCategoryId(e.target.value === "" ? "" : Number(e.target.value))}
                            className="h-7 rounded-md border border-amber-300/70 bg-amber-50/50 px-1.5 text-[11px] text-amber-800 dark:border-amber-500/40 dark:bg-amber-950/20 dark:text-amber-200"
                        >
                            <option value="">All categories</option>
                            {flattenNested(visibleCategoryTree).map((c) => <option key={c.id} value={c.id}>{treeLabel(c)}</option>)}
                        </select>
                        {facetsActive && (
                            <button
                                type="button"
                                onClick={() => { setSelectedGroup(null); setSelectedCategoryId(""); setSelectedBrand(""); }}
                                className="text-[11px] font-medium text-violet-600 underline-offset-2 hover:underline dark:text-violet-300"
                            >
                                Clear filters
                            </button>
                        )}
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto bg-linear-to-br from-violet-50/30 via-transparent to-fuchsia-50/20 p-2 dark:from-violet-500/5 dark:to-fuchsia-500/5">
                        {filtered.length === 0 ? (
                            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                                <PackageSearch size={22} className="text-violet-300 dark:text-violet-500/50" />
                                <span className="text-xs text-muted-foreground">No products match these filters.</span>
                            </div>
                        ) : (
                            <>
                            {/* Item count indicator */}
                            {hasMore && (
                                <div className="mb-1.5 text-center text-[10px] text-muted-foreground">
                                    Showing {visibleCount} of {filtered.length}
                                </div>
                            )}
                            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                                {visibleProducts.map((p) => {
                                    const inCartQty = cartQty.get(p.id) ?? 0;
                                    const price = p.effectiveSalePricePaise != null ? p.effectiveSalePricePaise / 100 : null;
                                    // Free-form attribute key — admin-named ("colour" is the naming
                                    // convention's own example), so read both spellings.
                                    const colour = p.attrsJson?.colour ?? p.attrsJson?.color ?? null;
                                    return (
                                        <button
                                            key={p.id}
                                            type="button"
                                            onClick={() => { addToCart(p); onHoverProduct(null); }}
                                            onMouseEnter={() => onHoverProduct(p)}
                                            onMouseLeave={() => onHoverProduct(null)}
                                            className="flex w-full items-start gap-1.5 rounded-md border border-violet-200/60 bg-card px-2 py-1.5 text-left text-xs shadow-sm transition-colors hover:border-violet-400 hover:bg-violet-50/60 hover:shadow-md dark:border-violet-500/20 dark:hover:border-violet-400/60 dark:hover:bg-violet-500/10"
                                        >
                                            {p.imageUrl ? (
                                                // eslint-disable-next-line @next/next/no-img-element -- small, arbitrary-host catalogue photo; not worth next/image's remote-pattern config here
                                                <img src={cloudinaryThumb(p.imageUrl, 64)} alt="" loading="lazy" decoding="async" className="h-8 w-8 shrink-0 rounded border border-violet-200/70 object-cover dark:border-violet-500/30" />
                                            ) : (
                                                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-dashed border-violet-300/60 bg-violet-50/50 text-violet-400 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-400/70">
                                                    <PackageSearch size={12} />
                                                </div>
                                            )}
                                            <div className="min-w-0 flex-1">
                                                <div className="flex w-full items-center justify-between gap-1">
                                                    <span className="truncate font-medium">{p.name}</span>
                                                    {inCartQty > 0 && (
                                                        <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 text-[9px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                                                            ×{inCartQty}
                                                        </span>
                                                    )}
                                                </div>
                                                {colour && (
                                                    <span className="mt-0.5 inline-block truncate rounded-sm bg-fuchsia-100 px-1 py-px text-[9px] font-medium text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300">
                                                        {colour}
                                                    </span>
                                                )}
                                                <div className="mt-0.5 flex w-full items-center justify-between text-[10px] text-muted-foreground">
                                                    <span className="truncate font-mono">{p.sku}</span>
                                                    <span className="flex shrink-0 items-center gap-0.5 font-semibold text-violet-700 dark:text-violet-300">
                                                        {price != null ? formatInr(price) : "—"}
                                                        <Plus size={10} />
                                                    </span>
                                                </div>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                            {/* Infinite-scroll sentinel */}
                            {hasMore && <div ref={sentinelRef} className="flex justify-center py-2"><span className="text-[10px] text-muted-foreground">Loading…</span></div>}
                            </>
                        )}
                    </div>
                </div>
            </aside>
        </>
    );
});
