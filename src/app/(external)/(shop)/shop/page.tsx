import type { Metadata } from "next";
import Link from "next/link";
import { permanentRedirect } from "next/navigation";
import { loadStorefrontProducts, pickDeals, pickFeatured } from "@/shared/lib/shop/storefrontProducts";
import { dailyPick, loadBrowseTiles, type BrowseKind, type BrowseTile } from "@/shared/lib/shop/browseTiles";
import { HOME_BRAND_LIMIT, HOME_TILE_LIMIT } from "@/shared/lib/shop/homeLayout";
import { businessTodayIso } from "@/shared/lib/format/formatDate";
import ShopPageBanner from "@/modules/external/shop/ShopPageBanner";
import TrustStrip from "@/modules/external/store/TrustStrip";
import CategoryShowcase from "@/modules/external/store/CategoryShowcase";
import BrandStripView from "@/modules/external/store/BrandStripView";
import ProductRail from "@/modules/external/shop/ProductRail";
import ShopCatalogClient from "@/modules/external/shop/ShopCatalogClient";
import { loadShopAdContext } from "@/shared/lib/shop/adContext";

/**
 * /shop is a browse hub, not a dump of every product:
 *
 *   /shop                      hub — today's categories, collections, brands, deals
 *   /shop?view=categories      every category   (also collections / brands)
 *   /shop?q=…                  search results
 *   /shop?view=all             the full filterable grid ("Browse everything")
 *   /shop?category=X           old link → 308 to X's own page (/laptops)
 *
 * Each category, collection and brand has its own root page (`[slug]`), which
 * is what tiles link to and what Google indexes.
 */

type ShopSearchParams = {
    q?: string;
    category?: string | string[];
    collection?: string;
    view?: string;
    adPreview?: string;
};

const LIST_VIEWS: Record<BrowseKind, { title: string; subtitle: string }> = {
    categories: { title: "All categories", subtitle: "Every department we stock." },
    collections: { title: "All collections", subtitle: "Ready-made picks for how you use them." },
    brands: { title: "All brands", subtitle: "Original products from leading manufacturers." },
};

const isListView = (v: string | undefined): v is BrowseKind => v === "categories" || v === "collections" || v === "brands";

export async function generateMetadata({ searchParams }: { searchParams: Promise<ShopSearchParams> }): Promise<Metadata> {
    const sp = await searchParams;
    if (isListView(sp.view)) {
        return { title: LIST_VIEWS[sp.view].title, alternates: { canonical: `/shop?view=${sp.view}` } };
    }
    // Search results and filtered grids are not pages of their own: followed, never indexed.
    const filtered = !!(sp.q || sp.view || sp.category || sp.collection);
    return {
        alternates: { canonical: "/shop" },
        ...(filtered ? { robots: { index: false, follow: true } } : {}),
    };
}

const toEntry = (t: BrowseTile) => ({ name: t.name, count: t.count, fallbackImageUrl: t.imageUrl, href: t.href });
const toBrand = (t: BrowseTile) => ({ name: t.name, imageUrl: t.imageUrl, slug: t.href.slice(1) });

