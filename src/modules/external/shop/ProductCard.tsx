"use client";

import ShopRemoteImage from "@/modules/external/shop/ShopRemoteImage";
import { useShowInterest } from "@/modules/external/shop/useShowInterest";
import Link from "next/link";
import { Heart, GitCompare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { ShopProductPublic } from "@/shared/lib/shop/productPublic";
import { productPath, productPreviewPath } from "@/shared/lib/shop/productPublic";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { cn } from "@/shared/lib/format/utils";
import { useShopCartStore } from "@/store/external/shopCartStore";
import { useShopWishlistStore } from "@/store/external/shopWishlistStore";
import { useShopCompareStore, SHOP_COMPARE_MAX } from "@/store/external/shopCompareStore";
import { toast } from "sonner";

export default function ProductCard({
    product,
    className,
    preview = false,
}: {
    product: ShopProductPublic;
    className?: string;
    /**
     * Office-side use only: point the card's links at the staff full-page
     * preview, which opens a draft too and works in the desktop app (no shop
     * pages there). Never set on the storefront.
     */
    preview?: boolean;
}) {
    const add = useShopCartStore((s) => s.add);
    const interest = useShowInterest();
    const toggleWish = useShopWishlistStore((s) => s.toggle);
    const wishHas = useShopWishlistStore((s) => s.has(product.id));
    const addCompare = useShopCompareStore((s) => s.add);

    const mainImg = product.galleryUrls[0] ?? product.imageUrl;
    const href = preview ? productPreviewPath(product) : productPath(product);
    // In the office preview card, links open in a new tab so the editor never
    // loses the form (and its unsaved edits) by navigating away.
    const linkProps = preview ? { target: "_blank", rel: "noopener noreferrer" } : {};
    const discountPct =
        product.mrpPaise && product.mrpPaise > product.pricePaise
            ? Math.round((1 - product.pricePaise / product.mrpPaise) * 100)
            : null;

    return (
        <div className={cn("flex h-full min-h-0 flex-col gap-2.5", className)}>
            <Card
                className={cn(
                    "group flex min-h-0 flex-1 flex-col gap-0 overflow-hidden border-border/80 bg-card/80 py-0 shadow-sm transition-shadow hover:shadow-lg",
                )}
            >
                <div className="relative aspect-4/3 overflow-hidden bg-muted">
                    {mainImg ? (
                        <Link href={href} {...linkProps} className="relative block size-full">
                            <ShopRemoteImage
                                src={mainImg}
                                alt={product.displayName}
                                fill
                                frame="card"
                                sizes="(max-width:640px)100vw,(max-width:1024px)50vw,33vw"
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
                    ) : product.badge ? (
                        <Badge className="absolute left-3 top-3 rounded-md shadow-sm" variant="secondary">
                            {product.badge}
                        </Badge>
                    ) : null}
                    <div className="absolute right-2 top-2 flex flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100 sm:opacity-100">
                        <Button
                            type="button"
                            size="icon"
                            variant={wishHas ? "default" : "secondary"}
                            className="size-9 rounded-full shadow-md"
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
                            className="size-9 rounded-full shadow-md"
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
                <CardContent className="flex min-h-0 flex-1 flex-col gap-2 px-4 pb-4 pt-4 sm:px-5">
                    <Link href={href} {...linkProps} className="font-semibold leading-snug hover:text-primary transition-colors line-clamp-2">
                        {product.displayName}
                    </Link>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{product.category}</p>
                    <div className="mt-auto flex flex-wrap items-baseline gap-2 pt-2">
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
                </CardContent>
            </Card>
            <div
                className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-2"
                role="group"
                aria-label="Product actions"
            >
                <Button
                    className="h-11 min-h-11 w-full flex-1 touch-manipulation rounded-full shadow-sm sm:h-10 sm:min-h-10"
                    type="button"
                    disabled={interest.busy}
                    onClick={() => {
                        // Out of stock and not orderable → a Deal for staff (owner, 2026-11-22).
                        if (!product.orderable) return void interest.send(product.id);
                        add(product.id, 1);
                        toast.success("Added to cart");
                    }}
                >
                    {product.orderable ? "Add to cart" : "Show interest"}
                </Button>
                <Button
                    variant="outline"
                    className="h-11 min-h-11 w-full touch-manipulation rounded-full border-border/80 bg-background shadow-sm sm:h-10 sm:min-h-10 sm:w-auto sm:shrink-0"
                    asChild
                >
                    <Link href={href} {...linkProps}>Details</Link>
                </Button>
            </div>
        </div>
    );
}
