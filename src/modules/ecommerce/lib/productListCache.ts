"use client";

import axios from "axios";
import type { ShopProductAdmin } from "@/modules/ecommerce/lib/productAdmin";

// The admin product list, kept in memory for this window. Products and the AI
// descriptions screen both read it: moving between them paints the last list at
// once and refreshes behind it, instead of a blank screen and a second full read.

let cached: ShopProductAdmin[] | null = null;
let inflight: Promise<ShopProductAdmin[]> | null = null;

export const cachedAdminProducts = () => cached;

/** Fresh list from the server; concurrent callers share one request. */
export function fetchAdminProducts(): Promise<ShopProductAdmin[]> {
    inflight ??= axios
        .get<ShopProductAdmin[]>("/api/ecommerce/products")
        .then((r) => (cached = r.data))
        .finally(() => { inflight = null; });
    return inflight;
}

/** Swap one saved row into the cache so the other screen sees it without a reload. */
export function patchCachedAdminProduct(p: ShopProductAdmin) {
    if (cached) cached = cached.map((x) => (x.id === p.id ? p : x));
}

// Products → "Write with AI" hands its ticked rows to the AI screen, which opens
// with exactly those (in memory only — a reload simply shows the normal list).
let aiPick: number[] | null = null;
export const handOffAiPick = (ids: number[]) => { aiPick = ids; };
export function takeAiPick(): number[] | null {
    const ids = aiPick;
    aiPick = null;
    return ids;
}
