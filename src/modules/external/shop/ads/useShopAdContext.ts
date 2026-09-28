"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { businessTodayIso } from "@/shared/lib/format/formatDate";
import type { ShopAd, ShopAdContext } from "@/shared/lib/shop/ads";

/**
 * Client-rendered shop pages (wishlist, cart) fetch their ad pool after mount —
 * the server-rendered ones get it as a prop from `loadShopAdContext`. `null`
 * until it arrives; the page simply shows no ads meanwhile.
 */
export function useShopAdContext(): ShopAdContext | null {
    const [ctx, setCtx] = useState<ShopAdContext | null>(null);
    useEffect(() => {
        const wantPreview = new URLSearchParams(window.location.search).get("adPreview") === "1";
        axios
            .get<{ ads: ShopAd[]; staff: boolean }>("/api/shop/ads")
            .then((r) =>
                setCtx({
                    ads: r.data.ads,
                    adSeed: Math.floor(Math.random() * 1_000_000),
                    adPreview: wantPreview && r.data.staff,
                    todayIso: businessTodayIso(),
                }),
            )
            .catch(() => setCtx({ ads: [], adSeed: 0, adPreview: false, todayIso: businessTodayIso() }));
    }, []);
    return ctx;
}
