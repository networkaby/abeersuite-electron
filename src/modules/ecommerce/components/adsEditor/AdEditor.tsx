"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { NumericInput } from "@/shared/components/NumericInput";
import ShopImageField from "@/modules/ecommerce/components/ShopImageField";
import { formatRupeesFromPaise, parseRupeesToPaise, paiseToRupees } from "@/shared/lib/format/moneyInr";
import type { ShopProductPublic } from "@/shared/lib/shop/productPublic";
import {
    AD_KINDS,
    AD_PRODUCT_RULES,
    AD_SIZE_DEFS,
    AD_SIZES,
    adSizePx,
    type AdKind,
    type AdProductRule,
    type AdSize,
    type ShopAd,
} from "@/shared/lib/shop/ads";

const ANY_CATEGORY = "__any__";

/**
 * The form for one ad. Edits go straight to the parent's list (`onChange`);
 * nothing reaches the storefront until the page's Save. Mounted with
 * `key={ad.id}` so the typing buffers below start fresh for each ad.
 */
export default function AdEditor({
    ad,
    products,
    categories,
    onChange,
}: {
    ad: ShopAd;
    /** The live catalogue — the product picker and the category lists come from it. */
    products: ShopProductPublic[];
    categories: string[];
    onChange: (patch: Partial<ShopAd>) => void;
}) {
    const [productQuery, setProductQuery] = useState("");
    // The rupee box keeps its own text while typing ("12." must survive a
    // keystroke), and the parsed paise go to the ad on every change.
    const [priceText, setPriceText] = useState(() => (ad.maxPricePaise ? String(paiseToRupees(ad.maxPricePaise)) : ""));

    const setKind = (kind: AdKind) => {
        if (kind === ad.kind) return;
        // The kind-specific fields belong to the other shape — drop them so a
        // static ad never carries a stale rule and vice versa.
        onChange(
            kind === "product"
                ? { kind, imageUrl: undefined, imageAlt: undefined, href: undefined, rule: "bestDeal", sizes: [...AD_SIZES], ctaLabel: ad.ctaLabel ?? "Buy now" }
                : { kind, rule: undefined, productId: undefined, ruleCategory: undefined, maxPricePaise: undefined, sizes: ad.sizes.length === AD_SIZES.length ? ["billboard"] : ad.sizes },
        );
    };

    const toggleSize = (size: AdSize, on: boolean) => {
        const next = on ? [...new Set([...ad.sizes, size])] : ad.sizes.filter((s) => s !== size);
        // Keep the canonical order so the preview and the row read the same way.
        onChange({ sizes: AD_SIZES.filter((s) => next.includes(s)) });
    };

    const chosenProduct = ad.productId ? products.find((p) => p.id === ad.productId) : undefined;
    const productMatches = useMemo(() => {
        const q = productQuery.trim().toLowerCase();
        if (!q) return [];
        return products
            .filter((p) => `${p.displayName} ${p.name} ${p.category}`.toLowerCase().includes(q))
            .slice(0, 8);
    }, [products, productQuery]);

    return (
        <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                    <Label htmlFor="ad-name">Name</Label>
                    <Input id="ad-name" value={ad.name} onChange={(e) => onChange({ name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                    <Label>Kind</Label>
                    <Select value={ad.kind} onValueChange={(v) => setKind(v as AdKind)}>
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {AD_KINDS.map((k) => (
                                <SelectItem key={k.value} value={k.value}>
                                    {k.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">{AD_KINDS.find((k) => k.value === ad.kind)?.hint}</p>
                </div>
            </div>

            <div className="space-y-1.5">
                <Label>Sizes it may fill</Label>
                <p className="text-xs text-muted-foreground">
                    {ad.kind === "static"
                        ? "Tick the size the artwork was made for. Upload at the pixels shown."
                        : "A product ad is drawn to fit, so every size is usually right."}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                    {AD_SIZE_DEFS.map((d) => {
                        const id = `ad-size-${d.size}`;
                        return (
                            <label
                                key={d.size}
                                htmlFor={id}
                                className="flex cursor-pointer items-start gap-2 rounded-md border border-border px-3 py-2 text-sm has-[[data-state=checked]]:border-primary/50 has-[[data-state=checked]]:bg-primary/5"
                            >
                                <Checkbox
                                    id={id}
                                    checked={ad.sizes.includes(d.size)}
                                    onCheckedChange={(v) => toggleSize(d.size, v === true)}
                                    className="mt-0.5"
                                />
                                <span className="min-w-0">
                                    <span className="font-medium">{d.label}</span>
                                    <span className="ml-1.5 text-xs text-muted-foreground">
                                        {d.standard} · {adSizePx(d.size)}
                                    </span>
                                    <span className="block text-xs text-muted-foreground">{d.hint}</span>
                                </span>
                            </label>
                        );
                    })}
                </div>
            </div>

            {ad.kind === "static" ? (
                <div className="grid gap-4 sm:grid-cols-2">
                    <ShopImageField
                        label="Artwork"
                        value={ad.imageUrl ?? null}
                        onChange={(url) => onChange({ imageUrl: url ?? undefined })}
                        folder="shop/ads"
                    />
                    <div className="space-y-4">
                        <div className="space-y-1.5">
                            <Label htmlFor="ad-href">Link</Label>
                            <Input
                                id="ad-href"
                                value={ad.href ?? ""}
                                onChange={(e) => onChange({ href: e.target.value || undefined })}
                                placeholder="/shop?category=CCTV or https://…"
                            />
                            <p className="text-xs text-muted-foreground">A shop path opens in the same tab; a full https:// link opens a new one.</p>
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="ad-alt">Alt text</Label>
                            <Input
                                id="ad-alt"
                                value={ad.imageAlt ?? ""}
                                onChange={(e) => onChange({ imageAlt: e.target.value || undefined })}
                                placeholder="What the picture says, for screen readers"
                            />
                        </div>
                    </div>
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label>Which product</Label>
                            <Select value={ad.rule ?? "bestDeal"} onValueChange={(v) => onChange({ rule: v as AdProductRule })}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {AD_PRODUCT_RULES.map((r) => (
                                        <SelectItem key={r.value} value={r.value}>
                                            {r.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                {AD_PRODUCT_RULES.find((r) => r.value === (ad.rule ?? "bestDeal"))?.hint}
                            </p>
                        </div>

                        {ad.rule === "fixed" ? (
                            <div className="space-y-1.5">
                                <Label htmlFor="ad-product">Product</Label>
                                {chosenProduct ? (
                                    <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                                        <span className="font-medium">{chosenProduct.displayName}</span>
                                        <span className="ml-2 text-xs text-muted-foreground">
                                            {chosenProduct.category} · {formatRupeesFromPaise(chosenProduct.pricePaise)}
                                        </span>
                                    </p>
                                ) : null}
                                <Input
                                    id="ad-product"
                                    value={productQuery}
                                    onChange={(e) => setProductQuery(e.target.value)}
                                    placeholder={chosenProduct ? "Search to change…" : "Search the catalogue…"}
                                />
                                {productMatches.length > 0 ? (
                                    <ul className="max-h-56 overflow-y-auto rounded-md border border-border">
                                        {productMatches.map((p) => (
                                            <li key={p.id}>
                                                <button
                                                    type="button"
                                                    className="flex w-full items-baseline justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted"
                                                    onClick={() => {
                                                        onChange({ productId: p.id });
                                                        setProductQuery("");
                                                    }}
                                                >
                                                    <span className="truncate">{p.displayName}</span>
                                                    <span className="shrink-0 text-xs text-muted-foreground">
                                                        {formatRupeesFromPaise(p.pricePaise)}
                                                    </span>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                ) : null}
                            </div>
                        ) : null}

                        {ad.rule === "category" ? (
                            <div className="space-y-1.5">
                                <Label>Category</Label>
                                <Select value={ad.ruleCategory ?? ""} onValueChange={(v) => onChange({ ruleCategory: v || undefined })}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Pick a category" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {categories.map((c) => (
                                            <SelectItem key={c} value={c}>
                                                {c}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        ) : null}

                        {ad.rule === "underPrice" ? (
                            <div className="space-y-1.5">
                                <Label htmlFor="ad-max-price">Price limit (₹)</Label>
                                <NumericInput
                                    id="ad-max-price"
                                    mode="decimal"
                                    value={priceText}
                                    onValueChange={(v) => {
                                        setPriceText(v);
                                        onChange({ maxPricePaise: parseRupeesToPaise(v) ?? undefined });
                                    }}
                                    min={0}
                                />
                            </div>
                        ) : null}
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="ad-eyebrow">Caption</Label>
                            <Input
                                id="ad-eyebrow"
                                value={ad.eyebrow ?? ""}
                                onChange={(e) => onChange({ eyebrow: e.target.value || undefined })}
                                placeholder="Sponsored pick"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="ad-cta">Button text</Label>
                            <Input
                                id="ad-cta"
                                value={ad.ctaLabel ?? ""}
                                onChange={(e) => onChange({ ctaLabel: e.target.value || undefined })}
                                placeholder="Buy now"
                            />
                        </div>
                    </div>
                </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                    <Label>Show only in</Label>
                    <Select
                        value={ad.category ?? ANY_CATEGORY}
                        onValueChange={(v) => onChange({ category: v === ANY_CATEGORY ? undefined : v })}
                    >
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ANY_CATEGORY}>Anywhere</SelectItem>
                            {categories.map((c) => (
                                <SelectItem key={c} value={c}>
                                    {c} rows only
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                        A category keeps the ad to that group&apos;s rows on the catalog — it never fills the top strip, sidebar or cart.
                    </p>
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor="ad-priority">Priority</Label>
                    <NumericInput
                        id="ad-priority"
                        mode="digits"
                        min={0}
                        max={999}
                        value={String(ad.priority)}
                        onValueChange={(v) => onChange({ priority: parseInt(v, 10) || 0 })}
                    />
                    <p className="text-xs text-muted-foreground">0 to 999. Higher takes a spot first; equal priority takes turns on every visit.</p>
                </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                    <Label>Show from</Label>
                    <TallyDateInput value={ad.startAt ?? ""} onValueChange={(iso) => onChange({ startAt: iso || undefined })} />
                </div>
                <div className="space-y-1.5">
                    <Label>Until</Label>
                    <TallyDateInput value={ad.endAt ?? ""} onValueChange={(iso) => onChange({ endAt: iso || undefined })} />
                </div>
            </div>
        </div>
    );
}
