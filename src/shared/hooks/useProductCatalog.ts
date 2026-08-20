"use client";

/**
 * The shared in-memory + IndexedDB-backed product catalogue.
 *
 * Every product picker in the app (POS, inventory voucher lines, label
 * printing, scan input, universal search) used to hold its OWN axios-fetched
 * copy of `/api/inventory/products/lookup` — the same several-thousand-row
 * enriched catalogue, refetched in full on every single mount, once per
 * picker on screen. This hook makes them all read the SAME array:
 *
 *   1. MEMORY. A module-level Zustand store — the array lives once per tab,
 *      not once per component. Every consumer re-renders off the same
 *      reference; nothing re-fetches just because a second combobox mounted.
 *   2. INDEXEDDB. Backed by `productCatalog.ts` (Dexie `products` table) —
 *      first hydration reads the local replica for an instant paint before
 *      the network answers.
 *   3. SERVER DELTA. `ensureSynced` asks for rows touched since the last
 *      check. Several pickers mounting together (a voucher form with five
 *      product rows) collapse into ONE request via the in-flight dedupe
 *      below, not five.
 *
 * REALTIME keeps it live without polling: any write that touches the
 * "catalogue" topic (a price edit, a new product, a stock-affecting voucher —
 * see `topics.ts`) nudges every open picker to re-run the same cheap delta.
 *
 * `eager: false` is for a picker that is not always used (e.g. a lazily
 * opened lookup panel) — it stays reactive to the shared store but does not
 * itself trigger a fetch; call `loadProductCatalog()` when the user actually
 * asks for it (first focus, etc.). This is what keeps an idle panel from
 * costing a network round trip it never needed.
 */

import { useEffect } from "react";
import { create } from "zustand";
import { readCachedProducts, syncProducts } from "@/shared/lib/inventory/productCatalog";
import type { LocalProductRow } from "@/shared/lib/browser/localDb";
import { useRealtimeTopics } from "./useRealtimeTopics";

type Row = { id: number; name: string };

type CatalogStore = {
    rows: LocalProductRow[];
    /** True once the store holds SOMETHING usable — cache or a sync. */
    hydrated: boolean;
    setRows: (rows: LocalProductRow[]) => void;
    setHydrated: (v: boolean) => void;
};

const useCatalogStore = create<CatalogStore>((set) => ({
    rows: [],
    hydrated: false,
    setRows: (rows) => set({ rows }),
    setHydrated: (hydrated) => set({ hydrated }),
}));

/** Concurrent callers (several pickers mounting on the same page) share one
 *  request instead of firing one each. */
let inFlight: Promise<void> | null = null;

async function ensureSynced(): Promise<void> {
    if (inFlight) return inFlight;
    inFlight = (async () => {
        const { hydrated, setRows, setHydrated } = useCatalogStore.getState();
        if (!hydrated) {
            const cached = await readCachedProducts<LocalProductRow>();
            if (cached) { setRows(cached); setHydrated(true); }
        }
        const synced = await syncProducts<LocalProductRow>();
        if (synced) { setRows(synced); setHydrated(true); }
    })();
    try {
        await inFlight;
    } finally {
        inFlight = null;
    }
}

export function useProductCatalog<T extends Row = LocalProductRow>(
    opts: { eager?: boolean } = {},
): { products: T[]; loading: boolean } {
    const eager = opts.eager ?? true;
    const rows = useCatalogStore((s) => s.rows);
    const hydrated = useCatalogStore((s) => s.hydrated);

    useEffect(() => {
        if (eager) void ensureSynced();
    }, [eager]);

    // A lazy (eager: false) picker still reacts to whatever an eager picker
    // elsewhere loaded, but shouldn't itself provoke a fetch before the store
    // has anything — so it only re-syncs on a live signal once it is warm.
    useRealtimeTopics(["catalogue"], () => {
        if (eager || useCatalogStore.getState().hydrated) void ensureSynced();
    });

    return { products: rows as unknown as T[], loading: eager && !hydrated };
}

/** Imperative one-off read for call sites outside a component's render (event
 *  handlers, non-hook helpers) — syncs if needed and returns the current rows.
 *  Also what a `eager: false` picker calls to trigger its first load. */
export async function loadProductCatalog<T extends Row = LocalProductRow>(): Promise<T[]> {
    await ensureSynced();
    return useCatalogStore.getState().rows as unknown as T[];
}
