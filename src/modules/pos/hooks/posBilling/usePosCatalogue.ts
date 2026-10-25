"use client";

// ── usePosCatalogue ─────────────────────────────────────────────────────────
// The till's in-memory catalogue for usePosBilling: every product (browser
// cache first, then a delta top-up, kept current on `catalogue` / `stock`)
// and the active POS services (re-read on `catalogue`).

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { readCachedProducts, syncProducts } from "@/shared/lib/inventory";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { type ProductOption, type PosServiceOption } from "@/modules/pos/lib/posDraftTypes";

export function usePosCatalogue() {
    const [allProducts, setAllProducts] = useState<ProductOption[]>([]);
    // Active service catalogue (Settings → Services) — surfaced in the
    // same search list AFTER product matches, added to the cart like products.
    const [allServices, setAllServices] = useState<PosServiceOption[]>([]);

    // The whole catalogue, held in memory so typing and scanning never wait on
    // the network. It comes from the browser's cache first — the till is opened
    // and closed all day, and re-fetching several thousand enriched rows each
    // time was our heaviest repeated read — then a delta tops up whatever moved
    // since, which also keeps prices fresher than the old load-once-per-mount.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const cached = await readCachedProducts<ProductOption>();
            if (cancelled) return;
            if (cached) setAllProducts(cached);
            const synced = await syncProducts<ProductOption>();
            if (cancelled || !synced) return;
            setAllProducts(synced);
        })();
        return () => { cancelled = true; };
    }, []);

    // Keep that in-memory catalogue current while the till sits open: a price
    // re-freeze, a new SKU or a stock voucher elsewhere announces `catalogue` /
    // `stock`, and the same delta top-up runs again. Cart lines stay snapshotted,
    // so a sale in progress never shifts.
    useRealtimeTopics(["catalogue", "stock"], () => {
        void (async () => {
            const synced = await syncProducts<ProductOption>();
            if (synced) setAllProducts(synced);
        })();
    });

    // Load the active POS services — added via the "+ Add service charge" button
    // in the cart (not the product search — services have no barcode). Re-read on
    // `catalogue` for the same reason the product list is: a service added or
    // retired in the office should reach the till without a reload.
    const loadServices = useCallback(() => {
        axios.get<PosServiceOption[]>("/api/pos/services")
            .then((r) => setAllServices(r.data))
            .catch(() => { /* page is still useful without them */ });
    }, []);
    useEffect(() => { loadServices(); }, [loadServices]);
    useRealtimeTopics(["catalogue"], loadServices);

    return { allProducts, setAllProducts, allServices };
}
