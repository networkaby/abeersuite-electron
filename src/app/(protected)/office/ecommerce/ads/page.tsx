"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import Link from "next/link";
import { Copy, ExternalLink, Map, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/shared/lib/format/utils";
import { businessTodayIso } from "@/shared/lib/format/formatDate";
import { getWithRetry } from "@/shared/lib/http/getWithRetry";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { confirmAction } from "@/shared/lib/ui/confirmStore";
import type { ShopProductPublic } from "@/shared/lib/shop/productPublic";
import {
    AD_KINDS,
    adIncompleteReason,
    adSizeDef,
    isAdLive,
    newShopAd,
    type AdKind,
    type ShopAd,
} from "@/shared/lib/shop/ads";
import AdEditor from "@/modules/ecommerce/components/adsEditor/AdEditor";
import AdPreview from "@/modules/ecommerce/components/adsEditor/AdPreview";
import SpotMap from "@/modules/ecommerce/components/adsEditor/SpotMap";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";

/**
 * E-Commerce → Ads: the storefront ad inventory. One list, saved whole, same
 * as Customize Home. The left pane is the list; the right pane edits and
 * previews the selected ad at every size it may fill. "Where ads show" opens
 * the spot map; "Preview on shop" opens the storefront with every unfilled
 * spot drawn as a placeholder (staff session only).
 */

function StatusChip({ ad, todayIso }: { ad: ShopAd; todayIso: string }) {
    const reason = adIncompleteReason(ad);
    const [label, cls] = reason
        ? [`Incomplete · ${reason}`, "bg-amber-50 text-amber-700"]
        : !ad.enabled
          ? ["Off", "bg-muted text-muted-foreground"]
          : isAdLive(ad, todayIso)
            ? ["Live now", "bg-emerald-50 text-emerald-700"]
            : ["Scheduled", "bg-sky-50 text-sky-700"];
    return <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", cls)}>{label}</span>;
}

function AdRow({
    ad,
    todayIso,
    selected,
    onSelect,
    onToggle,
    onDuplicate,
    onRemove,
}: {
    ad: ShopAd;
    todayIso: string;
    selected: boolean;
    onSelect: () => void;
    onToggle: (on: boolean) => void;
    onDuplicate: () => void;
    onRemove: () => void;
}) {
    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onSelect}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect();
                }
            }}
            className={cn(
                "flex items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors",
                selected ? "border-primary/50 bg-primary/5" : "border-border hover:bg-muted/40",
            )}
        >
            <Switch checked={ad.enabled} onCheckedChange={onToggle} onClick={(e) => e.stopPropagation()} aria-label="On or off" />
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{ad.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                    {AD_KINDS.find((k) => k.value === ad.kind)?.label}
                    {" · "}
                    {ad.sizes.length === 0
                        ? "no size"
                        : ad.sizes.length > 3
                          ? `${ad.sizes.length} sizes`
                          : ad.sizes.map((s) => adSizeDef(s).label).join(", ")}
                    {ad.category ? ` · ${ad.category} only` : ""}
                    {ad.priority !== 0 ? ` · priority ${ad.priority}` : ""}
                </p>
            </div>
            <StatusChip ad={ad} todayIso={todayIso} />
            <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                aria-label="Duplicate"
                onClick={(e) => {
                    e.stopPropagation();
                    onDuplicate();
                }}
            >
                <Copy className="size-3.5" />
            </Button>
            <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 text-destructive"
                aria-label="Delete"
                onClick={(e) => {
                    e.stopPropagation();
                    onRemove();
                }}
            >
                <Trash2 className="size-3.5" />
            </Button>
        </div>
    );
}

