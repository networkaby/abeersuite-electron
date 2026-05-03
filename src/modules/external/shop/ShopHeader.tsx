"use client";

import Link from "next/link";
import { useShopCartStore } from "@/store/external/shopCartStore";
import { useShopWishlistStore } from "@/store/external/shopWishlistStore";
import { useShopCompareStore } from "@/store/external/shopCompareStore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Package, Heart, GitCompare, ShoppingBag, Menu } from "lucide-react";
import ShopSearchBar from "./ShopSearchBar";
import { COMPANY_DETAILS } from "@/utils/constants-company-details";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const iconBtn =
    "relative inline-flex size-11 shrink-0 touch-manipulation items-center justify-center rounded-full sm:size-10";

export default function ShopHeader() {
    const cartCount = useShopCartStore((s) => s.lines.reduce((a, l) => a + l.quantity, 0));
    const wishCount = useShopWishlistStore((s) => s.productIds.length);
    const compareCount = useShopCompareStore((s) => s.productIds.length);

    return (
        <header className="sticky top-0 z-50 border-b border-border/80 bg-background/85 backdrop-blur-md supports-backdrop-filter:bg-background/70 pt-[env(safe-area-inset-top,0px)]">
            <div className="mx-auto flex max-w-6xl flex-col gap-2.5 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 items-center justify-between gap-2 md:contents">
                    <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="size-11 shrink-0 touch-manipulation md:hidden"
                                    aria-label="Open menu"
                                >
                                    <Menu className="size-5" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="w-56">
                                <DropdownMenuItem asChild>
                                    <Link href="/">Home</Link>
                                </DropdownMenuItem>
                                <DropdownMenuItem asChild>
                                    <Link href="/shop">All products</Link>
                                </DropdownMenuItem>
                                <DropdownMenuItem asChild>
                                    <Link href="/shop/cart">Cart</Link>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem asChild>
                                    <Link href="/portal">Customer portal</Link>
                                </DropdownMenuItem>
                                <DropdownMenuItem asChild>
                                    <Link href="/login">Sign in</Link>
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <Link
                            href="/"
                            className="flex min-w-0 max-w-[min(12rem,46vw)] items-center gap-2 font-bold text-base leading-tight tracking-tight sm:max-w-none sm:text-lg"
                        >
                            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary sm:size-9">
                                <Package className="size-5" />
                            </span>
                            <span className="truncate md:whitespace-normal">{COMPANY_DETAILS.brandName}</span>
                        </Link>
                    </div>

                    <div className="flex shrink-0 items-center justify-end gap-0.5 sm:gap-1">
                        <Button variant="ghost" size="sm" className="hidden h-9 touch-manipulation sm:inline-flex" asChild>
                            <Link href="/login">Sign in</Link>
                        </Button>
                        <Button variant="ghost" asChild className={iconBtn} aria-label="Wishlist">
                            <Link href="/shop/wishlist" className="text-foreground">
                                <Heart className="size-5" />
                                {wishCount > 0 ? (
                                    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                                        {wishCount}
                                    </span>
                                ) : null}
                            </Link>
                        </Button>
                        <Button variant="ghost" asChild className={iconBtn} aria-label="Compare">
                            <Link href="/shop/compare" className="text-foreground">
                                <GitCompare className="size-5" />
                                {compareCount > 0 ? (
                                    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-600 px-1 text-[10px] font-bold text-white">
                                        {compareCount}
                                    </span>
                                ) : null}
                            </Link>
                        </Button>
                        <Button
                            variant="default"
                            size="sm"
                            asChild
                            className="h-10 min-w-10 touch-manipulation gap-1.5 rounded-full px-3 shadow-sm sm:h-9 sm:min-w-0 sm:px-4"
                        >
                            <Link href="/shop/cart" className="inline-flex items-center justify-center">
                                <ShoppingBag className="size-4 shrink-0" />
                                <span className="max-w-14 truncate sm:max-w-none">Cart</span>
                                {cartCount > 0 ? (
                                    <Badge variant="secondary" className="ml-0.5 rounded-md px-1.5 py-0 text-xs">
                                        {cartCount}
                                    </Badge>
                                ) : null}
                            </Link>
                        </Button>
                    </div>
                </div>

                <nav className="hidden items-center gap-1 text-sm text-muted-foreground md:flex">
                    <Button variant="ghost" size="sm" className="touch-manipulation" asChild>
                        <Link href="/shop">All products</Link>
                    </Button>
                    <Button variant="ghost" size="sm" className="touch-manipulation" asChild>
                        <Link href="/portal">Portal</Link>
                    </Button>
                </nav>

                <ShopSearchBar className="order-last w-full min-w-0 md:order-0 md:mx-0 md:max-w-xl md:flex-1" />
            </div>
        </header>
    );
}
