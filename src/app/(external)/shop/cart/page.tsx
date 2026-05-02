"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useShopCartStore } from "@/store/external/shopCartStore";
import { formatRupeesFromPaise } from "@/lib/money-inr";
import { useEffect, useState } from "react";
import axios from "axios";

type ProductRow = { id: number; name: string; pricePaise: number };

export default function ShopCartPage() {
    const { lines, setQty, remove, clear } = useShopCartStore();
    const [products, setProducts] = useState<ProductRow[]>([]);

    useEffect(() => {
        axios
            .get<ProductRow[]>("/api/shop/products")
            .then((r) => setProducts(r.data))
            .catch(() => setProducts([]));
    }, []);

    const byId = new Map(products.map((p) => [p.id, p]));
    let total = 0;
    for (const l of lines) {
        const p = byId.get(l.productId);
        if (p) total += p.pricePaise * l.quantity;
    }

    return (
        <main className="mx-auto max-w-lg px-4 py-8 space-y-6">
            <h1 className="text-2xl font-semibold">Cart</h1>
            {lines.length === 0 ? (
                <p className="text-muted-foreground">
                    Your cart is empty.{" "}
                    <Link href="/shop" className="text-primary underline">
                        Browse products
                    </Link>
                </p>
            ) : (
                <>
                    <ul className="space-y-3">
                        {lines.map((l) => {
                            const p = byId.get(l.productId);
                            return (
                                <li
                                    key={l.productId}
                                    className="flex items-center justify-between gap-2 border border-border rounded-lg p-3"
                                >
                                    <div>
                                        <p className="font-medium">{p?.name ?? `Product #${l.productId}`}</p>
                                        <p className="text-sm text-muted-foreground">
                                            {p ? formatRupeesFromPaise(p.pricePaise) : ""} each
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="number"
                                            min={1}
                                            max={99}
                                            className="w-16 border rounded px-2 py-1 text-sm bg-background"
                                            value={l.quantity}
                                            onChange={(e) =>
                                                setQty(l.productId, parseInt(e.target.value, 10) || 1)
                                            }
                                        />
                                        <Button type="button" variant="ghost" size="sm" onClick={() => remove(l.productId)}>
                                            Remove
                                        </Button>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                    <p className="text-lg font-semibold">Total: {formatRupeesFromPaise(total)}</p>
                    <div className="flex gap-2">
                        <Button asChild>
                            <Link href="/shop/checkout">Checkout</Link>
                        </Button>
                        <Button type="button" variant="outline" onClick={() => clear()}>
                            Clear cart
                        </Button>
                    </div>
                </>
            )}
        </main>
    );
}
