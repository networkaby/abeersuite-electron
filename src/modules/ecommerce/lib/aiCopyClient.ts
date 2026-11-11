"use client";

import axios from "axios";
import type { ProductCopy as ServerCopy } from "@/modules/ecommerce/lib/aiProductCopy";
import type { AiCopyFlow } from "@/shared/lib/constants/ai";

/** fromCache = this machine's saved answer, no new AI call. */
export type ProductCopy = ServerCopy & { fromCache?: boolean };

/** photoAi = AI Setup's Photo AI as this page read it — only keeps an off-run draft from answering an on-run (the server decides). */
export type AiCopyRequest = { productId: number; name?: string; imageUrls?: string[]; flow: AiCopyFlow; bulk?: boolean; premium?: boolean; photoAi?: boolean };

// Every AI call costs money, so a draft is kept on this machine for the session:
// pressing Generate again for the same name + photo + flow is free.
// Not in the DB on purpose — a draft is only kept once staff save it.
function cacheKey(r: AiCopyRequest): string {
    return `aiCopy15:${r.productId}:${r.premium ? "p" : "r"}:${r.photoAi ? "ph" : ""}:${r.flow}:${r.name ?? ""}:${(r.imageUrls ?? []).join("|")}`;
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

/** savedSearch = the last run's search was reused (no Check call, no page search). */
export type PhotoAdvice = Pick<ProductCopy, "photoChecklist" | "photoArrange" | "photoSuggestions"> & { savedSearch?: boolean };

/** "Photos only": Photo AI on the last run's saved search — one AI call, never cached (staff ask for it on purpose). */
export async function fetchAiPhotos(r: Omit<AiCopyRequest, "flow" | "photoAi" | "bulk">): Promise<PhotoAdvice> {
    const { data } = await axios.post<PhotoAdvice>("/api/ecommerce/products/ai-copy", { ...r, photosOnly: true });
    return data;
}
