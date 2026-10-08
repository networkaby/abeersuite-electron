import Link from "next/link";
import { ChevronRight, LayoutGrid } from "lucide-react";
import ShopRemoteImage from "@/modules/external/shop/ShopRemoteImage";
import { AppProductTile } from "@/modules/external/shopApp/AppProductRail";
import { APP, appProductPath, appProductsPath } from "@/modules/external/shopApp/appPaths";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import type { ShopProductPublic } from "@/shared/lib/shop/productPublic";
import type { StorefrontCategory } from "@/shared/lib/shop/storefrontProducts";

// Home's building blocks, the way shopping apps lay them out. Plain server
// components — no script — so Home stays a cached page.

/** A section card: title, optional "View all", then its content. */
export function HomeSection({ title, href, children }: { title: string; href?: string; children: React.ReactNode }) {
    return (
        <section className="bg-background py-3">
            <div className="flex items-center justify-between px-4 pb-2.5">
                <h2 className="text-base font-semibold tracking-tight">{title}</h2>
                {href && (
                    <Link href={href} className="flex items-center gap-0.5 text-sm font-medium text-primary">
                        View all <ChevronRight className="size-4" />
                    </Link>
                )}
            </div>
            {children}
        </section>
    );
}

/** Round category icons in one row that swipes sideways, "All" at the end. */
export function CategoryStrip({ categories }: { categories: StorefrontCategory[] }) {
    return (
        <ul className="flex gap-3 overflow-x-auto bg-background px-3 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {categories.map((c) => (
                <li key={c.name} className="w-[4.25rem] shrink-0">
                    <Link href={appProductsPath({ category: c.name })} className="flex flex-col items-center gap-1 text-center active:opacity-70">
                        <span className="relative size-14 overflow-hidden rounded-full border border-border/70 bg-white">
                            <ShopRemoteImage src={c.fallbackImageUrl} alt="" fill sizes="56px" className="object-contain p-2" />
                        </span>
                        <span className="line-clamp-2 text-[11px] leading-tight">{c.name}</span>
                    </Link>
                </li>
            ))}
            <li className="w-[4.25rem] shrink-0">
                <Link href={`${APP}/categories`} className="flex flex-col items-center gap-1 text-center active:opacity-70">
                    <span className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <LayoutGrid className="size-6" />
                    </span>
                    <span className="text-[11px] leading-tight">All</span>
                </Link>
            </li>
        </ul>
    );
}

/** Four deals in a 2×2 card — photo, name, the discount in green. */
export function DealsGrid({ products }: { products: ShopProductPublic[] }) {
    return (
        <ul className="grid grid-cols-2 gap-2 px-3">
            {products.slice(0, 4).map((p) => {
                const off = p.mrpPaise && p.mrpPaise > p.pricePaise ? Math.round((1 - p.pricePaise / p.mrpPaise) * 100) : 0;
                return (
                    <li key={p.id}>
                        <Link href={appProductPath(p)} className="block rounded-xl border border-border/70 p-2 active:bg-muted">
                            <span className="relative block aspect-square overflow-hidden rounded-lg bg-white">
                                <ShopRemoteImage src={p.galleryUrls[0] ?? p.imageUrl} alt={p.displayName} fill sizes="45vw" frame="square" className="object-contain p-2" />
                            </span>
                            <span className="mt-1.5 line-clamp-1 block text-xs">{p.displayName}</span>
                            <span className="block text-sm font-semibold text-emerald-700">{off > 0 ? `Min. ${off}% off` : formatRupeesFromPaise(p.pricePaise)}</span>
                        </Link>
                    </li>
                );
            })}
        </ul>
    );
}

/** Brand logos in a row that swipes; a tap searches the brand. */
export function BrandRow({ brands }: { brands: { name: string; imageUrl: string | null }[] }) {
    return (
        <ul className="flex gap-2 overflow-x-auto px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {brands.map((b) => (
                <li key={b.name} className="shrink-0">
                    <Link href={appProductsPath({ q: b.name })} className="relative flex h-14 w-24 items-center justify-center rounded-xl border border-border/70 bg-white active:opacity-70">
                        {b.imageUrl ? (
                            // Brand logos come from any site (e.g. simpleicons) — a plain img, as the website's brand strip does.
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={b.imageUrl} alt={b.name} className="max-h-9 max-w-20 object-contain" loading="lazy" />
                        ) : (
                            <span className="text-xs font-semibold">{b.name}</span>
                        )}
                    </Link>
                </li>
            ))}
        </ul>
    );
}

/** Every product as a 2-column grid — Home keeps scrolling, as in Flipkart. */
export function ProductGrid({ products }: { products: ShopProductPublic[] }) {
    return (
        <ul className="grid grid-cols-2 gap-2.5 px-3">
            {products.map((p) => (
                <li key={p.id}>
                    <AppProductTile product={p} />
                </li>
            ))}
        </ul>
    );
}