export default function EcommerceAdsPage() {
    const todayIso = businessTodayIso();
    const [ads, setAds] = useState<ShopAd[]>([]);
    const [savedJson, setSavedJson] = useState("");
    const [loaded, setLoaded] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const [saving, setSaving] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [addKind, setAddKind] = useState<AdKind>("static");
    const [spotMapOpen, setSpotMapOpen] = useState(false);
    const [products, setProducts] = useState<ShopProductPublic[]>([]);

    const fetchAds = useCallback(() => getWithRetry<{ ads: ShopAd[] }>("/api/ecommerce/ads")
        .then((data) => {
            setAds(data.ads);
            setSavedJson(JSON.stringify(data.ads));
            setLoaded(true);
        })
        .catch(() => {
            setLoadError(true);
        }), []);
    /** Retry / refresh: resets first. */
    const load = useCallback(() => {
        setLoadError(false);
        return fetchAds();
    }, [fetchAds]);

    useEffect(() => {
        void fetchAds();   // first read: `loadError` already starts false
        // The live catalogue feeds the product picker, the category lists and
        // the product-ad preview; the page works without it, just emptier.
        getWithRetry<ShopProductPublic[]>("/api/shop/products")
            .then(setProducts)
            .catch(() => setProducts([]));
    }, [fetchAds]);

    const categories = useMemo(() => [...new Set(products.map((p) => p.category))].sort(), [products]);
    const dirty = loaded && JSON.stringify(ads) !== savedJson;
    // Ads saved on another desk land here unless this desk has unsaved edits.
    useRealtimeTopics(["catalogue"], () => { void load(); }, !dirty);
    const selected = ads.find((a) => a.id === selectedId) ?? null;

    const update = (id: string, patch: Partial<ShopAd>) =>
        setAds((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));

    const add = () => {
        const ad = newShopAd(addKind);
        setAds((prev) => [...prev, ad]);
        setSelectedId(ad.id);
    };

    const duplicate = (id: string) => {
        const src = ads.find((a) => a.id === id);
        if (!src) return;
        // A copy starts switched off, so copying alone never changes the shop.
        const copy: ShopAd = { ...src, id: newShopAd(src.kind).id, name: `${src.name} (copy)`, enabled: false, sample: undefined };
        setAds((prev) => [...prev, copy]);
        setSelectedId(copy.id);
    };

    const remove = async (id: string) => {
        const ad = ads.find((a) => a.id === id);
        if (!ad) return;
        const ok = await confirmAction({
            title: `Delete "${ad.name}"?`,
            body: "It leaves the list now and the storefront when you save.",
            confirmLabel: "Delete",
            destructive: true,
        });
        if (!ok) return;
        setAds((prev) => prev.filter((a) => a.id !== id));
        if (selectedId === id) setSelectedId(null);
    };

    const save = async () => {
        setSaving(true);
        try {
            const { data } = await axios.put<{ ads: ShopAd[] }>("/api/ecommerce/ads", ads);
            setAds(data.ads);
            setSavedJson(JSON.stringify(data.ads));
            toast.success("Ads saved");
        } catch {
            toast.error("Failed to save ads");
        } finally {
            setSaving(false);
        }
    };

    const liveCount = ads.filter((a) => isAdLive(a, todayIso)).length;

    const toolbar = (
        <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
                <Select value={addKind} onValueChange={(v) => setAddKind(v as AdKind)}>
                    <SelectTrigger className="w-40">
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
                <Button type="button" variant="outline" size="sm" onClick={add} disabled={!loaded}>
                    <Plus className="mr-1.5 size-3.5" /> Add ad
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setSpotMapOpen(true)}>
                    <Map className="mr-1.5 size-3.5" aria-hidden /> Where ads show
                </Button>
            </div>
            <div className="flex items-center gap-3">
                {!loaded ? <span className="text-xs text-muted-foreground">Loading…</span> : null}
                {/* The office website, not a bare "/shop": the desktop app has no shop
                    pages, so it opens in the computer's own browser. The empty ad
                    slots only draw for staff signed in there; anyone else sees the
                    live ads. */}
                <Button variant="outline" size="sm" asChild>
                    <Link href={`${COMPANY_DETAILS.sites.office}/shop?adPreview=1`} target="_blank" rel="noopener noreferrer">
                        Preview on shop
                        <ExternalLink className="ml-1.5 size-3.5" aria-hidden />
                    </Link>
                </Button>
                <Button type="button" onClick={() => void save()} disabled={!loaded || saving || !dirty}>
                    {saving ? "Saving…" : "Save ads"}
                </Button>
            </div>
        </div>
    );

    return (
        <div className="mx-auto flex h-full w-full items-stretch gap-4 overflow-hidden">
            <div className="flex min-w-0 flex-1 flex-col">
                <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
                    <CardHeader className="gap-2 border-b border-border px-4 py-3">
                        <CardTitle className="text-base">
                            Ad inventory
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                                {ads.length} ad{ads.length === 1 ? "" : "s"} · {liveCount} live now
                            </span>
                        </CardTitle>
                        {!loadError ? toolbar : null}
                    </CardHeader>
                    <CardContent className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
                        {loadError ? (
                            <div className="flex items-center justify-between rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm">
                                <span className="text-destructive">Couldn&apos;t load the ads.</span>
                                <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                                    Retry
                                </Button>
                            </div>
                        ) : (
                            <>
                                {ads.map((ad) => (
                                    <AdRow
                                        key={ad.id}
                                        ad={ad}
                                        todayIso={todayIso}
                                        selected={selectedId === ad.id}
                                        onSelect={() => setSelectedId(ad.id)}
                                        onToggle={(on) => update(ad.id, { enabled: on })}
                                        onDuplicate={() => duplicate(ad.id)}
                                        onRemove={() => void remove(ad.id)}
                                    />
                                ))}
                                {loaded && ads.length === 0 ? (
                                    <p className="rounded-md border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
                                        No ads yet. Add one above — nothing shows on the shop until an ad is complete, switched on and saved.
                                    </p>
                                ) : null}
                                <p className="pt-2 text-xs text-muted-foreground">
                                    An ad shows only when it is complete, switched on and inside its dates. Each spot takes the
                                    highest-priority ad that fits; equal priorities take turns on every visit; an ad never shows
                                    twice on one page, and a product ad never repeats a product already on the page. Every ad carries
                                    a &ldquo;Sponsored&rdquo; label.
                                </p>
                            </>
                        )}
                    </CardContent>
                </Card>
            </div>

            <div className="flex w-[46%] min-w-[24rem] max-w-3xl shrink-0 flex-col">
                <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
                    <CardHeader className="border-b border-border px-4 py-3">
                        <CardTitle className="text-base">
                            {selected ? selected.name : "Selected ad"}
                            {selected?.sample ? (
                                <span className="ml-2 text-xs font-normal text-muted-foreground">
                                    sample — switch it on to see the real thing on the shop, or replace the artwork
                                </span>
                            ) : null}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                        {selected ? (
                            <div className="space-y-8">
                                <AdEditor
                                    key={selected.id}
                                    ad={selected}
                                    products={products}
                                    categories={categories}
                                    onChange={(patch) => update(selected.id, patch)}
                                />
                                <div className="space-y-3">
                                    <p className="text-sm font-medium">Preview — as the shop draws it</p>
                                    <AdPreview ad={selected} products={products} todayIso={todayIso} />
                                </div>
                            </div>
                        ) : (
                            <div className="flex min-h-40 items-center justify-center rounded-md border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                                Select an ad on the left to edit and preview it.
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            <Dialog open={spotMapOpen} onOpenChange={setSpotMapOpen}>
                <DialogContent className="max-w-4xl sm:max-w-4xl">
                    <DialogHeader>
                        <DialogTitle>Where ads show</DialogTitle>
                    </DialogHeader>
                    <div className="max-h-[75vh] overflow-auto">
                        <SpotMap ads={ads} todayIso={todayIso} />
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
