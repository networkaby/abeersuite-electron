"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { ShopProductPublic } from "@/shared/lib/shop/productPublic";
import ProductCard from "@/modules/external/shop/ProductCard";
import PortalSectionHeader from "@/modules/external/portal/PortalSectionHeader";
import { useShopWishlistStore } from "@/store/external/shopWishlistStore";

export default function PortalWishlistPage() {
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
        <main className="px-3 py-4 sm:px-4 sm:py-6 md:px-6 md:py-8">
            <div className="mx-auto max-w-6xl space-y-5">
                <PortalSectionHeader
                    title="Wishlist"
                    description="Saved products for quick checkout later."
                    icon={Heart}
                    rightSlot={ids.length > 0 ? <Button variant="outline" onClick={() => clearWish()}>Clear</Button> : undefined}
                />
                {list.length === 0 ? (
                    <Card className="border-dashed">
                        <CardContent className="py-16 text-center">
                            <p className="text-sm text-muted-foreground">No saved items yet.</p>
                            <Button className="mt-4" asChild>
                                <Link href="/shop#catalog">Browse catalog</Link>
                            </Button>
                        </CardContent>
                    </Card>
                ) : (
                    <ul className="grid auto-rows-fr gap-5 sm:grid-cols-2 xl:grid-cols-3">
                        {list.map((p) => (
                            <li key={p.id} className="h-full">
                                <ProductCard product={p} className="h-full" />
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </main>
    );
}

