"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Clock, Layers, LayoutGrid, Search, Tag, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import ShopRemoteImage from "@/modules/external/shop/ShopRemoteImage";
import { matchesQuery } from "@/shared/lib/shop/catalogFilters";
import { searchRelevance } from "@/shared/lib/shop/searchRank";
import { parseRecent, pushRecent, readRecentRaw, writeRecent } from "@/shared/lib/shop/recentSearches";
import { productPath } from "@/shared/lib/shop/productPublic";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { noSubscribe } from "@/modules/mobile/components/installPlace";
import { cn } from "@/shared/lib/format/utils";

type IndexProduct = {
    id: number;
    slug: string | null;
    displayName: string;
    category: string;
    description: string | null;
    pricePaise: number;
    mrpPaise: number | null;
    imageUrl: string | null;
};
type IndexTile = { name: string; href: string; count: number };
type SearchIndex = { products: IndexProduct[]; categories: IndexTile[]; collections: IndexTile[]; brands: IndexTile[] };

const RECENT_KEY = "nsShop.recentSearches";
const PRODUCT_HITS = 6;
const TILE_HITS = 3;

/** One fetch per page load, shared by every search box on the page. */
let indexPromise: Promise<SearchIndex | null> | null = null;
function loadIndex(): Promise<SearchIndex | null> {
    indexPromise ??= fetch("/api/shop/search-index")
        .then((r) => (r.ok ? (r.json() as Promise<SearchIndex>) : null))
        .catch(() => {
            indexPromise = null; // let the next focus try again
            return null;
        });
    return indexPromise;
}

type Row =
    | { kind: "recent"; label: string }
    | { kind: "tile"; label: string; href: string; count: number; tag: "Category" | "Collection" | "Brand" }
    | { kind: "product"; p: IndexProduct }
    | { kind: "all"; label: string };

const tileIcon = { Category: LayoutGrid, Collection: Layers, Brand: Tag } as const;

/**
 * The header search, as on Flipkart and Amazon: focus shows recent searches
 * and popular categories; typing suggests matching categories, collections,
 * brands and products (photo + price) straight from a catalogue fetched once —
 * no server call per letter. ↑/↓ move, Enter opens, Esc closes.
 */
