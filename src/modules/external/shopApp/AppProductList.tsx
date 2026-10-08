"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDownUp, Check, Search, ShoppingCart, SlidersHorizontal } from "lucide-react";
import MobileHeader from "@/modules/mobile/components/MobileHeader";
import AppBottomSheet from "@/modules/external/shopApp/AppBottomSheet";
import { AppProductTile } from "@/modules/external/shopApp/AppProductRail";
import { useCartCount } from "@/modules/external/shopApp/CustomerAppShell";
import { APP } from "@/modules/external/shopApp/appPaths";
import { buildPriceBands, discountPct, DISCOUNT_OPTIONS, matchesQuery } from "@/shared/lib/shop/catalogFilters";
import type { ShopProductPublic } from "@/shared/lib/shop/productPublic";

const SORTS = [
    { id: "relevance", label: "Relevance" },
    { id: "price-asc", label: "Price — low to high" },
    { id: "price-desc", label: "Price — high to low" },
    { id: "discount", label: "Discount" },
    { id: "name", label: "Name A–Z" },
] as const;
type SortId = (typeof SORTS)[number]["id"];

type Filters = { categories: string[]; priceIds: string[]; discountMin: number | null; inStockOnly: boolean };
const NO_FILTERS: Filters = { categories: [], priceIds: [], discountMin: null, inStockOnly: false };

/**
 * Results and category lists, Flipkart-style: a 2-column grid, with Sort and
 * Filter in a bar that stays under the header and opens bottom sheets. The whole
 * (small) catalogue came with the page, so every change is instant and costs no
 * server call. Same search and filter rules as the website (catalogFilters.ts).
 */
