"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ShopProductPublic } from "@/shared/lib/shop/productPublic";

export default function ProductDetailTabs({ product }: { product: ShopProductPublic }) {
    return (
        <Tabs defaultValue="description" className="mt-12 w-full">
            <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 rounded-xl bg-muted/50 p-1">
                <TabsTrigger value="description" className="rounded-lg px-4">
                    Description
                </TabsTrigger>
                <TabsTrigger value="specs" className="rounded-lg px-4">
                    Specifications
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
        </Tabs>
    );
}
