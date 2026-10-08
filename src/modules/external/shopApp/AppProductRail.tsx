import Link from "next/link";
import ShopRemoteImage from "@/modules/external/shop/ShopRemoteImage";
import type { ShopProductPublic } from "@/shared/lib/shop/productPublic";
import { appProductPath } from "@/modules/external/shopApp/appPaths";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";

/**
 * A row of products that swipes sideways, each tile snapping into place — the
 * app's version of the website's rail: smaller tiles, two and a bit on screen so
 * the next one peeks in and says "swipe". Taps open the product page.
 */
export default function AppProductRail({ title, products }: { title: string; products: ShopProductPublic[] }) {
    if (products.length === 0) return null;
    return (
        <section className="space-y-2.5">
            <h2 className="px-4 text-base font-semibold tracking-tight">{title}</h2>
            <ul className="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {products.map((p) => (
                    <li key={p.id} className="w-[42%] shrink-0 snap-start">
                        <AppProductTile product={p} />
                    </li>
                ))}
            </ul>
        </section>
    );
}

/** One product as a tile — the rails and the 2-column result grid both use it. */
export function AppProductTile({ product: p }: { product: ShopProductPublic }) {
    const img = p.galleryUrls[0] ?? p.imageUrl;
    const off = p.mrpPaise && p.mrpPaise > p.pricePaise ? Math.round((1 - p.pricePaise / p.mrpPaise) * 100) : 0;
    return (
        <Link href={appProductPath(p)} className="block h-full overflow-hidden rounded-2xl border border-border/70 bg-card active:scale-[0.98] transition-transform">
            <div className="relative aspect-square bg-white">
                <ShopRemoteImage src={img} alt={p.displayName} fill sizes="45vw" className="object-contain p-2" frame="square" />
                {off > 0 && (
                    <span className="absolute left-2 top-2 rounded-md bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        {off}% off
                    </span>
                )}
            </div>
            <div className="space-y-1 p-2.5">
                <p className="line-clamp-2 min-h-[2.5em] text-[13px] leading-tight">{p.displayName}</p>
                <p className="flex items-baseline gap-1.5">
                    <span className="text-sm font-semibold tabular-nums">{formatRupeesFromPaise(p.pricePaise)}</span>
                    {off > 0 && p.mrpPaise && (
                        <span className="text-[11px] text-muted-foreground line-through tabular-nums">{formatRupeesFromPaise(p.mrpPaise)}</span>
                    )}
                </p>
                {p.stockStatus === "backorder" && <p className="text-[11px] text-amber-700">On order · ships later</p>}
                {!p.orderable && <p className="text-[11px] text-muted-foreground">Out of stock</p>}
            </div>
        </Link>
    );
}
