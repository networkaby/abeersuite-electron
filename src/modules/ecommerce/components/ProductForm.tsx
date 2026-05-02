"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ShopProductAdmin } from "@/modules/ecommerce/lib/product-admin";
import type { ShopProductPublic } from "@/lib/shop/product-public";
import ProductGalleryUploader from "@/modules/ecommerce/components/ProductGalleryUploader";
import ProductCard from "@/modules/external/shop/ProductCard";

function rupeesFromPaise(p: number) {
    return (p / 100).toFixed(2);
}

function paiseFromRupeesInput(s: string): number | null {
    const n = parseFloat(s);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n * 100);
}

export default function ProductForm({
    initial,
    onSaved,
    submitLabel = "Save product",
}: {
    initial?: Partial<ShopProductAdmin> | null;
    onSaved?: (p: ShopProductAdmin) => void;
    submitLabel?: string;
}) {
    const [name, setName] = useState(initial?.name ?? "");
    const [slug, setSlug] = useState(initial?.slug ?? "");
    const [subheading, setSubheading] = useState(initial?.subheading ?? "");
    const [description, setDescription] = useState(initial?.description ?? "");
    const [category, setCategory] = useState(initial?.category ?? "Accessories");
    const [priceRupees, setPriceRupees] = useState(initial?.pricePaise ? rupeesFromPaise(initial.pricePaise) : "");
    const [mrpRupees, setMrpRupees] = useState(initial?.mrpPaise ? rupeesFromPaise(initial.mrpPaise) : "");
    const [badge, setBadge] = useState(initial?.badge ?? "");
    const [galleryUrls, setGalleryUrls] = useState<string[]>(initial?.galleryUrls ?? []);
    const [specPairs, setSpecPairs] = useState<{ k: string; v: string }[]>(() => {
        const s = initial?.specs ?? {};
        const keys = Object.keys(s);
        if (keys.length === 0) return [{ k: "", v: "" }];
        return keys.map((k) => ({ k, v: s[k] ?? "" }));
    });
    const [stock, setStock] = useState<string>(
        initial?.stock === null || initial?.stock === undefined ? "" : String(initial.stock)
    );
    const [lowStockThreshold, setLowStockThreshold] = useState(String(initial?.lowStockThreshold ?? 5));
    const [isActive, setIsActive] = useState(initial?.isActive ?? true);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!initial) return;
        setName(initial.name ?? "");
        setSlug(initial.slug ?? "");
        setSubheading(initial.subheading ?? "");
        setDescription(initial.description ?? "");
        setCategory(initial.category ?? "Accessories");
        setPriceRupees(initial.pricePaise ? rupeesFromPaise(initial.pricePaise) : "");
        setMrpRupees(initial.mrpPaise ? rupeesFromPaise(initial.mrpPaise) : "");
        setBadge(initial.badge ?? "");
        setGalleryUrls(initial.galleryUrls ?? []);
        setStock(initial.stock === null || initial.stock === undefined ? "" : String(initial.stock));
        setLowStockThreshold(String(initial.lowStockThreshold ?? 5));
        setIsActive(initial.isActive ?? true);
    }, [initial]);

    const previewProduct: ShopProductAdmin = {
        id: initial?.id ?? 0,
        slug: slug.trim() || null,
        name: name.trim() || "Product name",
        subheading: subheading.trim() || null,
        description: description.trim() || null,
        category: category.trim() || "Accessories",
        pricePaise: paiseFromRupeesInput(priceRupees) ?? 0,
        mrpPaise: mrpRupees.trim() ? paiseFromRupeesInput(mrpRupees) : null,
        badge: badge.trim() || null,
        imageUrl: galleryUrls[0] ?? null,
        galleryUrls,
        specs: Object.fromEntries(specPairs.filter((x) => x.k.trim()).map((x) => [x.k.trim(), x.v.trim()])),
        stock: stock.trim() === "" ? null : parseInt(stock, 10),
        lowStockThreshold: parseInt(lowStockThreshold, 10) || 5,
        isActive,
    };

    const submit = async () => {
        const pricePaise = paiseFromRupeesInput(priceRupees);
        if (!name.trim() || pricePaise === null || pricePaise <= 0) {
            toast.error("Name and valid price are required");
            return;
        }
        const specs = Object.fromEntries(specPairs.filter((x) => x.k.trim()).map((x) => [x.k.trim(), x.v.trim()]));
        const payload = {
            name: name.trim(),
            slug: slug.trim() || null,
            subheading: subheading.trim() || null,
            description: description.trim() || null,
            category: category.trim(),
            pricePaise,
            mrpPaise: mrpRupees.trim() ? paiseFromRupeesInput(mrpRupees) : null,
            badge: badge.trim() || null,
            galleryUrls,
            specs,
            stock: stock.trim() === "" ? null : parseInt(stock, 10),
            lowStockThreshold: parseInt(lowStockThreshold, 10) || 5,
            isActive,
            imageUrl: galleryUrls[0] ?? null,
        };

        setBusy(true);
        try {
            let res;
            if (initial?.id) {
                res = await axios.patch<ShopProductAdmin>(`/api/ecommerce/products/${initial.id}`, payload);
            } else {
                res = await axios.post<ShopProductAdmin>(`/api/ecommerce/products`, payload);
            }
            toast.success("Saved");
            onSaved?.(res.data);
        } catch (e: unknown) {
            const msg =
                axios.isAxiosError(e) && e.response?.data && typeof e.response.data === "object"
                    ? (e.response.data as { error?: string }).error
                    : "Save failed";
            toast.error(msg ?? "Save failed");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="grid gap-8 lg:grid-cols-2">
            <div className="space-y-4">
                <div className="grid gap-2">
                    <Label>Name</Label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="grid gap-2">
                    <Label>Slug (optional)</Label>
                    <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="auto / numeric id on storefront" />
                </div>
                <div className="grid gap-2">
                    <Label>Category</Label>
                    <Input value={category} onChange={(e) => setCategory(e.target.value)} />
                </div>
                <div className="grid gap-2">
                    <Label>Subheading</Label>
                    <Input value={subheading} onChange={(e) => setSubheading(e.target.value)} />
                </div>
                <div className="grid gap-2">
                    <Label>Description</Label>
                    <textarea
                        className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex min-h-[100px] w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                    />
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-2">
                        <Label>Price (₹)</Label>
                        <Input type="number" step="0.01" min="0" value={priceRupees} onChange={(e) => setPriceRupees(e.target.value)} />
                    </div>
                    <div className="grid gap-2">
                        <Label>MRP (₹)</Label>
                        <Input type="number" step="0.01" min="0" value={mrpRupees} onChange={(e) => setMrpRupees(e.target.value)} />
                    </div>
                </div>
                <div className="grid gap-2">
                    <Label>Badge</Label>
                    <Input value={badge} onChange={(e) => setBadge(e.target.value)} placeholder="e.g. Sale" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-2">
                        <Label>Stock (blank = unlimited)</Label>
                        <Input value={stock} onChange={(e) => setStock(e.target.value)} inputMode="numeric" />
                    </div>
                    <div className="grid gap-2">
                        <Label>Low-stock threshold</Label>
                        <Input value={lowStockThreshold} onChange={(e) => setLowStockThreshold(e.target.value)} inputMode="numeric" />
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Switch id="active" checked={isActive} onCheckedChange={setIsActive} />
                    <Label htmlFor="active">Active on storefront</Label>
                </div>

                <div className="space-y-2">
                    <Label>Specs</Label>
                    {specPairs.map((row, i) => (
                        <div key={i} className="flex gap-2">
                            <Input
                                placeholder="Label"
                                value={row.k}
                                onChange={(e) => {
                                    const next = [...specPairs];
                                    next[i] = { ...next[i], k: e.target.value };
                                    setSpecPairs(next);
                                }}
                            />
                            <Input
                                placeholder="Value"
                                value={row.v}
                                onChange={(e) => {
                                    const next = [...specPairs];
                                    next[i] = { ...next[i], v: e.target.value };
                                    setSpecPairs(next);
                                }}
                            />
                        </div>
                    ))}
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setSpecPairs([...specPairs, { k: "", v: "" }])}
                    >
                        Add spec row
                    </Button>
                </div>

                <div className="space-y-2">
                    <Label>Gallery</Label>
                    <ProductGalleryUploader urls={galleryUrls} onChange={setGalleryUrls} />
                </div>

                <Button type="button" onClick={() => void submit()} disabled={busy}>
                    {busy ? "Saving…" : submitLabel}
                </Button>
            </div>

            <div className="space-y-2">
                <Label>Live preview</Label>
                <div className="rounded-lg border border-dashed border-border p-4">
                    <ProductCard product={previewProduct as ShopProductPublic} />
                </div>
            </div>
        </div>
    );
}
