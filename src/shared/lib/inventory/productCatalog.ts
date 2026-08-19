"use client";

/**
 * The POS product catalogue, cached in the browser and topped up by delta.
 *
 * The till is opened and closed many times a day — tab to tab, report to report
 * — and each mount used to re-fetch every active product AND re-run the whole
 * enrichment behind it (tax cascade, last-inward cost walk, effective cost,
 * loyalty caps). With several thousand products that is the most expensive read
 * in the app, repeated for a catalogue that barely moves.
 *
 * So the browser keeps the catalogue and asks only for what changed:
 *
 *   1. `read()` returns the cached rows synchronously-ish for an instant paint —
 *      the scan bar is usable before the network answers.
 *   2. `sync()` sends `since` + `stamp` + `count`; the server replies with just
 *      the rows touched since, or a full catalogue when it cannot safely diff.
 *   3. Changed rows are merged BY ID and removed ids dropped — a replace, never
 *      arithmetic on a previous value, so a row can never drift out of step with
 *      the database the way an incrementally-adjusted total could.
 *
 * Rows live as REAL ROWS in the shared Dexie database (`localDb`), so a delta
 * writes only the products that actually moved. The previous store held the
 * whole catalogue as one JSON blob under a single key, which meant re-writing
 * several thousand rows to record that one price had changed.
 *
 * Three things a naive "rows newer than X" sync would get wrong, all handled:
 *
 *   • Values that are not on the product row — resolved GST, the barcode tag,
 *     loyalty caps — change without any product's `updatedAt` moving. The server
 *     fingerprints those inputs as `stamp`; a different stamp forces a full load.
 *   • A hard-deleted product simply stops existing, and no timestamp can report
 *     it. The server sends its live `count`; if the merged result does not match,
 *     the cache is dropped and refetched.
 *   • Anything both of those miss (a barcode edited in place, say) is bounded by
 *     MAX_AGE_MS — past that the cache is not trusted at all.
 *
 * Note prices here are what the till bills: `/api/pos/sale` posts the `unitPrice`
 * the browser sends. That is an argument FOR syncing rather than against it — the
 * old load-once-per-mount behaviour left a till showing morning prices all
 * afternoon, whereas a delta is cheap enough to run on every open.
 */

import axios from "axios";
import { localDb, type LocalProductRow } from "@/shared/lib/browser/localDb";

/** The single `productMeta` row holding catalogue-wide sync state. */
const META_KEY = "catalogue";
/** Beyond this the cache is discarded outright, whatever the stamp says. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Rows are passed straight through; callers own the shape beyond these two.
 *  `name` is needed because the merge has to restore the server's ordering. */
type Row = { id: number; name: string };

type SyncResponse<T> =
    | { mode: "full"; products: T[]; computedAt: string; stamp: string; count: number }
    | { mode: "delta"; changed: T[]; removedIds: number[]; computedAt: string; stamp: string; count: number };

/** The server lists by name; restore that so the search dropdown's top matches
 *  are the same rows a full load would have shown. Sorted here rather than by an
 *  IndexedDB index because IndexedDB orders by UTF-16 code unit, which parts
 *  company with `localeCompare` on case and non-ASCII names. */
const byName = (a: Row, b: Row) => a.name.localeCompare(b.name);

async function clearCatalogue(): Promise<void> {
    const db = localDb();
    if (!db) return;
    await db.transaction("rw", db.products, db.productMeta, async () => {
        await db.products.clear();
        await db.productMeta.delete(META_KEY);
    });
}

/** Catalogue sync state, or null when there is nothing usable to build on. */
async function readMeta() {
    const db = localDb();
    if (!db) return null;
    const meta = await db.productMeta.get(META_KEY);
    if (!meta?.computedAt) return null;
    if (Date.now() - new Date(meta.computedAt).getTime() > MAX_AGE_MS) {
        await clearCatalogue();
        return null;
    }
    return meta;
}

async function readRows<T extends Row>(): Promise<T[]> {
    const db = localDb();
    if (!db) return [];
    const rows = (await db.products.toArray()) as T[];
    return rows.sort(byName);
}

/** Cached rows for an immediate first paint, or null when there is nothing usable. */
export async function readCachedProducts<T extends Row>(): Promise<T[] | null> {
    if (!(await readMeta())) return null;
    const rows = await readRows<T>();
    return rows.length > 0 ? rows : null;
}

/**
 * Bring the catalogue up to date and return it. Falls back to a full load
 * whenever the server declines to diff, and to the cached rows if the request
 * fails outright — a till with a slightly old catalogue still sells.
 */
export async function syncProducts<T extends Row>(): Promise<T[] | null> {
    const db = localDb();
    const meta = await readMeta();

    const params: Record<string, string> = { sync: "1" };
    if (meta) {
        params.since = meta.computedAt;
        params.stamp = meta.stamp;
    }

    const res = await request<T>(params);
    if (!res) {
        // Offline / server error — keep selling on whatever is already held.
        if (!meta) return null;
        const held = await readRows<T>();
        return held.length > 0 ? held : null;
    }

    if (res.mode === "full") return await replaceAll<T>(res.products, res);
    if (!meta || !db) return (await reload<T>()) ?? null;   // delta with nothing to apply it to

    await db.transaction("rw", db.products, db.productMeta, async () => {
        if (res.changed.length > 0)    await db.products.bulkPut(res.changed as LocalProductRow[]);
        if (res.removedIds.length > 0) await db.products.bulkDelete(res.removedIds);
        await db.productMeta.put({ key: META_KEY, computedAt: res.computedAt, stamp: res.stamp, count: res.count });
    });

    // A hard-deleted product leaves no trace a timestamp could match, so the row
    // count is the only way to notice one. Disagreement means this cache has
    // silently diverged — throw it away and take the catalogue fresh.
    if (typeof res.count === "number" && (await db.products.count()) !== res.count) {
        await clearCatalogue();
        return (await reload<T>()) ?? null;
    }

    return await readRows<T>();
}

async function request<T extends Row>(params: Record<string, string>): Promise<SyncResponse<T> | null> {
    try {
        return (await axios.get<SyncResponse<T>>("/api/inventory/products/lookup", { params })).data;
    } catch {
        return null;
    }
}

/** Drop whatever is held and seed the catalogue from a full server response. */
async function replaceAll<T extends Row>(
    products: T[],
    meta: { computedAt: string; stamp: string; count: number },
): Promise<T[]> {
    const db = localDb();
    if (!db) return [...products].sort(byName);   // no IndexedDB — serve in-memory
    await db.transaction("rw", db.products, db.productMeta, async () => {
        await db.products.clear();
        await db.products.bulkPut(products as LocalProductRow[]);
        await db.productMeta.put({ key: META_KEY, computedAt: meta.computedAt, stamp: meta.stamp, count: meta.count });
    });
    return await readRows<T>();
}

/** Take the whole catalogue and reseed the cache from it. */
async function reload<T extends Row>(): Promise<T[] | null> {
    const res = await request<T>({ sync: "1" });
    if (!res || res.mode !== "full") return null;
    return await replaceAll<T>(res.products, res);
}
