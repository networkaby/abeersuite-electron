"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GatedLink } from "@/shared/components/GatedLink";
import axios from "axios";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { toast } from "sonner";
import { extractApiError } from "@/shared/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ShopProductAdmin } from "@/modules/ecommerce/lib/productAdmin";
import { productShopUrl, type ShopProductPublic } from "@/shared/lib/shop/productPublic";
import ProductGalleryUploader from "@/modules/ecommerce/components/ProductGalleryUploader";
import AiCopyPanel from "@/modules/ecommerce/components/AiCopyPanel";
import ProductCard from "@/modules/external/shop/ProductCard";
import {
    shopQualification,
    DEFAULT_SHOP_PUBLISH_RULES,
    type ShopPublishRules,
} from "@/modules/ecommerce/lib/shopQualification";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { Check, ExternalLink, RefreshCw, X } from "lucide-react";
import type { ProductNaming } from "@/modules/inventory/lib/regenerateNames";

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
    // Online display name — manual, no naming-convention regen. Auto-filled from
    // Name so the operator has something to override rather than typing from
    // scratch; once they edit it directly it stops following Name. Falls back to
    // Name on the storefront whenever it's left blank.
    const [subheading, setSubheading] = useState(initial?.subheading ?? initial?.name ?? "");
    const subheadingTouched = useRef(!!initial?.subheading);
    const [description, setDescription] = useState(initial?.description ?? "");
    // Price / MRP are deliberately NOT editable here. They are the SAME columns
    // (effectiveSalePricePaise / mrpPaise) that sale vouchers, POS lines and the
    // shelf label read — owned by the pricing-strategy engine, edited on the
    // pricing-strategy items page which also sets the override lock, enforces
    // the price ≤ MRP rule and re-materializes the price. A second editor here
    // could only get that wrong (write above MRP, clobber a fresh recompute,
    // then be silently reverted by the engine). Shown read-only below instead.
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
    // Stock is NOT editable here — InvProduct.stock is a cached ledger balance
    // (openingStock + Σ inQty − outQty), rebuilt by recomputeProductStock after
    // every voucher post / cancel / delete / restore. A manual write survives
    // only until the next voucher, so an input box here can only lie. Shown
    // read-only below; stock changes by posting an inventory voucher.
    const stockValue = initial?.stock ?? null;
    // Low-stock threshold is a REORDER input, not a shop field — nothing in the
    // storefront reads it. It is the manual floor in
    // max(avgDailyUsage × leadTimeDays, lowStockThreshold), and the Reorder page
    // edits it in context (it shows the computed reorder level beside the floor,
    // so you can see whether the floor is doing anything). Read-only here.
    const lowStockThresholdValue = initial?.lowStockThreshold ?? 5;
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

    const loadRules = useCallback(() => {
        axios
            .get<{ rules: ShopPublishRules }>("/api/ecommerce/publish-rules")
            .then((r) => setRules(r.data.rules))
            .catch(() => setRules(DEFAULT_SHOP_PUBLISH_RULES));
    }, []);
    useEffect(loadRules, [loadRules]);
    // The publish rules are reference data — the form fields themselves never refresh under the editor.
    useRealtimeTopics(["catalogue"], loadRules);

    // ── Naming convention (Settings → Naming Convention) ──────────────────
    // Slug is built from the product's masters (brand / group / model / …),
    // edited in Deep edit, not here — so this form asks the server what the
    // convention produces rather than re-deriving it client-side. The online
    // display name (subheading) is NOT part of this anymore: it's a manual
    // field, auto-filled from Name and freely overridable — see subheading
    // state above.
    const [regenBusy, setRegenBusy] = useState<null | "slug">(null);

    const regenerate = useCallback(
        async (silent = false) => {
            const productId = initial?.id;
            if (!productId) return;
            setRegenBusy("slug");
            try {
                const { data } = await axios.get<ProductNaming>(`/api/inventory/products/${productId}/naming`);
                if (data.slugEnabled && data.slug) {
                    setSlug(data.slug);
                    if (silent) toast.info("Masters changed — slug rebuilt. Review, then Save.");
                    else toast.success("Rebuilt slug from the naming convention");
                } else if (!silent) {
                    toast.error("Naming convention produced no slug for this product");
                }
            } catch (e: unknown) {
                if (!silent) toast.error(extractApiError(e, "Couldn't read the naming convention"));
            } finally {
                setRegenBusy(null);
            }
        },
        [initial?.id]
    );

    // Auto-rebuild the slug when a naming source actually changed — i.e. the
    // operator came back from Deep edit having swapped the brand / group /
    // warranty. The signature is compared across `initial` reloads, so an
    // unrelated refetch (saving price, photos) never rewrites the field.
    //
    // ONLY while the product is unpublished. Before listing, masters are still
    // being settled and a rebuilt slug costs nothing. Once it is live the slug
    // IS a public URL that customers and search engines hold — a brand edit must
    // not silently move it, so we stop auto-rebuilding and say so; the ⟳ button
    // still forces a rebuild when the operator genuinely wants one.
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
        void regenerate(true);
    }, [namingSig, published, regenerate]);

    useEffect(() => {
        if (!initial) return;
        setSku(initial.sku ?? "");
        setName(initial.name ?? "");
        setSlug(initial.slug ?? "");
        setShopCategory(initial.category ?? "");
        setSubheading(initial.subheading ?? initial.name ?? "");
        subheadingTouched.current = !!initial.subheading;
        setDescription(initial.description ?? "");
        setBadge(initial.badge ?? "");
        setGalleryUrls(initial.galleryUrls ?? []);
        setSelectedImage(0);
        // Loading a product's own saved gallery is not a user edit — skip the
        // next autosave run so it doesn't re-PATCH the value right back.
        galleryFirstRun.current = true;
        setGalleryStatus("idle");
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
    // the saved sale price, server-side), falling back to the office effective
    // price while there's no saved price. Used for the live preview + readiness.
    // Read-only: price is decided on the pricing-strategy items page.
    const shopPricePaise = initial?.barcodePricePaise ?? initial?.pricePaise ?? 0;
    const effectiveMrpPaise = initial?.mrpPaise ?? null;

    const qualification = shopQualification(
        {
            pricePaise: shopPricePaise,
            imageUrl: galleryUrls[0] ?? null,
            galleryUrls,
            description: description.trim() || null,
            category: shopCategory.trim() || null,
            // Group / brand aren't editable here — they come from the inventory
            // master, so the checklist reads the loaded row.
            groupId: initial?.groupId ?? null,
            brandId: initial?.brandId ?? null,
            mrpPaise: effectiveMrpPaise,
            stock: stockValue,
            allowBackorder,
            weightGrams: weightGrams.trim() === "" ? null : parseInt(weightGrams, 10),
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
        displayName: subheading.trim() || name.trim() || "Product name",
        description: description.trim() || null,
        category: shopCategory.trim() || "Accessories",
        // Live preview only — the office-side classification and the group chain
        // are not edited on this form, so the preview card carries neither.
        collection: null,
        department: null,
        categoryPath: [],
        pricePaise: shopPricePaise,
        mrpPaise: effectiveMrpPaise,
        badge: badge.trim() || null,
        imageUrl: previewGallery[0] ?? null,
        galleryUrls: previewGallery,
        specs: Object.fromEntries(specPairs.filter((x) => x.k.trim()).map((x) => [x.k.trim(), x.v.trim()])),
        stock: stockValue,
        lowStockThreshold: lowStockThresholdValue,
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
        // Preview card is display-only; codes exist purely for list search.
        codes: initial?.codes ?? [],
        // availability is display-only on the storefront; the admin preview card
        // doesn't need a resolved value.
        stockStatus: "in_stock",
        orderable: true,
    };

    const submit = async () => {
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
            // pricePaise / mrpPaise / stock / lowStockThreshold deliberately
            // absent — this form does not own them (see the state block above).
            // The PATCH route skips any column it isn't sent, so the pricing
            // engine keeps price/MRP, the stock ledger keeps stock, and the
            // Reorder page keeps the threshold.
            shopBadge: badge.trim() || null,
            galleryUrls,
            specs,
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
                        <Input
                            value={name}
                            onChange={(e) => {
                                const v = e.target.value;
                                setName(v);
                                // Mirror into the online display name until the operator
                                // edits that field directly — gives them a real starting
                                // point instead of a blank box, without ever overwriting
                                // a value they've already typed.
                                if (!subheadingTouched.current) setSubheading(v);
                            }}
                        />
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
                                    onClick={() => void regenerate()}
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
                    <Label>Online display name</Label>
                    <Input
                        value={subheading}
                        onChange={(e) => {
                            subheadingTouched.current = true;
                            setSubheading(e.target.value);
                        }}
                        placeholder="Shown to customers — defaults to Name, edit to override"
                    />
                </div>
                <AiCopyPanel
                    productId={initial?.id}
                    name={name}
                    imageUrl={galleryUrls[selectedImage] ?? galleryUrls[0] ?? null}
                    description={description}
                    subheading={subheading}
                    specPairs={specPairs}
                    onDescription={setDescription}
                    onSubheading={(v) => { subheadingTouched.current = true; setSubheading(v); }}
                    onSpecs={setSpecPairs}
                />
                <div className="grid gap-2">
                    <Label>Description</Label>
                    <textarea
                        className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex min-h-25 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                    />
                </div>
                {/* Price / MRP are read-only here — same columns the sale vouchers,
                    POS and shelf label use. Edited on Update & Print Labels, where
                    the selling voice (Strategy / Computed / Saved) is chosen. */}
                <div className="rounded-md border border-border bg-muted/40 p-3">
                    <div className="flex items-center justify-between gap-3">
                        <Label className="text-muted-foreground">Price &amp; MRP</Label>
                        <GatedLink
                            href="/office/pricing-strategy/update-print-labels"
                            className="inline-flex items-center gap-1 text-xs text-primary underline"
                        >
                            Edit in Pricing Strategy
                            <ExternalLink className="size-3" />
                        </GatedLink>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-3">
                        <div>
                            <p className="text-xs text-muted-foreground">Shop price (barcode tag)</p>
                            <p className="text-lg font-semibold tabular-nums">
                                {shopPricePaise > 0 ? formatRupeesFromPaise(shopPricePaise) : "—"}
                            </p>
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground">MRP</p>
                            <p className="text-lg font-semibold tabular-nums">
                                {effectiveMrpPaise ? formatRupeesFromPaise(effectiveMrpPaise) : "—"}
                            </p>
                        </div>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                        One price everywhere — shelf, POS and shop all charge this.
                    </p>
                </div>
                <div className="grid gap-2">
                    <Label>Badge</Label>
                    <Input value={badge} onChange={(e) => setBadge(e.target.value)} placeholder="e.g. Sale" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                    {/* Stock is read-only — it is the ledger balance, not an input.
                        It changes by posting an inventory voucher. */}
                    <div className="grid gap-2">
                        <Label className="text-muted-foreground">Stock (from ledger)</Label>
                        <div className="flex h-9 items-center rounded-md border border-border bg-muted/40 px-3">
                            <span className="text-sm font-semibold tabular-nums">
                                {stockValue === null ? "Not tracked" : stockValue}
                            </span>
                        </div>
                    </div>
                    {/* Reorder input, not a shop field — the storefront never reads
                        it. Edited on the Reorder page, which shows it in context. */}
                    <div className="grid gap-2">
                        <div className="flex items-center justify-between gap-2">
                            <Label className="text-muted-foreground">Low-stock floor</Label>
                            <GatedLink
                                href="/office/inventory/reorder"
                                className="inline-flex items-center gap-1 text-xs text-primary underline"
                            >
                                Reorder
                                <ExternalLink className="size-3" />
                            </GatedLink>
                        </div>
                        <div className="flex h-9 items-center rounded-md border border-border bg-muted/40 px-3">
                            <span className="text-sm font-semibold tabular-nums">{lowStockThresholdValue}</span>
                        </div>
                    </div>
                </div>
                <p className="-mt-2 text-xs text-muted-foreground">
                    Stock comes from posted inventory vouchers — edit it there, not here.
                    &ldquo;Not tracked&rdquo; means the shop always treats it as in stock. The low-stock
                    floor only feeds the Reorder report, never the storefront.
                </p>
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
                            <Button
                                type="button"
                                variant="outline"
                                size="icon-sm"
                                onClick={() => setSpecPairs(specPairs.filter((_, j) => j !== i))}
                            >
                                <X className="size-4" />
                            </Button>
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
                <div className="flex items-center justify-between">
                    <Label>Live preview</Label>
                    {/* The card's photo, name and Details open the full-page preview in
                        the app, draft or live. A published product also has its real
                        shop page, which opens in the computer's own browser. */}
                    {initial?.id && published ? (
                        <a
                            href={productShopUrl({ id: initial.id, slug: initial.slug ?? null })}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary underline"
                        >
                            Open in shop
                            <ExternalLink className="size-3" />
                        </a>
                    ) : null}
                </div>
                <div className="rounded-lg border border-dashed border-border p-4">
                    <ProductCard product={previewProduct as ShopProductPublic} preview={!!initial?.id} />
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
