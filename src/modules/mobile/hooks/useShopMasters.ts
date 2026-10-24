"use client";

import { useCallback, useEffect, useState } from "react";
import { readCachedMasters, syncMasters, type Masters } from "@/shared/lib/inventory/masterCatalog";
import type { MasterType } from "@/shared/lib/browser/localDb";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { MASTER_PHOTO_KINDS, type MasterPhotoKind } from "../lib/shopPhotos";

export type ShopMasterRow = {
    id: number;
    name: string;
    imageUrl: string | null;
    parentId: number | null;
    isActive: boolean;
};
export type ShopMasters = Record<MasterPhotoKind, ShopMasterRow[]>;

const TABLE: Record<MasterPhotoKind, MasterType> = { brand: "brands", group: "groups", category: "categories" };

function toShopMasters(m: Masters): ShopMasters {
    const out = {} as ShopMasters;
    for (const kind of MASTER_PHOTO_KINDS) {
        out[kind] = m[TABLE[kind]].map((r) => ({
            id: r.id,
            name: String(r.name ?? ""),
            imageUrl: typeof r.imageUrl === "string" && r.imageUrl ? r.imageUrl : null,
            parentId: typeof r.parentId === "number" ? r.parentId : null,
            isActive: r.isActive !== false,
        }));
    }
    return out;
}

/**
 * Brands, groups and categories with their shop image — read from the lookup
 * tables the device already holds (masterCatalog.ts: what is saved shows at once,
 * then only the rows changed since). A catalogue change anywhere (an office edit,
 * this phone's own save) tops it up the same cheap way.
 */
export function useShopMasters(): { masters: ShopMasters | null; loading: boolean; refresh: () => Promise<void> } {
    const [masters, setMasters] = useState<ShopMasters | null>(null);
    const [loading, setLoading] = useState(true);

    const sync = useCallback(() => syncMasters()
        .then((synced) => { if (synced) setMasters(toShopMasters(synced)); })
        .finally(() => setLoading(false)), []);
    const refresh = useCallback(async () => {
        setLoading(true);
        await sync();
    }, [sync]);

    useEffect(() => {
        let live = true;
        // The saved copy only paints an empty screen — never over a fresher sync.
        void readCachedMasters().then((held) => { if (live && held) setMasters((was) => was ?? toShopMasters(held)); });
        void sync();   // `loading` already starts true
        return () => { live = false; };
    }, [sync]);

    useRealtimeTopics(["catalogue"], () => { void refresh(); });

    return { masters, loading: loading && masters == null, refresh };
}
