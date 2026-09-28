"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import ShopRemoteImage from "@/modules/external/shop/ShopRemoteImage";
import { cn } from "@/shared/lib/format/utils";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import type { AdSize, ResolvedAd } from "@/shared/lib/shop/ads";

/**
 * One ad on the shop, drawn to its size. Static ads are the artwork edge to
 * edge; product ads are laid out from the product (photo, name, price, saving)
 * — vertical in the tall sizes, side by side in the wide ones.
 *
 * Every unit carries a "Sponsored" chip and a `rel="sponsored"` link, so a
 * customer (and a search engine) can always tell an ad from a listing.
 */

/** The box each size draws in. Grid sizes fill the row height the `<li>` gives them. */
const FRAME: Record<AdSize, string> = {
    tile: "h-full min-h-[18rem]",
    wide: "h-full min-h-[18rem]",
    billboard: "aspect-[970/250]",
    rectangle: "aspect-[6/5]",
    halfPage: "aspect-[1/2]",
    mobile: "aspect-[16/5]",
};

const HORIZONTAL: Record<AdSize, boolean> = {
    tile: false,
    wide: true,
    billboard: true,
    rectangle: false,
    halfPage: false,
    mobile: true,
};

function SponsoredChip({ className }: { className?: string }) {
    return (
        <span
            className={cn(
                "pointer-events-none absolute left-2 top-2 z-10 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white",
                className,
            )}
        >
            Sponsored
        </span>
    );
}

function AdLink({ ad, className, children }: { ad: ResolvedAd; className?: string; children: React.ReactNode }) {
    const external = /^https?:\/\//i.test(ad.href);
    const cls = cn(
        "group relative block touch-manipulation overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg active:opacity-95",
        ad.placeholder && "border-dashed shadow-none hover:translate-y-0 hover:shadow-none",
        className,
    );
    return external ? (
        <a href={ad.href} className={cls} rel="sponsored noopener noreferrer" target="_blank" aria-label={ad.imageAlt}>
            {children}
        </a>
    ) : (
        <Link href={ad.href} className={cls} rel="sponsored" aria-label={ad.imageAlt}>
            {children}
        </Link>
    );
}

function StaticAd({ ad }: { ad: ResolvedAd }) {
    return (
        <AdLink ad={ad} className={FRAME[ad.size]}>
            <ShopRemoteImage
                src={ad.imageUrl}
                alt={ad.imageAlt}
                fill
                sizes="(max-width: 1024px) 100vw, 60vw"
                className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            />
            {ad.placeholder ? (
                <span className="pointer-events-none absolute left-2 top-2 z-10 rounded bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white">
                    Ad space
                </span>
            ) : (
                <SponsoredChip />
            )}
        </AdLink>
    );
}

function ProductAd({ ad }: { ad: ResolvedAd }) {
    const p = ad.product!;
    const savePct = p.mrpPaise && p.mrpPaise > p.pricePaise ? Math.round((1 - p.pricePaise / p.mrpPaise) * 100) : null;
    const horizontal = HORIZONTAL[ad.size];
    const compact = ad.size === "mobile";
    return (
        <AdLink ad={ad} className={cn(FRAME[ad.size], "flex", horizontal ? "flex-row" : "flex-col")}>
            <SponsoredChip />
            <div
                className={cn(
                    "relative shrink-0 bg-muted",
                    horizontal ? "h-full w-[38%]" : ad.size === "tile" ? "aspect-4/3 w-full" : "w-full flex-1",
                )}
            >
                <ShopRemoteImage
                    src={ad.imageUrl}
                    alt={ad.imageAlt}
                    fill
                    frame="square"
                    sizes="(max-width: 640px) 50vw, 25vw"
                    className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                />
            </div>
            <div
                className={cn(
                    "flex min-w-0 flex-col justify-center",
                    compact ? "gap-0.5 px-3 py-1.5" : "gap-1.5 p-4",
                    horizontal ? "flex-1" : "",
                )}
            >
                {!compact ? (
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
                        {ad.eyebrow ?? "Sponsored pick"}
                    </p>
                ) : null}
                <h3 className={cn("font-semibold leading-snug", compact ? "line-clamp-1 text-sm" : "line-clamp-2 text-base")}>
                    {p.displayName}
                </h3>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className={cn("font-bold", compact ? "text-sm" : "text-lg")}>{formatRupeesFromPaise(p.pricePaise)}</span>
                    {p.mrpPaise && p.mrpPaise > p.pricePaise ? (
                        <span className="text-xs text-muted-foreground line-through">{formatRupeesFromPaise(p.mrpPaise)}</span>
                    ) : null}
                    {savePct ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                            Save {savePct}%
                        </span>
                    ) : null}
                </div>
                {!compact ? (
                    <span className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-primary">
                        {ad.ctaLabel ?? "Buy now"}
                        <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </span>
                ) : null}
            </div>
        </AdLink>
    );
}

export default function AdUnit({ ad, className }: { ad: ResolvedAd; className?: string }) {
    return (
        <div className={cn("flex h-full min-h-0 flex-col", className)}>
            {ad.kind === "product" && ad.product ? <ProductAd ad={ad} /> : <StaticAd ad={ad} />}
        </div>
    );
}
