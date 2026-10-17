"use client";

import axios from "axios";
import { useSession } from "next-auth/react";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import type { ProductCopy } from "@/modules/ecommerce/lib/aiProductCopy";

export type { ProductCopy };

export type AiCopyRequest = { productId: number; name?: string; imageUrl?: string | null; search: boolean };

/** Whether this staff member holds the AI copy tick (the server checks again). */
export function useCanUseAiCopy(): boolean {
    const perms = (useSession().data?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    return hasPermissionWithScope(perms, PERMISSIONS.ECOMMERCE_AI_COPY);
}

// Every AI call costs money, so a draft is kept on this machine for the session:
// pressing Generate again for the same name + photo + search mode is free.
// Not in the DB on purpose — a draft is only kept once staff save it.
function cacheKey(r: AiCopyRequest): string {
    return `aiCopy2:${r.productId}:${r.search ? 1 : 0}:${r.name ?? ""}:${r.imageUrl ?? ""}`;
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
        if (hit) return hit;
    }
    const { data } = await axios.post<ProductCopy>("/api/ecommerce/products/ai-copy", r);
    try {
        sessionStorage.setItem(key, JSON.stringify(data));
    } catch {
        /* storage full or blocked — the draft still shows */
    }
    return data;
}
