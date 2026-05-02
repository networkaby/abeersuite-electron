"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import Link from "next/link";
import ShopRemoteImage from "@/modules/external/shop/ShopRemoteImage";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import type { ShopProductPublic } from "@/lib/shop/product-public";
import { productPath } from "@/lib/shop/product-public";
import { formatRupeesFromPaise } from "@/lib/money-inr";
import { useShopCompareStore } from "@/store/external/shopCompareStore";
import { SHOP_COMPARE_MAX } from "@/store/external/shopCompareStore";
import { GitCompare } from "lucide-react";

export default function ShopComparePage() {
    const ids = useShopCompareStore((s) => s.productIds);
    const remove = useShopCompareStore((s) => s.remove);
    const clear = useShopCompareStore((s) => s.clear);
    const [products, setProducts] = useState<ShopProductPublic[]>([]);

    useEffect(() => {
        axios
            .get<ShopProductPublic[]>("/api/shop/products")
            .then((r) => setProducts(r.data))
            .catch(() => setProducts([]));
    }, []);

    const compared = useMemo(
        () => ids.map((id) => products.find((p) => p.id === id)).filter(Boolean) as ShopProductPublic[],
        [ids, products]
    );

    const specKeys = useMemo(() => {
        const s = new Set<string>();
        for (const p of compared) {
            for (const k of Object.keys(p.specs)) s.add(k);
        }
        return [...s].sort((a, b) => a.localeCompare(b));
    }, [compared]);

    return (
        <main className="mx-auto max-w-6xl px-4 py-12">
            <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                        <GitCompare className="size-8 text-primary" />
                        Compare
                    </h1>
                    <p className="text-muted-foreground mt-1 text-sm">
                        Up to {SHOP_COMPARE_MAX} products · spec rows merge automatically
                    </p>
                </div>
                {ids.length > 0 ? (
                    <Button type="button" variant="outline" onClick={() => clear()}>
                        Clear all
                    </Button>
                ) : null}
            </div>

            {compared.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border py-20 text-center">
                    <p className="text-muted-foreground">Add products from the catalog or product pages.</p>
                    <Button className="mt-6 rounded-full" asChild>
                        <Link href="/shop#catalog">Browse catalog</Link>
                    </Button>
                </div>
            ) : (
                <div className="overflow-x-auto rounded-2xl border border-border/80">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-muted/40 hover:bg-muted/40">
                                <TableHead className="w-[160px] min-w-[120px] font-semibold"> </TableHead>
                                {compared.map((p) => (
                                    <TableHead key={p.id} className="min-w-[200px] align-bottom">
                                        <div className="space-y-3 py-2">
                                            <div className="relative mx-auto aspect-square w-full max-w-[140px] overflow-hidden rounded-xl border border-border bg-muted">
                                                {(p.galleryUrls[0] ?? p.imageUrl) ? (
                                                    <ShopRemoteImage
                                                        src={(p.galleryUrls[0] ?? p.imageUrl)!}
                                                        alt=""
                                                        fill
                                                        className="object-cover"
                                                        sizes="140px"
                                                    />
                                                ) : null}
                                            </div>
                                            <Link
                                                href={productPath(p)}
                                                className="font-semibold leading-snug hover:text-primary line-clamp-2"
                                            >
                                                {p.name}
                                            </Link>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="text-destructive"
                                                onClick={() => remove(p.id)}
                                            >
                                                Remove
                                            </Button>
                                        </div>
                                    </TableHead>
                                ))}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            <TableRow>
                                <TableCell className="font-medium text-muted-foreground">Category</TableCell>
                                {compared.map((p) => (
                                    <TableCell key={p.id}>{p.category}</TableCell>
                                ))}
                            </TableRow>
                            <TableRow>
                                <TableCell className="font-medium text-muted-foreground">Price</TableCell>
                                {compared.map((p) => (
                                    <TableCell key={p.id} className="font-semibold tabular-nums">
                                        {formatRupeesFromPaise(p.pricePaise)}
                                    </TableCell>
                                ))}
                            </TableRow>
                            {specKeys.map((key) => (
                                <TableRow key={key}>
                                    <TableCell className="font-medium text-muted-foreground">{key}</TableCell>
                                    {compared.map((p) => (
                                        <TableCell key={p.id}>{p.specs[key] ?? "—"}</TableCell>
                                    ))}
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}
        </main>
    );
}
