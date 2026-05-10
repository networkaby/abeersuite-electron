"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { ShopProductPublic } from "@/shared/lib/shop/productPublic";
import ProductCard from "@/modules/external/shop/ProductCard";
import { useShopWishlistStore } from "@/store/external/shopWishlistStore";
import { Heart } from "lucide-react";

export default function ShopWishlistPage() {
    const ids = useShopWishlistStore((s) => s.productIds);
    const clearWish = useShopWishlistStore((s) => s.clear);
    const [products, setProducts] = useState<ShopProductPublic[]>([]);

    useEffect(() => {
        axios
            .get<ShopProductPublic[]>("/api/shop/products")
            .then((r) => setProducts(r.data))
            .catch(() => setProducts([]));
    }, []);

    const list = useMemo(() => products.filter((p) => ids.includes(p.id)), [products, ids]);

    return (
        <main className="mx-auto max-w-6xl px-4 py-12">
            <div className="flex flex-wrap items-end justify-between gap-4 mb-10">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                        <Heart className="size-8 text-primary fill-primary/20" />
                        Wishlist
                    </h1>
                    <p className="text-muted-foreground mt-1 text-sm">
                        Saved on this device — sync to account when you wire persistence.
                    </p>
                </div>
                {ids.length > 0 ? (
                    <Button type="button" variant="outline" onClick={() => clearWish()}>
                        Clear wishlist
                    </Button>
                ) : null}
            </div>

            {list.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border py-20 text-center">
                    <p className="text-muted-foreground">No saved items yet.</p>
                    <Button className="mt-6 rounded-full" asChild>
                        <Link href="/shop#catalog">Browse catalog</Link>
                    </Button>
                </div>
            ) : (
                <ul className="grid auto-rows-fr gap-6 sm:grid-cols-2 xl:grid-cols-3">
                    {list.map((p) => (
                        <li key={p.id} className="flex min-h-0 h-full flex-col">
                            <ProductCard product={p} className="min-h-0 flex-1" />
                        </li>
                    ))}
                </ul>
            )}
        </main>
    );
}