export default async function ShopPage({ searchParams }: { searchParams: Promise<ShopSearchParams> }) {
    const sp = await searchParams;
    const tiles = await loadBrowseTiles();
    const categoryParam = [sp.category ?? []].flat().filter(Boolean);
    const query = sp.q?.trim() ?? "";

    // An old `?category=` / `?collection=` link (no search, no grid) goes to that
    // page's own URL. In-grid filtering keeps `view=all` in the URL, so it never lands here.
    if (!sp.view && !query) {
        if (categoryParam.length === 1) {
            const hit = tiles.categories.find((t) => t.name === categoryParam[0]);
            if (hit) permanentRedirect(hit.href);
        }
        if (sp.collection && categoryParam.length === 0) {
            const hit = tiles.collections.find((t) => t.name === sp.collection);
            if (hit) permanentRedirect(hit.href);
        }
    }

    if (isListView(sp.view)) {
        const view = LIST_VIEWS[sp.view];
        const items = tiles[sp.view];
        return (
            <main>
                <h1 className="sr-only">{view.title}</h1>
                <nav className="mx-auto flex max-w-6xl gap-1 px-3 pt-6 text-sm text-muted-foreground sm:px-4">
                    <Link href="/shop" className="hover:text-foreground">
                        Shop
                    </Link>
                    <span className="opacity-60">›</span>
                    <span className="font-medium text-foreground">{view.title}</span>
                </nav>
                {sp.view === "brands" ? (
                    <BrowseLinkGrid items={items} title={view.title} subtitle={view.subtitle} />
                ) : (
                    <CategoryShowcase
                        categories={items.map(toEntry)}
                        eyebrow={`${items.length} ${sp.view}`}
                        title={view.title}
                        subtitle={view.subtitle}
                    />
                )}
                <BrowseOtherLists current={sp.view} />
            </main>
        );
    }

    const searching = !!query || sp.view === "all" || categoryParam.length > 0 || !!sp.collection;
    const [products, adContext] = await Promise.all([loadStorefrontProducts(), loadShopAdContext(sp)]);

    if (searching) {
        const initialCategory = categoryParam.join("|") || "all";
        const cats = [...new Set(products.map((p) => p.category))];
        return (
            <>
                <ShopPageBanner
                    productCount={products.length}
                    categoryCount={tiles.categories.length}
                    collectionPills={tiles.collections.slice(0, HOME_TILE_LIMIT)}
                    activeQuery={query || undefined}
                />
                <ShopCatalogClient
                    products={products}
                    allCategories={cats}
                    initialQuery={query}
                    initialCategory={initialCategory}
                    initialCollection={sp.collection?.trim() || undefined}
                    adContext={adContext}
                />
            </>
        );
    }

    // The hub. Today's handful of each, rotated by date (stable all day, so it
    // caches and Google sees one page); everything stays reachable via "More".
    const todayIso = businessTodayIso();
    const categories = dailyPick(tiles.categories, HOME_TILE_LIMIT, todayIso, "shop-categories");
    const collections = dailyPick(tiles.collections, HOME_TILE_LIMIT, todayIso, "shop-collections");
    const brands = dailyPick(tiles.brands.filter((b) => b.imageUrl), HOME_BRAND_LIMIT, todayIso, "shop-brands", 0);

    return (
        <>
            <ShopPageBanner
                productCount={products.length}
                categoryCount={tiles.categories.length}
                collectionPills={tiles.collections.slice(0, HOME_TILE_LIMIT)}
                heading="Shop"
            />
            <TrustStrip />
            <CategoryShowcase
                categories={categories.map(toEntry)}
                title="Shop by category"
                moreHref={tiles.categories.length > categories.length ? "/shop?view=categories" : undefined}
                moreLabel="More categories"
            />
            <CategoryShowcase
                categories={collections.map(toEntry)}
                eyebrow="Collections"
                title="Shop by collection"
                subtitle="Ready-made picks for how you use them."
                moreHref={tiles.collections.length > collections.length ? "/shop?view=collections" : undefined}
                moreLabel="More collections"
            />
            <ProductRail
                eyebrow="Today's deals"
                title="Save big — limited stock"
                products={pickDeals(products)}
                accent="emerald"
                seeAllHref="/shop?view=all"
                seeAllLabel="Browse everything"
            />
            <ProductRail
                eyebrow="Picked for you"
                title="Worth a look today"
                products={dailyPick(pickFeatured(products, 32), 8, todayIso, "shop-picks", 0)}
                seeAllHref="/shop?view=all"
                seeAllLabel="Browse everything"
            />
            <BrandStripView
                brands={brands.map(toBrand)}
                moreHref={tiles.brands.length > brands.length ? "/shop?view=brands" : undefined}
            />
        </>
    );
}

/** Plain name chips — for brands, many of which have no logo. */
function BrowseLinkGrid({ items, title, subtitle }: { items: BrowseTile[]; title: string; subtitle: string }) {
    return (
        <section className="mx-auto max-w-6xl px-3 py-10 sm:px-4">
            <h2 className="text-xl font-bold tracking-tight sm:text-3xl">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
            <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {items.map((b) => (
                    <li key={b.href}>
                        <Link
                            href={b.href}
                            className="flex items-center justify-between gap-2 rounded-xl border border-border/70 bg-card px-4 py-3 text-sm font-medium hover:border-primary/40 hover:text-primary"
                        >
                            <span className="line-clamp-1">{b.name}</span>
                            <span className="text-xs text-muted-foreground tabular-nums">{b.count}</span>
                        </Link>
                    </li>
                ))}
            </ul>
        </section>
    );
}

/** Hop between the three lists, so a list page is never a dead end. */
function BrowseOtherLists({ current }: { current: BrowseKind }) {
    const others = (Object.keys(LIST_VIEWS) as BrowseKind[]).filter((k) => k !== current);
    return (
        <div className="mx-auto flex max-w-6xl flex-wrap gap-3 px-3 pb-12 sm:px-4">
            {others.map((k) => (
                <Link
                    key={k}
                    href={`/shop?view=${k}`}
                    className="rounded-full border border-border px-4 py-2 text-sm font-medium hover:border-primary/50 hover:text-primary"
                >
                    {LIST_VIEWS[k].title} →
                </Link>
            ))}
            <Link
                href="/shop?view=all"
                className="rounded-full border border-border px-4 py-2 text-sm font-medium hover:border-primary/50 hover:text-primary"
            >
                Browse everything →
            </Link>
        </div>
    );
}
