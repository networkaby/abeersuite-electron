"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { extractApiError } from "@/shared/lib/api";
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
import { Check, RefreshCw, X } from "lucide-react";
import type { ProductNaming } from "@/modules/inventory/lib/regenerateNames";

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
    // Which gallery photo is selected in the uploader — lifted up so the live
    // preview card can show that photo, not just index 0.
    const [selectedImage, setSelectedImage] = useState(0);
    const [galleryStatus, setGalleryStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
    const galleryFirstRun = useRef(true);
    const galleryDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
    const gallerySeq = useRef(0);
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
    const [weightGrams, setWeightGrams] = useState<string>(
        initial?.weightGrams == null ? "" : String(initial.weightGrams)
    );
    const dimStr = (v: number | null | undefined) => (v == null ? "" : String(v));
    const [lengthCm, setLengthCm] = useState<string>(dimStr(initial?.lengthCm));
    const [breadthCm, setBreadthCm] = useState<string>(dimStr(initial?.breadthCm));
    const [heightCm, setHeightCm] = useState<string>(dimStr(initial?.heightCm));
    const [isListedInShop, setIsListedInShop] = useState(initial?.isListedInShop ?? true);
    const [allowBackorder, setAllowBackorder] = useState(initial?.allowBackorder ?? false);
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

    // ── Naming convention (Settings → Naming Convention) ──────────────────
    // Online display name + slug are built from the product's masters (brand /
    // group / model / warranty / …). Those masters are edited in Deep edit, not
    // here, so this form asks the server what the convention produces rather
    // than re-deriving it client-side — one naming engine, no drift.
    const [regenBusy, setRegenBusy] = useState<null | "onlineName" | "slug" | "both">(null);

    const regenerate = useCallback(
        async (which: "onlineName" | "slug" | "both", silent = false) => {
            const productId = initial?.id;
            if (!productId) return;
            setRegenBusy(which);
            try {
                const { data } = await axios.get<ProductNaming>(`/api/inventory/products/${productId}/naming`);
                const touched: string[] = [];
                if (which !== "slug" && data.onlineName) {
                    setSubheading(data.onlineName);
                    touched.push("online name");
                }
                if (which !== "onlineName" && data.slugEnabled && data.slug) {
                    setSlug(data.slug);
                    touched.push("slug");
                }
                if (touched.length === 0) {
                    if (!silent) toast.error("Naming convention produced nothing for this product");
                } else if (silent) {
                    toast.info(`Masters changed — ${touched.join(" and ")} rebuilt. Review, then Save.`);
                } else {
                    toast.success(`Rebuilt ${touched.join(" and ")} from the naming convention`);
                }
            } catch (e: unknown) {
                if (!silent) toast.error(extractApiError(e, "Couldn't read the naming convention"));
            } finally {
                setRegenBusy(null);
            }
        },
        [initial?.id]
    );

    // Auto-rebuild when a naming source actually changed — i.e. the operator
    // came back from Deep edit having swapped the brand / group / warranty. The
    // signature is compared across `initial` reloads, so an unrelated refetch
    // (saving price, photos) never rewrites the fields.
    //
    // ONLY while the product is unpublished. Before listing, masters are still
    // being settled and a rebuilt slug costs nothing. Once it is live the slug
    // IS a public URL that customers and search engines hold — a brand edit must
    // not silently move it, so we stop auto-rebuilding and say so; the ⟳ buttons
    // still force a rebuild when the operator genuinely wants one.
    const namingSig = [
        initial?.brandId, initial?.groupId, initial?.categoryId,
        initial?.warrantyTermId, initial?.unitId,
    ].join("|");
    const lastNamingSig = useRef<string | null>(null);
    const published = initial?.isListedInShop ?? false;

    useEffect(() => {
        const first = lastNamingSig.current === null;
        const changed = !first && lastNamingSig.current !== namingSig;
        lastNamingSig.current = namingSig;
        if (!changed) return;
        if (published) {
            toast.info("Masters changed. This product is live, so its slug was left alone — use ⟳ to rebuild it.");
            return;
        }
        void regenerate("both", true);
    }, [namingSig, published, regenerate]);

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
        setSelectedImage(0);
        // Loading a product's own saved gallery is not a user edit — skip the
        // next autosave run so it doesn't re-PATCH the value right back.
        galleryFirstRun.current = true;
        setGalleryStatus("idle");
        setStock(initial.stock === null || initial.stock === undefined ? "" : String(initial.stock));
        setLowStockThreshold(String(initial.lowStockThreshold ?? 5));
        setWeightGrams(initial.weightGrams == null ? "" : String(initial.weightGrams));
        setLengthCm(dimStr(initial.lengthCm));
        setBreadthCm(dimStr(initial.breadthCm));
        setHeightCm(dimStr(initial.heightCm));
        setIsListedInShop(initial.isListedInShop ?? true);
        setAllowBackorder(initial.allowBackorder ?? false);
        setIsActive(initial.isActive ?? true);
    }, [initial]);

    // Autosave the photo block the moment it changes — add/remove/reorder/adjust/
    // make-primary all flow through `galleryUrls`, so one effect covers every
    // Photos action without each button wiring its own save call. Only fires for
    // an already-saved product (there's no id to PATCH until the first full Save).
    // Debounced so a burst of clicks (e.g. reordering twice) becomes one request.
    useEffect(() => {
        if (galleryFirstRun.current) {
            galleryFirstRun.current = false;
            return;
        }
        const productId = initial?.id;
        if (!productId) return;

        if (galleryDebounce.current) clearTimeout(galleryDebounce.current);
        setGalleryStatus("saving");
        const seq = ++gallerySeq.current;
        galleryDebounce.current = setTimeout(() => {
            axios
                .patch(`/api/ecommerce/products/${productId}`, {
                    galleryUrls,
                    imageUrl: galleryUrls[0] ?? null,
                })
                .then(() => {
                    if (gallerySeq.current === seq) setGalleryStatus("saved");
                })
                .catch((e: unknown) => {
                    if (gallerySeq.current === seq) {
                        setGalleryStatus("error");
                        toast.error(extractApiError(e, "Couldn't save photos"));
                    }
                });
        }, 500);

        return () => {
            if (galleryDebounce.current) clearTimeout(galleryDebounce.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- fires on gallery edits only, not every initial/id change
    }, [galleryUrls]);

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
            stock: stock.trim() === "" ? null : parseInt(stock, 10),
        },
        rules
    );
    const qualified = qualification.qualified;
    // A non-qualified product can never be listed; the switch is forced off.
    const listedEffective = qualified && isListedInShop;

    // The live card always renders galleryUrls[0], so put the photo the user has
    // selected in the gallery first — preview only, the saved order is untouched.
    const previewGallery =
        selectedImage > 0 && selectedImage < galleryUrls.length
            ? [galleryUrls[selectedImage], ...galleryUrls.filter((_, i) => i !== selectedImage)]
            : galleryUrls;

    const previewProduct: ShopProductAdmin = {
        id: initial?.id ?? 0,
        sku: sku.trim() || "SKU",
        slug: slug.trim() || null,
        name: name.trim() || "Product name",
        subheading: subheading.trim() || null,
        description: description.trim() || null,
        category: shopCategory.trim() || "Accessories",
        // Live preview only — the office-side classification and the group chain
        // are not edited on this form, so the preview card carries neither.
        collection: null,
        department: null,
        categoryPath: [],
        pricePaise: shopPricePaise,
        mrpPaise: mrpRupees.trim() ? paiseFromRupeesInput(mrpRupees) : null,
        badge: badge.trim() || null,
        imageUrl: previewGallery[0] ?? null,
        galleryUrls: previewGallery,
        specs: Object.fromEntries(specPairs.filter((x) => x.k.trim()).map((x) => [x.k.trim(), x.v.trim()])),
        stock: stock.trim() === "" ? null : parseInt(stock, 10),
        lowStockThreshold: parseInt(lowStockThreshold, 10) || 5,
        isListedInShop: listedEffective,
        allowBackorder,
        isActive,
        unitId: initial?.unitId ?? 0,
        categoryId: initial?.categoryId ?? null,
        groupId: initial?.groupId ?? null,
        brandId: initial?.brandId ?? null,
        warrantyTermId: initial?.warrantyTermId ?? null,
        weightGrams: weightGrams.trim() === "" ? null : parseInt(weightGrams, 10),
        lengthCm: lengthCm.trim() === "" ? null : parseInt(lengthCm, 10),
        breadthCm: breadthCm.trim() === "" ? null : parseInt(breadthCm, 10),
        heightCm: heightCm.trim() === "" ? null : parseInt(heightCm, 10),
        brandName: initial?.brandName ?? null,
        groupName: initial?.groupName ?? null,
        shopCategory: shopCategory.trim() || null,
        savedSalePricePaise: initial?.savedSalePricePaise ?? null,
        barcodePricePaise: initial?.barcodePricePaise ?? null,
        // availability is display-only on the storefront; the admin preview card
        // doesn't need a resolved value.
        stockStatus: "in_stock",
        orderable: true,
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
            weightGrams: weightGrams.trim() === "" ? null : parseInt(weightGrams, 10),
            lengthCm: lengthCm.trim() === "" ? null : parseInt(lengthCm, 10),
            breadthCm: breadthCm.trim() === "" ? null : parseInt(breadthCm, 10),
            heightCm: heightCm.trim() === "" ? null : parseInt(heightCm, 10),
            // Never send "listed" for a product that isn't shop-ready (server 422s).
            isListedInShop: listedEffective,
            allowBackorder,
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
            toast.error(extractApiError(e, "Save failed"));
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
                        <div className="flex items-center gap-2">
                            <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="storefront URL handle" />
                            {initial?.id ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="icon-sm"
                                    disabled={regenBusy !== null}
                                    onClick={() => void regenerate("slug")}
                                    title="Rebuild the slug from Settings → Naming Convention. Changing a live slug breaks its old URL."
                                >
                                    <RefreshCw className="size-4" />
                                </Button>
                            ) : null}
                        </div>
                    </div>
                    <div className="grid gap-2">
                        <Label>Shop category</Label>
                        <Input value={shopCategory} onChange={(e) => setShopCategory(e.target.value)} placeholder="e.g. Laptops" />
                    </div>
                </div>
                <div className="grid gap-2">
                    <Label>Subheading (online display name)</Label>
                    <div className="flex items-center gap-2">
                        <Input value={subheading} onChange={(e) => setSubheading(e.target.value)} />
                        {initial?.id ? (
                            <Button
                                type="button"
                                variant="outline"
                                size="icon-sm"
                                disabled={regenBusy !== null}
                                onClick={() => void regenerate("onlineName")}
                                title="Rebuild from Settings → Naming Convention"
                            >
                                <RefreshCw className="size-4" />
                            </Button>
                        ) : null}
                    </div>
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
                <div className="grid gap-2">
                    <Label>Shipping weight (grams)</Label>
                    <Input
                        value={weightGrams}
                        onChange={(e) => setWeightGrams(e.target.value)}
                        inputMode="numeric"
                        placeholder="e.g. 500 — actual weight"
                    />
                </div>
                <div className="grid gap-2">
                    <Label>Parcel dimensions (cm) — for volumetric weight</Label>
                    <div className="grid grid-cols-3 gap-3">
                        <Input value={lengthCm} onChange={(e) => setLengthCm(e.target.value)} inputMode="numeric" placeholder="Length" />
                        <Input value={breadthCm} onChange={(e) => setBreadthCm(e.target.value)} inputMode="numeric" placeholder="Breadth" />
                        <Input value={heightCm} onChange={(e) => setHeightCm(e.target.value)} inputMode="numeric" placeholder="Height" />
                    </div>
                    {(() => {
                        const l = parseInt(lengthCm, 10) || 0;
                        const b = parseInt(breadthCm, 10) || 0;
                        const h = parseInt(heightCm, 10) || 0;
                        const vol = l > 0 && b > 0 && h > 0 ? Math.round((l * b * h * 1000) / 5000) : 0;
                        const actual = parseInt(weightGrams, 10) || 0;
                        if (vol === 0) return null;
                        const charged = Math.max(actual, vol);
                        return (
                            <p className="text-xs text-muted-foreground">
                                Volumetric {vol} g (L×B×H ÷ 5000). Couriers charge on{" "}
                                <span className="font-medium">max(actual, volumetric) = {charged} g</span>
                                {charged > actual ? " (volumetric wins)" : ""}.
                            </p>
                        );
                    })()}
                </div>
                <div className="flex items-center gap-2">
                    <Switch
                        id="listed"
                        checked={listedEffective}
                        disabled={!qualified}
                        onCheckedChange={setIsListedInShop}
                    />
                    <Label htmlFor="listed" className={!qualified ? "text-muted-foreground" : ""}>
                        Listed in shop {!qualified ? "(see Shop readiness below to enable)" : ""}
                    </Label>
                </div>
                <div className="flex items-center gap-2">
                    <Switch id="backorder" checked={allowBackorder} onCheckedChange={setAllowBackorder} />
                    <Label htmlFor="backorder">
                        Allow orders when out of stock
                        <span className="text-muted-foreground ml-1 text-xs">(backorder — overrides the shop policy)</span>
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

                <Button type="button" onClick={() => void submit()} disabled={busy}>
                    {busy ? "Saving…" : submitLabel}
                </Button>
            </div>

            <div className="space-y-2">
                <Label>Live preview</Label>
                <div className="rounded-lg border border-dashed border-border p-4">
                    <ProductCard product={previewProduct as ShopProductPublic} />
                </div>
                {/* Photos sit under the live card: every change here is seen
                    immediately in the card above, so no second preview is needed. */}
                <div className="space-y-2 pt-2">
                    <div className="flex items-center justify-between">
                        <Label>Photos</Label>
                        {initial?.id ? (
                            <span className="text-xs text-muted-foreground">
                                {galleryStatus === "saving"
                                    ? "Saving…"
                                    : galleryStatus === "saved"
                                        ? "Saved"
                                        : galleryStatus === "error"
                                            ? "Save failed"
                                            : ""}
                            </span>
                        ) : (
                            <span className="text-xs text-muted-foreground">Saves after you create the product</span>
                        )}
                    </div>
                    <ProductGalleryUploader
                        urls={galleryUrls}
                        onChange={setGalleryUrls}
                        selected={selectedImage}
                        onSelectedChange={setSelectedImage}
                    />
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
            </div>
        </div>
    );
}
