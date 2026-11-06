"use client";

import { useEffect, useState } from "react";
import ProductRail from "@/modules/external/shop/ProductRail";
import { noteViewed, useRecentlyViewedRaw } from "@/modules/external/shopApp/appDevicePrefs";
import type { ShopProductPublic } from "@/shared/lib/shop/productPublic";

/**
 * Rows that belong to ONE visitor, so they load in the browser after the page:
 * the page HTML stays the same for everyone (cacheable, what Google sees).
 */

/** Remember a product page visit on this device (same list the phone app keeps). */
export function NoteViewed({ productId }: { productId: number }) {
    useEffect(() => noteViewed(productId), [productId]);
    return null;
}

function useJson(url: string | null): ShopProductPublic[] {
    const [items, setItems] = useState<ShopProductPublic[]>([]);
    useEffect(() => {
        if (!url) return;
        let live = true;
        fetch(url)
            .then((r) => (r.ok ? r.json() : []))
            .then((d: unknown) => live && setItems(Array.isArray(d) ? (d as ShopProductPublic[]) : []))
            .catch(() => {});
        return () => {
            live = false;
        };
    }, [url]);
    return url ? items : [];
}

/** "Recently viewed" — from this browser's own memory; nothing until something was looked at. */
export function RecentlyViewedRail({ excludeId, className }: { excludeId?: number; className?: string }) {
    const raw = useRecentlyViewedRaw();
    const ids = raw.split(",").filter((id) => id && Number(id) !== excludeId).join(",");
    const items = useJson(ids ? `/api/shop/products?ids=${ids}` : null);
    return (
        <ProductRail
            className={className}
            eyebrow="Your history"
            title="Recently viewed"
            products={items}
            seeAllHref={null}
        />
    );
}

/** "Buy again" — the signed-in customer's own past purchases; hidden when signed out. */
export function BuyAgainRail({ eyebrow, title, subtitle }: { eyebrow?: string; title?: string; subtitle?: string }) {
    const items = useJson("/api/shop/buy-again");
    return (
        <ProductRail
            eyebrow={eyebrow ?? "Buy again"}
            title={title ?? "From your past orders"}
            subtitle={subtitle ?? "Running low? Reorder in a tap."}
            products={items}
            seeAllHref={null}
        />
    );
}
