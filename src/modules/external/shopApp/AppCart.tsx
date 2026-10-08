"use client";

import { useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Heart, Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";
import MobileHeader from "@/modules/mobile/components/MobileHeader";
import ShopRemoteImage from "@/modules/external/shop/ShopRemoteImage";
import { APP, appProductPath } from "@/modules/external/shopApp/appPaths";
import { noSubscribe } from "@/modules/mobile/components/installPlace";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import type { ShopProductPublic } from "@/shared/lib/shop/productPublic";
import { useShopCartStore } from "@/store/external/shopCartStore";
import { useShopWishlistStore } from "@/store/external/shopWishlistStore";

/**
 * The cart, Flipkart-style: one card per item (photo, price, quantity stepper,
 * Remove / Save for later), the price details underneath, and a bar fixed above
 * the tabs with the total and Place order. An item the shop has since hidden
 * shows as unavailable instead of a ₹0 line.
 */
export default function AppCart({ products }: { products: ShopProductPublic[] }) {
    const router = useRouter();
    const lines = useShopCartStore((s) => s.lines);
    const setQty = useShopCartStore((s) => s.setQty);
    const remove = useShopCartStore((s) => s.remove);
    const toggleWish = useShopWishlistStore((s) => s.toggle);
    const hasWish = useShopWishlistStore((s) => s.has);
    // The cart is on the phone — until the page runs there, draw nothing rather than "empty".
    const ready = useSyncExternalStore(noSubscribe, () => true, () => false);

    const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
    const rows = lines.map((l) => ({ line: l, product: byId.get(l.productId) ?? null }));
    const live = rows.filter((r) => r.product?.orderable);
    const items = live.reduce((n, r) => n + r.line.quantity, 0);
    const pricePaise = live.reduce((n, r) => n + r.product!.pricePaise * r.line.quantity, 0);
    const mrpPaise = live.reduce((n, r) => n + Math.max(r.product!.mrpPaise ?? 0, r.product!.pricePaise) * r.line.quantity, 0);
    const savedPaise = mrpPaise - pricePaise;
    const blocked = rows.some((r) => !r.product?.orderable);

    if (!ready) return <MobileHeader title="Cart" menu={false} />;

    if (lines.length === 0) {
        return (
            <>
                <MobileHeader title="Cart" menu={false} />
                <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 py-20 text-center">
                    <span className="flex size-20 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <ShoppingCart className="size-9" />
                    </span>
                    <p className="text-lg font-semibold">Your cart is empty</p>
                    <p className="text-sm text-muted-foreground">Add something you like — it stays here until you order.</p>
                    <Link href={APP} className="mt-2 rounded-xl bg-primary px-6 py-3 text-[15px] font-semibold text-primary-foreground active:opacity-90">
                        Shop now
                    </Link>
                </div>
            </>
        );
    }

    return (
        <>
            <MobileHeader title={`Cart (${lines.reduce((n, l) => n + l.quantity, 0)})`} menu={false} />
            <ul className="space-y-2 py-2">
                {rows.map(({ line, product: p }) => (
                    <li key={line.productId} className="bg-background px-4 py-3">
                        {p ? (
                            <div className="flex gap-3">
                                <Link href={appProductPath(p)} className="relative size-20 shrink-0 overflow-hidden rounded-xl border bg-white">
                                    <ShopRemoteImage src={p.galleryUrls[0] ?? p.imageUrl} alt="" fill sizes="80px" frame="square" className="object-contain p-1" />
                                </Link>
                                <div className="min-w-0 flex-1 space-y-1">
                                    <Link href={appProductPath(p)} className="line-clamp-2 text-sm leading-snug">
                                        {p.displayName}
                                    </Link>
                                    <p className="flex items-baseline gap-2">
                                        <span className="font-semibold tabular-nums">{formatRupeesFromPaise(p.pricePaise)}</span>
                                        {p.mrpPaise && p.mrpPaise > p.pricePaise && (
                                            <span className="text-xs text-muted-foreground line-through tabular-nums">{formatRupeesFromPaise(p.mrpPaise)}</span>
                                        )}
                                    </p>
                                    {!p.orderable ? (
                                        <p className="text-xs font-medium text-destructive">Out of stock — remove it to place the order</p>
                                    ) : p.stockStatus === "backorder" ? (
                                        <p className="text-xs text-amber-700">On order · ships a little later</p>
                                    ) : null}
                                </div>
                            </div>
                        ) : (
                            <p className="text-sm text-muted-foreground">This item is no longer sold.</p>
                        )}
                        <div className="mt-3 flex items-center gap-2">
                            {p?.orderable && (
                                <div className="flex items-center rounded-full border">
                                    <button type="button" onClick={() => setQty(line.productId, line.quantity - 1)} className="flex size-9 items-center justify-center rounded-full active:bg-muted" aria-label="One less">
                                        <Minus className="size-4" />
                                    </button>
                                    <span className="w-8 text-center text-sm font-medium tabular-nums">{line.quantity}</span>
                                    <button
                                        type="button"
                                        onClick={() => setQty(line.productId, Math.min(99, line.quantity + 1))}
                                        className="flex size-9 items-center justify-center rounded-full active:bg-muted"
                                        aria-label="One more"
                                    >
                                        <Plus className="size-4" />
                                    </button>
                                </div>
                            )}
                            <span className="flex-1" />
                            {p && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (!hasWish(p.id)) toggleWish(p.id);
                                        remove(p.id);
                                        toast("Moved to wishlist");
                                    }}
                                    className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-muted-foreground active:bg-muted"
                                >
                                    <Heart className="size-4" /> Save for later
                                </button>
                            )}
                            <button type="button" onClick={() => remove(line.productId)} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-muted-foreground active:bg-muted">
                                <Trash2 className="size-4" /> Remove
                            </button>
                        </div>
                    </li>
                ))}
            </ul>

            <section className="mb-2 space-y-2.5 bg-background px-4 py-4 text-sm">
                <h2 className="text-base font-semibold">Price details</h2>
                <div className="flex justify-between">
                    <span>Price ({items} {items === 1 ? "item" : "items"})</span>
                    <span className="tabular-nums">{formatRupeesFromPaise(mrpPaise)}</span>
                </div>
                {savedPaise > 0 && (
                    <div className="flex justify-between text-emerald-700">
                        <span>Discount</span>
                        <span className="tabular-nums">−{formatRupeesFromPaise(savedPaise)}</span>
                    </div>
                )}
                <div className="flex justify-between text-muted-foreground">
                    <span>Delivery</span>
                    <span>At checkout</span>
                </div>
                <div className="flex justify-between border-t pt-2.5 text-base font-semibold">
                    <span>Total</span>
                    <span className="tabular-nums">{formatRupeesFromPaise(pricePaise)}</span>
                </div>
                {savedPaise > 0 && <p className="text-sm font-medium text-emerald-700">You save {formatRupeesFromPaise(savedPaise)} on this order</p>}
            </section>

            {/* Room for the fixed bar, then the bar itself just above the tabs. */}
            <div className="h-16" aria-hidden />
            <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 border-t bg-background">
                <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-2">
                    <div className="min-w-0">
                        <p className="text-lg font-bold leading-tight tabular-nums">{formatRupeesFromPaise(pricePaise)}</p>
                        {savedPaise > 0 && <p className="text-xs text-emerald-700">Saving {formatRupeesFromPaise(savedPaise)}</p>}
                    </div>
                    <button
                        type="button"
                        disabled={blocked || items === 0}
                        onClick={() => router.push(`${APP}/checkout`)}
                        className="h-12 flex-1 rounded-xl bg-amber-400 text-[15px] font-semibold text-amber-950 active:bg-amber-300 disabled:opacity-50"
                    >
                        Place order
                    </button>
                </div>
            </div>
        </>
    );
}
