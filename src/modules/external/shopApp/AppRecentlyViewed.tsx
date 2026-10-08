"use client";

import { useMemo } from "react";
import AppProductRail from "@/modules/external/shopApp/AppProductRail";
import { useRecentlyViewedRaw } from "@/modules/external/shopApp/appDevicePrefs";
import type { ShopProductPublic } from "@/shared/lib/shop/productPublic";

/** "Recently viewed" — remembered on this phone; nothing shows until the customer has looked at something. */
export default function AppRecentlyViewed({ products }: { products: ShopProductPublic[] }) {
    const raw = useRecentlyViewedRaw();
    const list = useMemo(() => {
        const byId = new Map(products.map((p) => [p.id, p]));
        return raw
            .split(",")
            .filter(Boolean)
            .map((id) => byId.get(Number(id)))
            .filter((p): p is ShopProductPublic => !!p);
    }, [raw, products]);
    if (list.length === 0) return null;
    return (
        <div className="bg-background py-3">
            <AppProductRail title="Recently viewed" products={list} />
        </div>
    );
}
