"use client";

import axios from "axios";
import type { ProductCopy as ServerCopy } from "@/modules/ecommerce/lib/aiProductCopy";
import type { AiSearchMode } from "@/shared/lib/constants/ai";

/** fromCache = this machine's saved answer, no new AI call. */
export type ProductCopy = ServerCopy & { fromCache?: boolean };

export type AiCopyRequest = { productId: number; name?: string; imageUrls?: string[]; search: AiSearchMode; bulk?: boolean; premium?: boolean };

// Every AI call costs money, so a draft is kept on this machine for the session:
// pressing Generate again for the same name + photo + search mode is free.
// Not in the DB on purpose — a draft is only kept once staff save it.
function cacheKey(r: AiCopyRequest): string {
    return `aiCopy7:${r.productId}:${r.premium ? "p" : "r"}:${r.search}:${r.name ?? ""}:${(r.imageUrls ?? []).join("|")}`;
}

function readCache(key: string): ProductCopy | null {
    try {
        const raw = sessionStorage.getItem(key);
        return raw ? (JSON.parse(raw) as ProductCopy) : null;
    } catch {
        return null;
    }
}

export async function fetchAiCopy(r: AiCopyRequest, opts: { fresh?: boolean } = {}): Promise<ProductCopy> {
    const key = cacheKey(r);
    if (!opts.fresh) {
        const hit = readCache(key);
        if (hit) return { ...hit, fromCache: true };
    }
    const { data } = await axios.post<ProductCopy>("/api/ecommerce/products/ai-copy", r);
    try {
        sessionStorage.setItem(key, JSON.stringify(data));
    } catch {
        /* storage full or blocked — the draft still shows */
    }
    return data;
}
