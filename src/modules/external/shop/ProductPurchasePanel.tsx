"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { ShopProductPublic } from "@/shared/lib/shop/productPublic";
import type { VariantOption } from "@/shared/lib/shop/variants";
import VariantPicker from "@/modules/external/shop/VariantPicker";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { useShopCartStore } from "@/store/external/shopCartStore";
import { useShopWishlistStore } from "@/store/external/shopWishlistStore";
import { useShopCompareStore, SHOP_COMPARE_MAX } from "@/store/external/shopCompareStore";
import { toast } from "sonner";
import { Heart, GitCompare, Minus, Plus, Share2 } from "lucide-react";
import { cn } from "@/shared/lib/format/utils";
import { useShowInterest } from "@/modules/external/shop/useShowInterest";

export default function ProductPurchasePanel({
    product,
    preview = false,
    variants = [],
}: {
    product: ShopProductPublic;
    variants?: VariantOption[];
    /**
     * Office full-page preview: no Share (it would copy the office address), no
     * View cart and no portal line — the desktop app has no shop pages, so those
     * links would only open a 404.
     */
    preview?: boolean;
}) {
    const add = useShopCartStore((s) => s.add);
    const toggleWish = useShopWishlistStore((s) => s.toggle);
    const wishHas = useShopWishlistStore((s) => s.has(product.id));
    const addCompare = useShopCompareStore((s) => s.add);
    const [qty, setQty] = useState(1);
    const interest = useShowInterest();

    const discountPct =
        product.mrpPaise && product.mrpPaise > product.pricePaise
            ? Math.round((1 - product.pricePaise / product.mrpPaise) * 100)
            : null;

    const share = async () => {
        const url = typeof window !== "undefined" ? window.location.href : "";
        try {
            await navigator.clipboard.writeText(url);
            toast.success("Link copied");
        } catch {
            toast.error("Could not copy link");
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap gap-2">
                {product.stockStatus === "out_of_stock" ? (
                    <Badge variant="destructive">Out of stock</Badge>
                ) : null}
                {product.badge ? <Badge variant="secondary">{product.badge}</Badge> : null}
                <Badge variant="outline">{product.category}</Badge>
            </div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl text-balance">{product.displayName}</h1>
            <VariantPicker options={variants} />
            <div className="rounded-2xl border border-border/80 bg-card/60 p-6 shadow-sm backdrop-blur-sm">
                <div className="flex flex-wrap items-end gap-3">
                    <span className="text-4xl font-bold tabular-nums">{formatRupeesFromPaise(product.pricePaise)}</span>
                    {product.mrpPaise && product.mrpPaise > product.pricePaise ? (
                        <>
                            <span className="text-xl text-muted-foreground line-through tabular-nums">
                                {formatRupeesFromPaise(product.mrpPaise)}
                            </span>
                            {discountPct ? (
                                <Badge className="bg-emerald-600 text-white hover:bg-emerald-600/90">{discountPct}% off</Badge>
                            ) : null}
                        </>
                    ) : null}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Inclusive of taxes where applicable · shipping at checkout</p>

                <div className="mt-6 flex flex-wrap gap-3">
                    <div className="flex items-center rounded-full border border-border bg-background">
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="rounded-full"
                            onClick={() => setQty((q) => Math.max(1, q - 1))}
                            aria-label="Decrease quantity"
                        >
                            <Minus className="size-4" />
                        </Button>
                        <Input
                            type="text"
                            inputMode="numeric"
                            value={qty}
                            onChange={(e) => setQty(Math.min(99, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                            className="w-14 border-0 bg-transparent text-center tabular-nums shadow-none focus-visible:ring-0"
                        />
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="rounded-full"
                            onClick={() => setQty((q) => Math.min(99, q + 1))}
                            aria-label="Increase quantity"
                        >
                            <Plus className="size-4" />
                        </Button>
                    </div>
                    <Button
                        size="lg"
                        className="min-w-[200px] flex-1 rounded-full text-base shadow-md"
                        type="button"
                        disabled={interest.busy}
                        onClick={() => {
                            // Out of stock and not orderable → a Deal for staff (owner, 2026-11-22).
                            if (!product.orderable) {
                                // Staff preview: same button, but no sign-in jump and no Deal.
                                if (preview) return void toast.info("Preview — customers see this button");
                                return void interest.send(product.id);
                            }
                            add(product.id, qty);
                            toast.success(`Added ${qty} to cart`);
                        }}
                    >
                        {product.orderable ? "Add to cart" : "Show interest"}
                    </Button>
                </div>
                {product.stockStatus === "backorder" ? (
                    // A backorder looks like any product (owner, 2026-11-22) — only the time differs.
                    <p className="mt-3 text-xs text-muted-foreground">Ships in a few days.</p>
                ) : !product.orderable ? (
                    <p className="mt-3 text-xs text-muted-foreground">
                        Out of stock — tap Show interest and we will tell you when it is back.
                    </p>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                        type="button"
                        variant={wishHas ? "default" : "outline"}
                        className="rounded-full"
                        onClick={() => {
                            toggleWish(product.id);
                            toast(wishHas ? "Removed from wishlist" : "Saved to wishlist");
                        }}
                    >
                        <Heart className={cn("size-4 mr-2", wishHas && "fill-current")} />
                        Wishlist
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        className="rounded-full"
                        onClick={() => {
                            const ok = addCompare(product.id);
                            toast(
                                ok ? "Added to compare" : `Compare is limited to ${SHOP_COMPARE_MAX} products`
                            );
                        }}
                    >
                        <GitCompare className="size-4 mr-2" />
                        Compare
                    </Button>
                    {preview ? null : (
                        <>
                            <Button type="button" variant="outline" className="rounded-full" onClick={() => void share()}>
                                <Share2 className="size-4 mr-2" />
                                Share
                            </Button>
                            <Button variant="secondary" className="rounded-full" asChild>
                                <Link href="/shop/cart">View cart</Link>
                            </Button>
                        </>
                    )}
                </div>
            </div>
            {preview ? null : (
                <p className="text-sm text-muted-foreground">
                    Need this with a service ticket?{" "}
                    <Link href="/portal" className="text-primary font-medium underline underline-offset-4">
                        Open the customer portal
                    </Link>
                </p>
            )}
        </div>
    );
}