export default function AppProductList({
    products,
    initialQuery,
    initialCategory,
}: {
    products: ShopProductPublic[];
    initialQuery: string;
    initialCategory: string | null;
}) {
    const cartCount = useCartCount();
    const [sort, setSort] = useState<SortId>("relevance");
    const [filters, setFilters] = useState<Filters>({ ...NO_FILTERS, categories: initialCategory ? [initialCategory] : [] });
    const [draft, setDraft] = useState<Filters>(filters);
    const [sheet, setSheet] = useState<"sort" | "filter" | null>(null);

    const searched = useMemo(() => products.filter((p) => matchesQuery(p, initialQuery)), [products, initialQuery]);
    const categories = useMemo(() => [...new Set(searched.map((p) => p.category))].sort(), [searched]);
    const priceBands = useMemo(() => buildPriceBands(searched), [searched]);

    const shown = useMemo(() => {
        const bands = priceBands.filter((b) => filters.priceIds.includes(b.id));
        const list = searched.filter(
            (p) =>
                (filters.categories.length === 0 || filters.categories.includes(p.category)) &&
                (bands.length === 0 || bands.some((b) => p.pricePaise >= b.minPaise && (b.maxPaise == null || p.pricePaise < b.maxPaise))) &&
                (filters.discountMin == null || discountPct(p) >= filters.discountMin) &&
                (!filters.inStockOnly || p.stockStatus === "in_stock")
        );
        switch (sort) {
            case "price-asc":
                return list.sort((a, b) => a.pricePaise - b.pricePaise);
            case "price-desc":
                return list.sort((a, b) => b.pricePaise - a.pricePaise);
            case "discount":
                return list.sort((a, b) => discountPct(b) - discountPct(a));
            case "name":
                return list.sort((a, b) => a.displayName.localeCompare(b.displayName));
            default:
                // Badged products first, then the catalogue's own order.
                return list.sort((a, b) => Number(!!b.badge) - Number(!!a.badge));
        }
    }, [searched, filters, sort, priceBands]);

    const activeCount =
        filters.categories.length + filters.priceIds.length + (filters.discountMin != null ? 1 : 0) + (filters.inStockOnly ? 1 : 0);
    const title = initialQuery ? `“${initialQuery}”` : initialCategory ?? "All products";

    const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
    const chip = (on: boolean) =>
        `rounded-full border px-3 py-1.5 text-sm ${on ? "border-primary bg-primary/10 font-medium text-primary" : "border-border/80 bg-card"}`;
    const barButton = "flex flex-1 items-center justify-center gap-2 py-3 text-sm font-medium active:bg-muted";

    return (
        <>
            <MobileHeader
                title={title}
                back={APP}
                menu={false}
                actions={
                    <>
                        <Link href={`${APP}/search`} className="flex size-11 items-center justify-center rounded-full active:bg-muted" aria-label="Search">
                            <Search className="size-5" />
                        </Link>
                        <Link href={`${APP}/cart`} className="relative flex size-11 items-center justify-center rounded-full active:bg-muted" aria-label="Cart">
                            <ShoppingCart className="size-5" />
                            {cartCount > 0 && (
                                <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                                    {cartCount}
                                </span>
                            )}
                        </Link>
                    </>
                }
            />
            <div className="sticky top-[var(--m-header)] z-10 flex divide-x border-b bg-background">
                <button type="button" className={barButton} onClick={() => setSheet("sort")}>
                    <ArrowDownUp className="size-4" /> Sort
                </button>
                <button
                    type="button"
                    className={barButton}
                    onClick={() => {
                        setDraft(filters);
                        setSheet("filter");
                    }}
                >
                    <SlidersHorizontal className="size-4" /> Filter
                    {activeCount > 0 && (
                        <span className="flex size-5 items-center justify-center rounded-full bg-primary text-[11px] text-primary-foreground">{activeCount}</span>
                    )}
                </button>
            </div>

            <p className="px-4 pb-1 pt-3 text-xs text-muted-foreground">
                {shown.length} {shown.length === 1 ? "product" : "products"}
            </p>
            {shown.length > 0 ? (
                <ul className="grid grid-cols-2 gap-2.5 px-3 pb-4">
                    {shown.map((p) => (
                        <li key={p.id}>
                            <AppProductTile product={p} />
                        </li>
                    ))}
                </ul>
            ) : (
                <div className="space-y-3 px-6 py-14 text-center">
                    <p className="text-base font-medium">Nothing matches</p>
                    <p className="text-sm text-muted-foreground">Try another word, or clear the filters.</p>
                    {activeCount > 0 && (
                        <button type="button" onClick={() => setFilters(NO_FILTERS)} className="text-sm font-medium text-primary">
                            Clear filters
                        </button>
                    )}
                </div>
            )}

            <AppBottomSheet open={sheet === "sort"} title="Sort by" onClose={() => setSheet(null)}>
                <ul className="py-1">
                    {SORTS.map((s) => (
                        <li key={s.id}>
                            <button
                                type="button"
                                onClick={() => {
                                    setSort(s.id);
                                    setSheet(null);
                                }}
                                className="flex w-full items-center justify-between px-4 py-3.5 text-left text-[15px] active:bg-muted"
                            >
                                {s.label}
                                {sort === s.id && <Check className="size-5 text-primary" />}
                            </button>
                        </li>
                    ))}
                </ul>
            </AppBottomSheet>

            <AppBottomSheet
                open={sheet === "filter"}
                title="Filter"
                onClose={() => setSheet(null)}
                footer={
                    <div className="flex gap-3">
                        <button type="button" onClick={() => setDraft(NO_FILTERS)} className="h-12 flex-1 rounded-xl border text-[15px] font-medium active:bg-muted">
                            Clear all
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setFilters(draft);
                                setSheet(null);
                            }}
                            className="h-12 flex-1 rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground active:opacity-90"
                        >
                            Apply
                        </button>
                    </div>
                }
            >
                <div className="space-y-5 p-4">
                    {categories.length > 1 && (
                        <section className="space-y-2">
                            <h3 className="text-sm font-semibold">Category</h3>
                            <div className="flex flex-wrap gap-2">
                                {categories.map((c) => (
                                    <button key={c} type="button" className={chip(draft.categories.includes(c))} onClick={() => setDraft((d) => ({ ...d, categories: toggle(d.categories, c) }))}>
                                        {c}
                                    </button>
                                ))}
                            </div>
                        </section>
                    )}
                    {priceBands.length > 0 && (
                        <section className="space-y-2">
                            <h3 className="text-sm font-semibold">Price</h3>
                            <div className="flex flex-wrap gap-2">
                                {priceBands.map((b) => (
                                    <button key={b.id} type="button" className={chip(draft.priceIds.includes(b.id))} onClick={() => setDraft((d) => ({ ...d, priceIds: toggle(d.priceIds, b.id) }))}>
                                        {b.label}
                                    </button>
                                ))}
                            </div>
                        </section>
                    )}
                    <section className="space-y-2">
                        <h3 className="text-sm font-semibold">Discount</h3>
                        <div className="flex flex-wrap gap-2">
                            {DISCOUNT_OPTIONS.map((d) => (
                                <button
                                    key={d}
                                    type="button"
                                    className={chip(draft.discountMin === d)}
                                    onClick={() => setDraft((f) => ({ ...f, discountMin: f.discountMin === d ? null : d }))}
                                >
                                    {d}% or more
                                </button>
                            ))}
                        </div>
                    </section>
                    <section className="space-y-2">
                        <h3 className="text-sm font-semibold">Availability</h3>
                        <button type="button" className={chip(draft.inStockOnly)} onClick={() => setDraft((d) => ({ ...d, inStockOnly: !d.inStockOnly }))}>
                            In stock only
                        </button>
                    </section>
                </div>
            </AppBottomSheet>
        </>
    );
}
