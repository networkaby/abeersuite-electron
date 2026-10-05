"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Camera, ImageOff } from "lucide-react";
import { invalidateProductCatalog, useProductCatalog } from "@/shared/hooks/useProductCatalog";
import { productMatchesSearch, searchableText, searchProducts } from "@/shared/lib/inventory";
import { cloudinaryThumb } from "@/shared/lib/cloudinaryImage";
import { PHONE_APP_HOME } from "@/shared/lib/device/phone";
import { useShopMasters } from "../hooks/useShopMasters";
import { PHOTO_KINDS, PHOTO_KIND_LABEL, PHOTO_KIND_PLURAL, type PhotoKind } from "../lib/shopPhotos";
import MobileListScreen from "./MobileListScreen";

/** The catalogue row fields this screen reads (the POS lookup row carries more). */
type CatalogueRow = { id: number; name: string; sku: string | null; isActive?: boolean; imageUrl?: string | null };
type Row = { id: number; name: string; sub: string | null; imageUrl: string | null };

const PAGE = 30;

export const photosHref = (kind: PhotoKind) => `${PHONE_APP_HOME}/photos?kind=${kind}`;

/**
 * Pick what needs a shop photo: products, brands, groups or categories, with "No
 * photo" on by default so the list is the work still to do. Everything comes from
 * what the device already holds — the product catalogue (useProductCatalog) and
 * the lookup tables (useShopMasters) — so searching and switching tabs ask the
 * server nothing. A row opens its photo screen.
 */
export default function MobilePhotos({ initialKind }: { initialKind: PhotoKind }) {
    const [kind, setKind] = useState<PhotoKind>(initialKind);
    const [missingOnly, setMissingOnly] = useState(true);
    const [query, setQuery] = useState("");
    const [limit, setLimit] = useState(PAGE);
    const { products, loading: productsLoading } = useProductCatalog<CatalogueRow>();
    const { masters, loading: mastersLoading, refresh: refreshMasters } = useShopMasters();

    const pool: Row[] = useMemo(() => {
        if (kind === "product") {
            return products
                .filter((p) => p.isActive !== false)
                .map((p) => ({ id: p.id, name: p.name, sub: p.sku, imageUrl: p.imageUrl ?? null }));
        }
        const rows = (masters?.[kind] ?? []).filter((m) => m.isActive);
        const names = new Map(rows.map((m) => [m.id, m.name]));
        return rows.map((m) => ({
            id: m.id,
            name: m.name,
            sub: m.parentId != null ? `in ${names.get(m.parentId) ?? "…"}` : null,
            imageUrl: m.imageUrl,
        }));
    }, [kind, products, masters]);

    const missingCount = useMemo(() => pool.filter((r) => !r.imageUrl).length, [pool]);

    const { shown, more } = useMemo(() => {
        const base = missingOnly ? pool.filter((r) => !r.imageUrl) : pool;
        const q = query.trim();
        let rows: Row[];
        if (!q) rows = [...base].sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit + 1);
        else if (kind === "product") {
            // The till's own search (name, SKU, any barcode, typos) over the catalogue rows.
            const ids = new Set(base.map((r) => r.id));
            const live = products.filter((p) => ids.has(p.id));
            const byId = new Map(base.map((r) => [r.id, r]));
            rows = searchProducts(live, q, { rows: limit + 1 }).rows.map((p) => byId.get(p.id)!);
        } else {
            const needle = q.toLowerCase();
            rows = base.filter((r) => productMatchesSearch(r, needle, { text: (x) => searchableText(x.name) })).slice(0, limit + 1);
        }
        return { shown: rows.slice(0, limit), more: rows.length > limit };
    }, [pool, missingOnly, query, limit, kind, products]);

    const switchKind = (next: PhotoKind) => {
        setKind(next);
        setLimit(PAGE);
        setQuery("");
        // In the address, so Back from a photo screen lands on the same tab — without
        // asking the server for the page again (Next keeps its router in step).
        window.history.replaceState(null, "", photosHref(next));
    };

    const loading = kind === "product" ? productsLoading : mastersLoading;
    const chip = (on: boolean) =>
        `shrink-0 rounded-full border px-3 py-1.5 text-xs ${on ? "border-primary bg-primary/10 font-semibold text-primary" : ""}`;

    const summary = (
        <div className="space-y-2 border-b px-3 pb-3">
            <div className="flex gap-2 overflow-x-auto" role="tablist" aria-label="What to photograph">
                {PHOTO_KINDS.map((k) => (
                    <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => switchKind(k)} className={chip(kind === k)}>
                        {PHOTO_KIND_PLURAL[k]}
                    </button>
                ))}
            </div>
            <div className="flex gap-2">
                <button type="button" onClick={() => { setMissingOnly(true); setLimit(PAGE); }} className={chip(missingOnly)}>
                    No photo<span className="ml-1 text-muted-foreground">{missingCount}</span>
                </button>
                <button type="button" onClick={() => { setMissingOnly(false); setLimit(PAGE); }} className={chip(!missingOnly)}>
                    All<span className="ml-1 text-muted-foreground">{pool.length}</span>
                </button>
            </div>
        </div>
    );

    return (
        <MobileListScreen
            title="Photos"
            placeholder={kind === "product" ? "Product name, SKU or barcode" : `${PHOTO_KIND_LABEL[kind]} name`}
            query={query}
            onQuery={(q) => { setQuery(q); setLimit(PAGE); }}
            list={{
                loading,
                error: null,
                hasMore: more,
                empty: shown.length === 0,
                loadMore: () => setLimit((n) => n + PAGE),
                refresh: () => { void (kind === "product" ? invalidateProductCatalog() : refreshMasters()); },
            }}
            emptyText={
                loading ? "Loading…"
                : missingOnly && !query.trim() ? `Every ${PHOTO_KIND_LABEL[kind].toLowerCase()} has a photo.`
                : "Nothing found."
            }
            summary={summary}
        >
            {shown.map((r) => (
                <li key={r.id}>
                    <Link href={`${PHONE_APP_HOME}/photos/${kind}/${r.id}`} className="flex items-center gap-3 px-3 py-2.5 active:bg-muted">
                        <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted text-muted-foreground">
                            {r.imageUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element -- remote Cloudinary thumb, not a static asset
                                <img src={cloudinaryThumb(r.imageUrl, 96)} alt="" loading="lazy" className="size-full object-cover" />
                            ) : (
                                <ImageOff className="size-5" aria-hidden />
                            )}
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block font-medium leading-snug">{r.name}</span>
                            {r.sub && <span className="block text-xs text-muted-foreground">{r.sub}</span>}
                        </span>
                        <Camera className="size-5 shrink-0 text-primary" aria-hidden />
                    </Link>
                </li>
            ))}
        </MobileListScreen>
    );
}
