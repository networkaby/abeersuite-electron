"use client";

import { useMemo, useState } from "react";
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
import type { ShopProductPublic } from "@/lib/shop/product-public";
import ProductCard from "./ProductCard";
import { Search, SlidersHorizontal, LayoutGrid, LayoutList, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Suspense } from "react";

type SortKey = "featured" | "price-asc" | "price-desc" | "name" | "rating";

function norm(s: string) {
    return s.toLowerCase().trim();
}

function matchesQuery(p: ShopProductPublic, q: string) {
    if (!q) return true;
    const n = norm(q);
    return (
        norm(p.name).includes(n) ||
        (p.subheading && norm(p.subheading).includes(n)) ||
        (p.description && norm(p.description).includes(n)) ||
        norm(p.category).includes(n)
    );
}

function ShopCatalogInner({
    products,
    allCategories,
    initialQuery,
    initialCategory,
}: {
    products: ShopProductPublic[];
    allCategories: string[];
    initialQuery: string;
    initialCategory: string;
}) {
    const router = useRouter();
    const [q, setQ] = useState(initialQuery);
    const [cat, setCat] = useState<string>(initialCategory);
    const [sort, setSort] = useState<SortKey>("featured");
    const [onSale, setOnSale] = useState(false);
    const [dense, setDense] = useState(false);
    const [showFilters, setShowFilters] = useState(false);

    const categories = useMemo(
        () => ["all", ...allCategories.filter((c) => c).sort((a, b) => a.localeCompare(b))],
        [allCategories]
    );

    const filtered = useMemo(() => {
        let list = products.filter((p) => matchesQuery(p, q));
        if (cat !== "all") list = list.filter((p) => p.category === cat);
        if (onSale) list = list.filter((p) => p.mrpPaise && p.mrpPaise > p.pricePaise);
        list = [...list];
        switch (sort) {
            case "price-asc":
                list.sort((a, b) => a.pricePaise - b.pricePaise);
                break;
            case "price-desc":
                list.sort((a, b) => b.pricePaise - a.pricePaise);
                break;
            case "name":
                list.sort((a, b) => a.name.localeCompare(b.name));
                break;
            case "rating":
                list.sort((a, b) => (b.id % 97) - (a.id % 97));
                break;
            case "featured":
            default:
                list.sort((a, b) => {
                    const ba = a.badge ? 1 : 0;
                    const bb = b.badge ? 1 : 0;
                    if (bb !== ba) return bb - ba;
                    return a.name.localeCompare(b.name);
                });
                break;
        }
        return list;
    }, [products, q, cat, onSale, sort]);

    const grouped = useMemo(() => {
        const map = new Map<string, ShopProductPublic[]>();
        for (const p of filtered) {
            const arr = map.get(p.category) ?? [];
            arr.push(p);
            map.set(p.category, arr);
        }
        return map;
    }, [filtered]);

    const applySearchToUrl = () => {
        const url = new URL(window.location.href);
        if (q) url.searchParams.set("q", q);
        else url.searchParams.delete("q");
        if (cat !== "all") url.searchParams.set("category", cat);
        else url.searchParams.delete("category");
        router.replace(url.pathname + url.search);
    };

    return (
        <div id="catalog" className="mx-auto max-w-6xl px-4 py-12 scroll-mt-20">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
                <aside
                    className={cn(
                        "lg:w-64 shrink-0 space-y-6 rounded-2xl border border-border/80 bg-card/50 p-5 backdrop-blur-sm",
                        !showFilters && "hidden lg:block"
                    )}
                >
                    <div className="flex items-center justify-between lg:hidden">
                        <span className="font-semibold">Filters</span>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setShowFilters(false)}>
                            <X className="size-4" />
                        </Button>
                    </div>
                    <div className="space-y-2">
                        <Label>Search</Label>
                        <div className="relative">
                            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                            <Input
                                className="pl-9"
                                value={q}
                                placeholder="Search catalog…"
                                onChange={(e) => setQ(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") applySearchToUrl();
                                }}
                            />
                        </div>
                        <Button type="button" variant="secondary" size="sm" className="w-full" onClick={() => applySearchToUrl()}>
                            Apply search
                        </Button>
                    </div>
                    <div className="space-y-2">
                        <Label>Category</Label>
                        <Select value={cat} onValueChange={setCat}>
                            <SelectTrigger>
                                <SelectValue placeholder="Category" />
                            </SelectTrigger>
                            <SelectContent>
                                {categories.map((c) => (
                                    <SelectItem key={c} value={c}>
                                        {c === "all" ? "All categories" : c}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex items-center gap-2">
                        <Checkbox
                            id="sale"
                            checked={onSale}
                            onCheckedChange={(v) => setOnSale(v === true)}
                        />
                        <Label htmlFor="sale" className="font-normal cursor-pointer">
                            On sale only
                        </Label>
                    </div>
                </aside>

                <div className="min-w-0 flex-1 space-y-8">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <h2 className="text-2xl font-bold tracking-tight">Catalog</h2>
                            <p className="text-sm text-muted-foreground mt-1">
                                {filtered.length} product{filtered.length === 1 ? "" : "s"} · filter, compare, and checkout securely
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="lg:hidden"
                                onClick={() => setShowFilters(true)}
                            >
                                <SlidersHorizontal className="size-4 mr-1" />
                                Filters
                            </Button>
                            <div className="w-[200px]">
                                <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
                                    <SelectTrigger>
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
                            <div className="flex rounded-lg border border-border p-0.5">
                                <Button
                                    type="button"
                                    variant={!dense ? "secondary" : "ghost"}
                                    size="icon"
                                    className="size-9"
                                    onClick={() => setDense(false)}
                                    aria-label="Comfortable grid"
                                >
                                    <LayoutGrid className="size-4" />
                                </Button>
                                <Button
                                    type="button"
                                    variant={dense ? "secondary" : "ghost"}
                                    size="icon"
                                    className="size-9"
                                    onClick={() => setDense(true)}
                                    aria-label="Dense grid"
                                >
                                    <LayoutList className="size-4" />
                                </Button>
                            </div>
                        </div>
                    </div>

                    {filtered.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-border py-20 text-center text-muted-foreground">
                            No matches — try another search or clear filters.
                        </div>
                    ) : (
                        Array.from(grouped.entries()).map(([category, items]) => (
                            <section key={category} id={`cat-${encodeURIComponent(category)}`} className="scroll-mt-24 space-y-4">
                                <div className="flex items-end justify-between gap-4 border-b border-border/60 pb-2">
                                    <h3 className="text-lg font-semibold">{category}</h3>
                                    <span className="text-xs text-muted-foreground uppercase tracking-wide">
                                        {items.length} item{items.length === 1 ? "" : "s"}
                                    </span>
                                </div>
                                <ul
                                    className={cn(
                                        "grid gap-6",
                                        dense
                                            ? "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                                            : "sm:grid-cols-2 xl:grid-cols-3"
                                    )}
                                >
                                    {items.map((p) => (
                                        <li key={p.id}>
                                            <ProductCard product={p} />
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        ))
                    )}
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
}) {
    return (
        <Suspense fallback={<div className="mx-auto max-w-6xl px-4 py-16 text-muted-foreground text-sm">Loading catalog…</div>}>
            <ShopCatalogInner {...props} />
        </Suspense>
    );
}
