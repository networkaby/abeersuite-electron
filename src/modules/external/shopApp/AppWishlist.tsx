"use client";

import { useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import { Heart } from "lucide-react";
import MobileHeader from "@/modules/mobile/components/MobileHeader";
import { AppProductTile } from "@/modules/external/shopApp/AppProductRail";
import { APP } from "@/modules/external/shopApp/appPaths";
import { noSubscribe } from "@/modules/mobile/components/installPlace";
import type { ShopProductPublic } from "@/shared/lib/shop/productPublic";
import { useShopWishlistStore } from "@/store/external/shopWishlistStore";

/** Wishlist as a 2-column grid, with a heart on each tile to take it off. */
export default function AppWishlist({ products }: { products: ShopProductPublic[] }) {
    const ids = useShopWishlistStore((s) => s.productIds);
    const toggle = useShopWishlistStore((s) => s.toggle);
    const ready = useSyncExternalStore(noSubscribe, () => true, () => false);
    const list = useMemo(() => products.filter((p) => ids.includes(p.id)), [products, ids]);

    return (
        <>
            <MobileHeader title="Wishlist" back={`${APP}/account`} />
            {!ready ? null : list.length === 0 ? (
                <div className="flex flex-col items-center gap-3 px-8 py-20 text-center">
                    <span className="flex size-20 items-center justify-center rounded-full bg-rose-50 text-rose-500">
                        <Heart className="size-9" />
                    </span>
                    <p className="text-lg font-semibold">Nothing saved yet</p>
                    <p className="text-sm text-muted-foreground">Tap the heart on a product to keep it here.</p>
                    <Link href={APP} className="mt-2 rounded-xl bg-primary px-6 py-3 text-[15px] font-semibold text-primary-foreground">
                        Start shopping
                    </Link>
                </div>
            ) : (
                <ul className="grid grid-cols-2 gap-2.5 px-3 py-3">
                    {list.map((p) => (
                        <li key={p.id} className="relative">
                            <AppProductTile product={p} />
                            <button
                                type="button"
                                onClick={() => toggle(p.id)}
                                className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-full bg-background/90 shadow-sm"
                                aria-label="Remove from wishlist"
                            >
                                <Heart className="size-4 fill-rose-500 text-rose-500" />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </>
    );
}
