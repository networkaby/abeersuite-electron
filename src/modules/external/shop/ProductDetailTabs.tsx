"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ShopProductPublic } from "@/shared/lib/shop/productPublic";
import { demoReviewsForProduct } from "@/shared/lib/shop/demoReviews";
import { Badge } from "@/components/ui/badge";
import { Star } from "lucide-react";
import { cn } from "@/shared/lib/format/utils";

export default function ProductDetailTabs({ product }: { product: ShopProductPublic }) {
    const reviews = demoReviewsForProduct(product.id);

    return (
        <Tabs defaultValue="description" className="mt-12 w-full">
            <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 rounded-xl bg-muted/50 p-1">
                <TabsTrigger value="description" className="rounded-lg px-4">
                    Description
                </TabsTrigger>
                <TabsTrigger value="specs" className="rounded-lg px-4">
                    Specifications
                </TabsTrigger>
                <TabsTrigger value="reviews" className="rounded-lg px-4">
                    Reviews ({reviews.length})
                </TabsTrigger>
            </TabsList>
            <TabsContent value="description" className="mt-6 rounded-2xl border border-border/80 bg-card/40 p-6 backdrop-blur-sm">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                    {product.description ?? "No extended description."}
                </p>
            </TabsContent>
            <TabsContent value="specs" className="mt-6 rounded-2xl border border-border/80 bg-card/40 p-6">
                {Object.keys(product.specs).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No specifications listed.</p>
                ) : (
                    <dl className="grid gap-3 sm:grid-cols-2">
                        {Object.entries(product.specs).map(([k, v]) => (
                            <div
                                key={k}
                                className="flex flex-col gap-0.5 rounded-lg border border-border/60 bg-background/50 px-4 py-3"
                            >
                                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{k}</dt>
                                <dd className="text-sm font-medium">{v}</dd>
                            </div>
                        ))}
                    </dl>
                )}
            </TabsContent>
            <TabsContent value="reviews" className="mt-6 space-y-4">
                <p className="text-sm text-muted-foreground">
                    Demo reviews — wire to your review provider when you split the storefront.
                </p>
                <ul className="space-y-4">
                    {reviews.map((r) => (
                        <li
                            key={r.id}
                            className="rounded-2xl border border-border/80 bg-card/50 p-5 shadow-sm"
                        >
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold">{r.author}</span>
                                {r.verified ? (
                                    <Badge variant="secondary" className="text-[10px]">
                                        Verified buyer
                                    </Badge>
                                ) : null}
                                <span className="text-xs text-muted-foreground ml-auto">{r.when}</span>
                            </div>
                            <div className="mt-2 flex items-center gap-0.5 text-amber-500">
                                {Array.from({ length: 5 }).map((_, i) => (
                                    <Star
                                        key={i}
                                        className={cn(
                                            "size-4",
                                            i < Math.round(r.rating) ? "fill-current" : "text-muted/30"
                                        )}
                                    />
                                ))}
                            </div>
                            <p className="mt-2 font-medium">{r.title}</p>
                            <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{r.body}</p>
                        </li>
                    ))}
                </ul>
            </TabsContent>
        </Tabs>
    );
}
