"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpLeft, ChevronLeft, Clock, LayoutGrid, Search, X } from "lucide-react";
import { matchesQuery } from "@/shared/lib/shop/catalogFilters";
import type { ShopProductPublic } from "@/shared/lib/shop/productPublic";
import { appProductPath, appProductsPath } from "@/modules/external/shopApp/appPaths";
import { noSubscribe } from "@/modules/mobile/components/installPlace";

type Suggestion = Pick<ShopProductPublic, "id" | "slug" | "displayName" | "category" | "description">;

const RECENT_KEY = "nsShopApp.recentSearches";
const RECENT_MAX = 8;

/** Recent searches live on the phone only. Storage can be blocked — never break on it. */
function readRecentRaw(): string {
    try {
        return localStorage.getItem(RECENT_KEY) ?? "[]";
    } catch {
        return "[]";
    }
}
function parseRecent(raw: string): string[] {
    try {
        const v = JSON.parse(raw);
        return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch {
        return [];
    }
}
function writeRecent(list: string[]) {
    try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
    } catch {
        /* storage blocked — recent searches just aren't remembered */
    }
}

/**
 * The full-screen search, as in Flipkart and Amazon: the box takes the keyboard
 * at once; empty, it lists recent searches and the categories; typing, it
 * suggests matching products and categories from the catalogue the page brought
 * along — no server call per letter. Search (Enter) opens the result list.
 */
export default function AppSearch({ products, categories }: { products: Suggestion[]; categories: string[] }) {
    const router = useRouter();
    const [q, setQ] = useState("");
    const raw = useSyncExternalStore(noSubscribe, readRecentRaw, () => "[]");
    const loaded = useMemo(() => parseRecent(raw), [raw]);
    const [recent, setRecent] = useState<string[] | null>(null);
    const shownRecent = recent ?? loaded;

    const term = q.trim();
    const productHits = useMemo(
        () => (term ? products.filter((p) => matchesQuery(p, term)).slice(0, 8) : []),
        [products, term]
    );
    const categoryHits = useMemo(
        () => (term ? categories.filter((c) => c.toLowerCase().includes(term.toLowerCase())).slice(0, 4) : []),
        [categories, term]
    );

    const go = (text: string) => {
        const t = text.trim();
        if (!t) return;
        const next = [t, ...shownRecent.filter((r) => r.toLowerCase() !== t.toLowerCase())].slice(0, RECENT_MAX);
        writeRecent(next);
        router.push(appProductsPath({ q: t }));
    };
    const clearRecent = () => {
        writeRecent([]);
        setRecent([]);
    };

    const row = "flex items-center gap-3 px-4 py-3 text-[15px] active:bg-muted";
    return (
        <>
            <header className="sticky top-0 z-10 flex h-[var(--m-header)] items-center gap-1 border-b bg-background px-1 pt-[env(safe-area-inset-top)]">
                <button type="button" onClick={() => router.back()} className="flex size-11 shrink-0 items-center justify-center rounded-full active:bg-muted" aria-label="Back">
                    <ChevronLeft className="size-6" />
                </button>
                <form
                    role="search"
                    className="flex flex-1 items-center gap-2 pr-2"
                    onSubmit={(e) => {
                        e.preventDefault();
                        go(q);
                    }}
                >
                    <input
                        type="search"
                        // The whole screen is the search box: opening it means "I want to type".
                        autoFocus
                        enterKeyHint="search"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Search laptops, printers, CCTV…"
                        className="h-10 min-w-0 flex-1 bg-transparent text-base outline-none [&::-webkit-search-cancel-button]:hidden"
                        autoComplete="off"
                    />
                    {q && (
                        <button type="button" onClick={() => setQ("")} className="rounded-full p-2 active:bg-muted" aria-label="Clear">
                            <X className="size-4" />
                        </button>
                    )}
                </form>
            </header>

            {term ? (
                <ul className="divide-y">
                    {categoryHits.map((c) => (
                        <li key={`c-${c}`}>
                            <Link href={appProductsPath({ category: c })} className={row}>
                                <LayoutGrid className="size-4 text-primary" />
                                <span className="flex-1">
                                    {c} <span className="text-xs text-muted-foreground">· category</span>
                                </span>
                            </Link>
                        </li>
                    ))}
                    {productHits.map((p) => (
                        <li key={p.id}>
                            <Link href={appProductPath(p)} className={row}>
                                <Search className="size-4 text-muted-foreground" />
                                <span className="line-clamp-1 flex-1">{p.displayName}</span>
                                <ArrowUpLeft className="size-4 text-muted-foreground" />
                            </Link>
                        </li>
                    ))}
                    <li>
                        <button type="button" onClick={() => go(q)} className={`${row} w-full text-primary`}>
                            <Search className="size-4" />
                            See all results for “{term}”
                        </button>
                    </li>
                </ul>
            ) : (
                <div className="space-y-5 py-3">
                    {shownRecent.length > 0 && (
                        <section>
                            <div className="flex items-center justify-between px-4 pb-1">
                                <h2 className="text-sm font-semibold">Recent searches</h2>
                                <button type="button" onClick={clearRecent} className="text-xs text-primary">
                                    Clear
                                </button>
                            </div>
                            <ul>
                                {shownRecent.map((r) => (
                                    <li key={r}>
                                        <button type="button" onClick={() => go(r)} className={`${row} w-full text-left`}>
                                            <Clock className="size-4 text-muted-foreground" />
                                            <span className="flex-1 truncate">{r}</span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}
                    <section className="px-4">
                        <h2 className="pb-2 text-sm font-semibold">Popular categories</h2>
                        <div className="flex flex-wrap gap-2">
                            {categories.slice(0, 12).map((c) => (
                                <Link
                                    key={c}
                                    href={appProductsPath({ category: c })}
                                    className="rounded-full border border-border/80 bg-card px-3 py-1.5 text-sm active:bg-muted"
                                >
                                    {c}
                                </Link>
                            ))}
                        </div>
                    </section>
                </div>
            )}
        </>
    );
}
