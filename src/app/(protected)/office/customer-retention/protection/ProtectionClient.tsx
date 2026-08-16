"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ShieldCheck, ShieldX, Search, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
    Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ProductScanInput, type ScannedProduct } from "@/modules/inventory/components/ProductScanInput";

interface ProtectedProduct {
    id: number;
    productId: number;
    createdAt: string;
    updatedAt: string;
    product: {
        id: number;
        sku: string;
        name: string;
    };
}

export default function ProtectionClient() {
    const [protectedProducts, setProtectedProducts] = useState<ProtectedProduct[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [dialogOpen, setDialogOpen] = useState(false);

    function load() {
        axios.get<ProtectedProduct[]>("/api/retention/protection")
            .then((r) => setProtectedProducts(r.data))
            .catch(() => toast.error("Failed to load protected products"))
            .finally(() => setLoading(false));
    }

    useEffect(load, []);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return protectedProducts;
        return protectedProducts.filter((p) =>
            p.product.sku.toLowerCase().includes(q) ||
            p.product.name.toLowerCase().includes(q)
        );
    }, [protectedProducts, search]);

    async function addProtection(productId: number) {
        try {
            await axios.post("/api/retention/protection", { productId });
            toast.success("Product protected from discounts");
            load();
        } catch {
            toast.error("Failed to protect product");
        }
    }

    async function removeProtection(id: number) {
        try {
            await axios.delete(`/api/retention/protection/${id}`);
            toast.success("Product removed from protection");
            load();
        } catch {
            toast.error("Failed to remove protection");
        }
    }

    return (
        <ScrollArea className="h-full" type="always">
            <div className="mx-auto max-w-5xl space-y-6 px-6 pt-4 pb-10">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                            <ShieldCheck size={22} />
                        </div>
                        <div>
                            <h1 className="text-xl font-semibold leading-tight">Protection</h1>
                            <p className="text-sm text-muted-foreground">
                                Blacklist products from all discount engines (coupons, loyalty, spend tiers).
                                Protected products are excluded from every promotion automatically.
                            </p>
                        </div>
                    </div>
                    <Button onClick={() => setDialogOpen(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        Add Product
                    </Button>
                </div>

                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search by SKU or name..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-10"
                    />
                </div>

                {loading ? (
                    <div className="text-center py-8 text-muted-foreground">Loading protected products…</div>
                ) : filtered.length === 0 ? (
                    <Card>
                        <CardContent className="py-8 text-center text-muted-foreground">
                            {search ? "No protected products match your search." : "No products are currently protected."}
                        </CardContent>
                    </Card>
                ) : (
                    <div className="space-y-2">
                        {filtered.map((p) => (
                            <Card key={p.id}>
                                <CardContent className="flex items-center justify-between py-3">
                                    <div>
                                        <p className="font-medium">{p.product.name}</p>
                                        <p className="text-sm text-muted-foreground">SKU: {p.product.sku}</p>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <Badge variant="secondary" className="bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                                            <ShieldCheck className="mr-1 h-3 w-3" />
                                            Protected
                                        </Badge>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => removeProtection(p.id)}
                                        >
                                            <ShieldX className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}

                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Add Product to Protection</DialogTitle>
                            <DialogDescription>
                                Search for a product to blacklist from all discount engines.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-3">
                            {/* POS-style scan/type box — a barcode scanner types the
                                code + Enter; exact SKU / barcode / EAN / UPC matches
                                win and select in one step. Typeahead also works. */}
                            <ProductScanInput
                                placeholder="Scan or type SKU / barcode / name…"
                                onScan={(p: ScannedProduct) => {
                                    addProtection(p.id);
                                    setDialogOpen(false);
                                }}
                            />
                            <p className="text-[11px] text-muted-foreground">
                                Scan a barcode or type a SKU / name to blacklist it from all discount engines.
                            </p>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>
        </ScrollArea>
    );
}