export default function ShopSearchBar({ className }: { className?: string }) {
    const router = useRouter();
    const [q, setQ] = useState("");
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(-1);
    const [index, setIndex] = useState<SearchIndex | null>(null);
    const boxRef = useRef<HTMLDivElement>(null);

    const raw = useSyncExternalStore(noSubscribe, () => readRecentRaw(RECENT_KEY), () => "[]");
    const loaded = useMemo(() => parseRecent(raw), [raw]);
    const [recentOverride, setRecentOverride] = useState<string[] | null>(null);
    const recent = recentOverride ?? loaded;

    const warm = () => {
        setOpen(true);
        if (!index) void loadIndex().then((i) => i && setIndex(i));
    };

    // Close when a click lands outside the box.
    useEffect(() => {
        if (!open) return;
        const onDown = (e: PointerEvent) => {
            if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("pointerdown", onDown);
        return () => document.removeEventListener("pointerdown", onDown);
    }, [open]);

    const term = q.trim();
    const rows = useMemo<Row[]>(() => {
        if (!term) {
            const out: Row[] = recent.map((label) => ({ kind: "recent", label }));
            for (const c of index?.categories.slice(0, 6) ?? [])
                out.push({ kind: "tile", label: c.name, href: c.href, count: c.count, tag: "Category" });
            return out;
        }
        const lower = term.toLowerCase();
        const tileHits = (list: IndexTile[] | undefined, tag: "Category" | "Collection" | "Brand"): Row[] =>
            (list ?? [])
                .filter((t) => t.name.toLowerCase().includes(lower))
                .sort((a, b) => Number(b.name.toLowerCase().startsWith(lower)) - Number(a.name.toLowerCase().startsWith(lower)) || b.count - a.count)
                .slice(0, TILE_HITS)
                .map((t) => ({ kind: "tile", label: t.name, href: t.href, count: t.count, tag }));
        const products = (index?.products ?? [])
            .filter((p) => matchesQuery(p, term))
            .sort((a, b) => searchRelevance(b, term) - searchRelevance(a, term))
            .slice(0, PRODUCT_HITS)
            .map((p): Row => ({ kind: "product", p }));
        return [
            ...tileHits(index?.categories, "Category"),
            ...tileHits(index?.brands, "Brand"),
            ...tileHits(index?.collections, "Collection"),
            ...products,
            { kind: "all", label: term },
        ];
    }, [term, index, recent]);

    const search = (text: string) => {
        const t = text.trim();
        if (!t) return;
        const next = pushRecent(recent, t);
        writeRecent(RECENT_KEY, next);
        setRecentOverride(next);
        setOpen(false);
        setQ(t);
        router.push(`/shop?q=${encodeURIComponent(t)}#catalog`);
    };

    const choose = (row: Row) => {
        setOpen(false);
        setActive(-1);
        if (row.kind === "recent" || row.kind === "all") return search(row.label);
        if (term) {
            const next = pushRecent(recent, term);
            writeRecent(RECENT_KEY, next);
            setRecentOverride(next);
        }
        router.push(row.kind === "tile" ? row.href : productPath(row.p));
    };

    const removeRecent = (label: string) => {
        const next = recent.filter((r) => r !== label);
        writeRecent(RECENT_KEY, next);
        setRecentOverride(next);
    };

    const showPanel = open && rows.length > 0;

    return (
        <div className={className}>
            <div ref={boxRef} className="relative w-full max-w-xl">
                <form
                    role="search"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (showPanel && active >= 0 && rows[active]) choose(rows[active]);
                        else search(q);
                    }}
                >
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={q}
                        onChange={(e) => {
                            setQ(e.target.value);
                            setActive(-1);
                            setOpen(true);
                        }}
                        onFocus={warm}
                        onPointerDown={warm}
                        onKeyDown={(e) => {
                            if (e.key === "Escape") {
                                setOpen(false);
                                setActive(-1);
                            } else if (e.key === "ArrowDown" && rows.length) {
                                e.preventDefault();
                                setOpen(true);
                                setActive((i) => (i + 1) % rows.length);
                            } else if (e.key === "ArrowUp" && rows.length) {
                                e.preventDefault();
                                setActive((i) => (i <= 0 ? rows.length - 1 : i - 1));
                            }
                        }}
                        placeholder="Search laptops, printers, CCTV…"
                        className="touch-manipulation pl-9 pr-9 text-base h-11 min-h-11 w-full rounded-full bg-muted/50 border-border/80"
                        enterKeyHint="search"
                        autoComplete="off"
                        role="combobox"
                        aria-expanded={showPanel}
                        aria-controls="shop-search-list"
                        aria-autocomplete="list"
                    />
                    {q ? (
                        <button
                            type="button"
                            onClick={() => {
                                setQ("");
                                setActive(-1);
                            }}
                            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-muted-foreground hover:bg-muted"
                            aria-label="Clear search"
                        >
                            <X className="size-4" />
                        </button>
                    ) : null}
                </form>

                {showPanel ? (
                    <ul
                        id="shop-search-list"
                        role="listbox"
                        className="absolute inset-x-0 top-full z-50 mt-2 max-h-[70vh] overflow-y-auto rounded-2xl border border-border/80 bg-popover py-2 text-popover-foreground shadow-xl"
                    >
                        {!term && recent.length > 0 ? (
                            <li className="px-4 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Recent searches
                            </li>
                        ) : null}
                        {rows.map((row, i) => {
                            const isActive = i === active;
                            const base = cn(
                                "flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left text-sm",
                                isActive ? "bg-muted" : "hover:bg-muted/60"
                            );
                            const header =
                                !term && row.kind === "tile" && (i === 0 || rows[i - 1].kind !== "tile") ? (
                                    <li className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                        Popular categories
                                    </li>
                                ) : null;
                            let body;
                            if (row.kind === "recent") {
                                body = (
                                    <div className={base} onMouseEnter={() => setActive(i)}>
                                        <button type="button" className="flex flex-1 items-center gap-3" onClick={() => choose(row)}>
                                            <Clock className="size-4 text-muted-foreground" />
                                            <span className="truncate">{row.label}</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => removeRecent(row.label)}
                                            className="rounded-full p-1 text-muted-foreground hover:bg-background"
                                            aria-label={`Remove ${row.label}`}
                                        >
                                            <X className="size-3.5" />
                                        </button>
                                    </div>
                                );
                            } else if (row.kind === "tile") {
                                const Icon = tileIcon[row.tag];
                                body = (
                                    <button type="button" className={base} onMouseEnter={() => setActive(i)} onClick={() => choose(row)}>
                                        <Icon className="size-4 text-primary" />
                                        <span className="flex-1 truncate">
                                            {row.label}
                                            <span className="ml-1.5 text-xs text-muted-foreground">in {row.tag}</span>
                                        </span>
                                        <span className="text-xs text-muted-foreground">{row.count}</span>
                                    </button>
                                );
                            } else if (row.kind === "product") {
                                const p = row.p;
                                body = (
                                    <button type="button" className={base} onMouseEnter={() => setActive(i)} onClick={() => choose(row)}>
                                        <span className="relative size-10 shrink-0 overflow-hidden rounded-md bg-muted">
                                            {p.imageUrl ? (
                                                <ShopRemoteImage src={p.imageUrl} alt="" fill sizes="40px" className="object-contain" />
                                            ) : null}
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="line-clamp-1">{p.displayName}</span>
                                            <span className="text-xs text-muted-foreground">{p.category}</span>
                                        </span>
                                        <span className="shrink-0 text-right">
                                            <span className="block font-semibold">{formatRupeesFromPaise(p.pricePaise)}</span>
                                            {p.mrpPaise && p.mrpPaise > p.pricePaise ? (
                                                <span className="block text-xs text-muted-foreground line-through">
                                                    {formatRupeesFromPaise(p.mrpPaise)}
                                                </span>
                                            ) : null}
                                        </span>
                                    </button>
                                );
                            } else {
                                body = (
                                    <button
                                        type="button"
                                        className={cn(base, "font-medium text-primary")}
                                        onMouseEnter={() => setActive(i)}
                                        onClick={() => choose(row)}
                                    >
                                        <Search className="size-4" />
                                        See all results for “{row.label}”
                                    </button>
                                );
                            }
                            return (
                                <FragmentRow key={`${row.kind}-${i}`} header={header} selected={isActive}>
                                    {body}
                                </FragmentRow>
                            );
                        })}
                        {term && !index ? (
                            <li className="px-4 py-2 text-xs text-muted-foreground">Loading suggestions…</li>
                        ) : null}
                    </ul>
                ) : null}
            </div>
        </div>
    );
}

function FragmentRow({ header, selected, children }: { header: ReactNode; selected: boolean; children: ReactNode }) {
    return (
        <>
            {header}
            <li role="option" aria-selected={selected}>
                {children}
            </li>
        </>
    );
}
