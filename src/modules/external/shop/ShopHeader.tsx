"use client";

import Link from "next/link";
import { useShopCartStore } from "@/store/external/shopCartStore";
import { useShopWishlistStore } from "@/store/external/shopWishlistStore";
import { useShopCompareStore } from "@/store/external/shopCompareStore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Package, Heart, GitCompare, ShoppingBag } from "lucide-react";
import ShopSearchBar from "./ShopSearchBar";

export default function ShopHeader() {
    const cartCount = useShopCartStore((s) => s.lines.reduce((a, l) => a + l.quantity, 0));
    const wishCount = useShopWishlistStore((s) => s.productIds.length);
    const compareCount = useShopCompareStore((s) => s.productIds.length);

    return (
        <header className="sticky top-0 z-50 border-b border-border/80 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
            <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="flex items-center gap-3 min-w-0">
                    <Link
                        href="/shop"
                        className="flex items-center gap-2 font-bold text-lg tracking-tight shrink-0"
                    >
                        <span className="flex size-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
                            <Package className="size-5" />
                        </span>
                        <span className="hidden sm:inline">Network Shop</span>
                    </Link>
                    <nav className="hidden md:flex items-center gap-1 text-sm text-muted-foreground">
                        <Button variant="ghost" size="sm" asChild>
                            <Link href="/shop#catalog">Catalog</Link>
                        </Button>
                        <Button variant="ghost" size="sm" asChild>
                            <Link href="/portal">Portal</Link>
                        </Button>
                    </nav>
                </div>

                <ShopSearchBar className="flex-1 min-w-0 max-w-xl mx-auto sm:mx-0 order-last sm:order-none w-full" />

                <div className="flex items-center justify-end gap-1 sm:gap-2 shrink-0">
                    <Button variant="ghost" size="sm" className="hidden sm:inline-flex" asChild>
                        <Link href="/portal/login">Sign in</Link>
                    </Button>
                    <Button variant="ghost" size="icon" className="relative rounded-full" asChild aria-label="Wishlist">
                        <Link href="/shop/wishlist">
                            <Heart className="size-5" />
                            {wishCount > 0 ? (
                                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                                    {wishCount}
                                </span>
                            ) : null}
                        </Link>
                    </Button>
                    <Button variant="ghost" size="icon" className="relative rounded-full" asChild aria-label="Compare">
                        <Link href="/shop/compare">
                            <GitCompare className="size-5" />
                            {compareCount > 0 ? (
                                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-600 px-1 text-[10px] font-bold text-white">
                                    {compareCount}
                                </span>
                            ) : null}
                        </Link>
                    </Button>
                    <Button variant="default" size="sm" className="rounded-full gap-2 shadow-sm" asChild>
                        <Link href="/shop/cart">
                            <ShoppingBag className="size-4" />
                            <span className="hidden sm:inline">Cart</span>
                            {cartCount > 0 ? (
                                <Badge variant="secondary" className="ml-1 rounded-md px-1.5 py-0 text-xs">
                                    {cartCount}
                                </Badge>
                            ) : null}
                        </Link>
                    </Button>
                </div>
            </div>
        </header>
    );
}
