"use client";

import ShopRemoteImage from "@/modules/external/shop/ShopRemoteImage";
import Link from "next/link";
import { Heart, GitCompare, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { ShopProductPublic } from "@/shared/lib/shop/productPublic";
import { demoRating, productPath } from "@/shared/lib/shop/productPublic";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { cn } from "@/shared/lib/format/utils";
import { useShopCartStore } from "@/store/external/shopCartStore";
import { useShopWishlistStore } from "@/store/external/shopWishlistStore";
import { useShopCompareStore, SHOP_COMPARE_MAX } from "@/store/external/shopCompareStore";
import { toast } from "sonner";

export default function ProductListRow({ product, className }: { product: ShopProductPublic; className?: string }) {
    const add = useShopCartStore((s) => s.add);
    const toggleWish = useShopWishlistStore((s) => s.toggle);
    const wishHas = useShopWishlistStore((s) => s.has(product.id));
    const addCompare = useShopCompareStore((s) => s.add);

    const mainImg = product.galleryUrls[0] ?? product.imageUrl;
    const href = productPath(product);
    const { stars, reviewCount } = demoRating(product.id);
    const discountPct =
        product.mrpPaise && product.mrpPaise > product.pricePaise
            ? Math.round((1 - product.pricePaise / product.mrpPaise) * 100)
            : null;

    return (
        <Card
            className={cn(
                "group flex flex-col gap-0 overflow-hidden border-border/80 bg-card/80 py-0 shadow-sm transition-shadow hover:shadow-lg sm:flex-row",
                className
            )}
        >
            <div className="relative aspect-4/3 shrink-0 overflow-hidden bg-muted sm:w-48 sm:aspect-square">
                {mainImg ? (
                    <Link href={href} className="relative block size-full">
                        <ShopRemoteImage
                            src={mainImg}
                            alt={product.displayName}
                            fill
                            frame="card"
                            sizes="(max-width:640px)100vw,192px"
                            className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                        />
                    </Link>
                ) : (
                    <div className="flex size-full items-center justify-center text-muted-foreground text-sm">No image</div>
                )}
                {product.stockStatus === "out_of_stock" ? (
                    <Badge className="absolute left-3 top-3 rounded-md shadow-sm" variant="destructive">
                        Out of stock
                    </Badge>
                ) : product.stockStatus === "backorder" ? (
                    <Badge className="absolute left-3 top-3 rounded-md border-amber-500/40 bg-amber-50 text-amber-700 shadow-sm" variant="outline">
                        Backorder
                    </Badge>
                ) : product.badge ? (
                    <Badge className="absolute left-3 top-3 rounded-md shadow-sm" variant="secondary">
                        {product.badge}
                    </Badge>
                ) : null}
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-2 p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                        <Link href={href} className="font-semibold leading-snug hover:text-primary transition-colors line-clamp-2">
                            {product.displayName}
                        </Link>
                        <div className="flex items-center gap-1 text-amber-500">
                            {Array.from({ length: 5 }).map((_, i) => (
                                <Star
                                    key={i}
                                    className={cn("size-3.5", i < Math.round(stars) ? "fill-current" : "text-muted/40")}
                                />
                            ))}
                            <span className="ml-1 text-xs text-muted-foreground">
                                {stars.toFixed(1)} ({reviewCount})
                            </span>
                        </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                        <Button
                            type="button"
                            size="icon"
                            variant={wishHas ? "default" : "secondary"}
                            className="size-9 rounded-full shadow-sm"
                            aria-label={wishHas ? "Remove from wishlist" : "Add to wishlist"}
                            onClick={() => {
                                toggleWish(product.id);
                                toast(wishHas ? "Removed from wishlist" : "Saved to wishlist");
                            }}
                        >
                            <Heart className={cn("size-4", wishHas && "fill-current")} />
                        </Button>
                        <Button
                            type="button"
                            size="icon"
                            variant="secondary"
                            className="size-9 rounded-full shadow-sm"
                            aria-label="Add to compare"
                            onClick={() => {
                                const ok = addCompare(product.id);
                                toast(
                                    ok
                                        ? "Added to compare"
                                        : `Compare holds max ${SHOP_COMPARE_MAX} items — remove one first`
                                );
                            }}
                        >
                            <GitCompare className="size-4" />
                        </Button>
                    </div>
                </div>

                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{product.category}</p>

                <div className="mt-auto flex flex-wrap items-end justify-between gap-3 pt-2">
                    <div className="flex flex-wrap items-baseline gap-2">
                        <span className="text-xl font-bold tabular-nums">{formatRupeesFromPaise(product.pricePaise)}</span>
                        {product.mrpPaise && product.mrpPaise > product.pricePaise ? (
                            <>
                                <span className="text-sm text-muted-foreground line-through tabular-nums">
                                    {formatRupeesFromPaise(product.mrpPaise)}
                                </span>
                                {discountPct ? (
                                    <Badge variant="outline" className="text-emerald-700 dark:text-emerald-400 border-emerald-500/40">
                                        Save {discountPct}%
                                    </Badge>
                                ) : null}
                            </>
                        ) : null}
                    </div>
                    <div className="flex shrink-0 gap-2">
                        <Button
                            variant="outline"
                            className="h-10 min-h-10 touch-manipulation rounded-full border-border/80 bg-background shadow-sm"
                            asChild
                        >
                            <Link href={href}>Details</Link>
                        </Button>
                        <Button
                            className="h-10 min-h-10 touch-manipulation rounded-full shadow-sm"
                            type="button"
                            disabled={!product.orderable}
                            onClick={() => {
                                add(product.id, 1);
                                toast.success(product.stockStatus === "backorder" ? "Added (backorder)" : "Added to cart");
                            }}
                        >
                            {!product.orderable ? "Out of stock" : product.stockStatus === "backorder" ? "Backorder" : "Add to cart"}
                        </Button>
                    </div>
                </div>
            </div>
        </Card>
    );
}
