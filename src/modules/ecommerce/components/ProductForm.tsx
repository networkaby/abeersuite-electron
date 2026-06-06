"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ShopProductAdmin } from "@/modules/ecommerce/lib/productAdmin";
import type { ShopProductPublic } from "@/shared/lib/shop/productPublic";
import ProductGalleryUploader from "@/modules/ecommerce/components/ProductGalleryUploader";
import ProductCard from "@/modules/external/shop/ProductCard";
import {
    shopQualification,
    DEFAULT_SHOP_PUBLISH_RULES,
    type ShopPublishRules,
} from "@/modules/ecommerce/lib/shopQualification";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { Check, X } from "lucide-react";

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
    // inventory fields
    const [sku, setSku] = useState(initial?.sku ?? "");
    const [name, setName] = useState(initial?.name ?? "");
    // shop fields
    const [slug, setSlug] = useState(initial?.slug ?? "");
    const [shopCategory, setShopCategory] = useState(initial?.category ?? "");
    const [subheading, setSubheading] = useState(initial?.subheading ?? "");
    const [description, setDescription] = useState(initial?.description ?? "");
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
    const [isListedInShop, setIsListedInShop] = useState(initial?.isListedInShop ?? true);
    const [isActive, setIsActive] = useState(initial?.isActive ?? true);
    const [busy, setBusy] = useState(false);
    // Owner-configured publish rules (which fields gate listing). Falls back to
    // the default gate until loaded.
    const [rules, setRules] = useState<ShopPublishRules>(DEFAULT_SHOP_PUBLISH_RULES);

    useEffect(() => {
        axios
            .get<{ rules: ShopPublishRules }>("/api/ecommerce/publish-rules")
            .then((r) => setRules(r.data.rules))
            .catch(() => setRules(DEFAULT_SHOP_PUBLISH_RULES));
    }, []);

    useEffect(() => {
        if (!initial) return;
        setSku(initial.sku ?? "");
        setName(initial.name ?? "");
        setSlug(initial.slug ?? "");
        setShopCategory(initial.category ?? "");
        setSubheading(initial.subheading ?? "");
        setDescription(initial.description ?? "");
        setPriceRupees(initial.pricePaise ? rupeesFromPaise(initial.pricePaise) : "");
        setMrpRupees(initial.mrpPaise ? rupeesFromPaise(initial.mrpPaise) : "");
        setBadge(initial.badge ?? "");
        setGalleryUrls(initial.galleryUrls ?? []);
        setStock(initial.stock === null || initial.stock === undefined ? "" : String(initial.stock));
        setLowStockThreshold(String(initial.lowStockThreshold ?? 5));
        setIsListedInShop(initial.isListedInShop ?? true);
        setIsActive(initial.isActive ?? true);
    }, [initial]);

    // Shop price = the barcode tag the storefront actually charges (derived from
    // the saved sale price, server-side), falling back to the editable effective
    // price while there's no saved price. Used for the live preview + readiness.
    const shopPricePaise = initial?.barcodePricePaise ?? (paiseFromRupeesInput(priceRupees) ?? 0);

    const qualification = shopQualification(
        {
            pricePaise: shopPricePaise,
            imageUrl: galleryUrls[0] ?? null,
            galleryUrls,
            description: description.trim() || null,
            category: shopCategory.trim() || null,
            mrpPaise: mrpRupees.trim() ? paiseFromRupeesInput(mrpRupees) : null,
        },
        rules
    );
    const qualified = qualification.qualified;
    // A non-qualified product can never be listed; the switch is forced off.
    const listedEffective = qualified && isListedInShop;

    const previewProduct: ShopProductAdmin = {
        id: initial?.id ?? 0,
        sku: sku.trim() || "SKU",
        slug: slug.trim() || null,
        name: name.trim() || "Product name",
        subheading: subheading.trim() || null,
        description: description.trim() || null,
        category: shopCategory.trim() || "Accessories",
        pricePaise: shopPricePaise,
        mrpPaise: mrpRupees.trim() ? paiseFromRupeesInput(mrpRupees) : null,
        badge: badge.trim() || null,
        imageUrl: galleryUrls[0] ?? null,
        galleryUrls,
        specs: Object.fromEntries(specPairs.filter((x) => x.k.trim()).map((x) => [x.k.trim(), x.v.trim()])),
        stock: stock.trim() === "" ? null : parseInt(stock, 10),
        lowStockThreshold: parseInt(lowStockThreshold, 10) || 5,
        isListedInShop: listedEffective,
        isActive,
        unitId: initial?.unitId ?? 0,
        categoryId: initial?.categoryId ?? null,
        groupId: initial?.groupId ?? null,
        brandId: initial?.brandId ?? null,
        warrantyTermId: initial?.warrantyTermId ?? null,
        brandName: initial?.brandName ?? null,
        groupName: initial?.groupName ?? null,
        shopCategory: shopCategory.trim() || null,
        savedSalePricePaise: initial?.savedSalePricePaise ?? null,
        barcodePricePaise: initial?.barcodePricePaise ?? null,
    };

    const submit = async () => {
        const pricePaise = paiseFromRupeesInput(priceRupees);
        if (!name.trim()) { toast.error("Name is required"); return; }
        if (!sku.trim() && !initial?.id) { toast.error("SKU is required"); return; }
        const specs = Object.fromEntries(specPairs.filter((x) => x.k.trim()).map((x) => [x.k.trim(), x.v.trim()]));
        const payload = {
            sku: sku.trim() || undefined,
            name: name.trim(),
            slug: slug.trim() || null,
            shopSubheading: subheading.trim() || null,
            shopDescription: description.trim() || null,
            shopCategory: shopCategory.trim() || null,
            pricePaise: pricePaise ?? null,
            mrpPaise: mrpRupees.trim() ? paiseFromRupeesInput(mrpRupees) : null,
            shopBadge: badge.trim() || null,
            galleryUrls,
            specs,
            stock: stock.trim() === "" ? null : parseInt(stock, 10),
            lowStockThreshold: parseInt(lowStockThreshold, 10) || 5,
            // Never send "listed" for a product that isn't shop-ready (server 422s).
            isListedInShop: listedEffective,
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
                <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-2">
                        <Label>SKU</Label>
                        <Input
                            value={sku}
                            onChange={(e) => setSku(e.target.value)}
                            disabled={!!initial?.id}
                            className="font-mono"
                            placeholder="e.g. LAPTOP-001"
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label>Name</Label>
                        <Input value={name} onChange={(e) => setName(e.target.value)} />
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-2">
                        <Label>Slug (optional)</Label>
                        <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="storefront URL handle" />
                    </div>
                    <div className="grid gap-2">
                        <Label>Shop category</Label>
                        <Input value={shopCategory} onChange={(e) => setShopCategory(e.target.value)} placeholder="e.g. Laptops" />
                    </div>
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
                        <Input type="text" inputMode="decimal" value={priceRupees} onChange={(e) => setPriceRupees(e.target.value)} />
                    </div>
                    <div className="grid gap-2">
                        <Label>MRP (₹)</Label>
                        <Input type="text" inputMode="decimal" value={mrpRupees} onChange={(e) => setMrpRupees(e.target.value)} />
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
                <div className="rounded-lg border border-border p-3 space-y-2">
                    <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium">Shop readiness</Label>
                        <span className={qualified ? "text-xs font-medium text-emerald-600" : "text-xs font-medium text-amber-600"}>
                            {qualified ? "Qualified" : "Not ready"}
                        </span>
                    </div>
                    <ul className="space-y-1">
                        {qualification.checks.map((c) => (
                            <li key={c.key} className="flex items-center gap-2 text-sm">
                                {c.ok ? (
                                    <Check className="size-4 text-emerald-600" />
                                ) : (
                                    <X className="size-4 text-muted-foreground" />
                                )}
                                <span className={c.ok ? "" : "text-muted-foreground"}>{c.label}</span>
                            </li>
                        ))}
                    </ul>
                    {initial?.barcodePricePaise != null ? (
                        <p className="text-xs text-muted-foreground">
                            Shop price (barcode): <span className="font-medium tabular-nums">{formatRupeesFromPaise(initial.barcodePricePaise)}</span> — derived from the saved sale price.
                        </p>
                    ) : null}
                </div>
                <div className="flex items-center gap-2">
                    <Switch
                        id="listed"
                        checked={listedEffective}
                        disabled={!qualified}
                        onCheckedChange={setIsListedInShop}
                    />
                    <Label htmlFor="listed" className={!qualified ? "text-muted-foreground" : ""}>
                        Listed in shop {!qualified ? "(add the items above to enable)" : ""}
                    </Label>
                </div>
                <div className="flex items-center gap-2">
                    <Switch id="active" checked={isActive} onCheckedChange={setIsActive} />
                    <Label htmlFor="active">Active</Label>
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
