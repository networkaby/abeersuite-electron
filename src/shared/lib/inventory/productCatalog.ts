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
import { idbGet, idbSet, idbDelete } from "@/shared/lib/browser/idbCache";

const CACHE_KEY = "pos-product-catalog:v1";
/** Beyond this the cache is discarded outright, whatever the stamp says. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Rows are passed straight through; callers own the shape beyond these two.
 *  `name` is needed because the merge has to restore the server's ordering. */
type Row = { id: number; name: string };

type Cached<T> = { rows: T[]; computedAt: string; stamp: string; count: number };

type SyncResponse<T> =
    | { mode: "full"; products: T[]; computedAt: string; stamp: string; count: number }
    | { mode: "delta"; changed: T[]; removedIds: number[]; computedAt: string; stamp: string; count: number };

async function readCache<T extends Row>(): Promise<Cached<T> | null> {
    const hit = await idbGet<Cached<T>>(CACHE_KEY);
    if (!hit?.computedAt || !Array.isArray(hit.rows)) return null;
    if (Date.now() - new Date(hit.computedAt).getTime() > MAX_AGE_MS) {
        await idbDelete(CACHE_KEY);
        return null;
    }
    return hit;
}

/** Cached rows for an immediate first paint, or null when there is nothing usable. */
export async function readCachedProducts<T extends Row>(): Promise<T[] | null> {
    return (await readCache<T>())?.rows ?? null;
}

/**
 * Bring the catalogue up to date and return it. Falls back to a full load
 * whenever the server declines to diff, and to the cached rows if the request
 * fails outright — a till with a slightly old catalogue still sells.
 */
export async function syncProducts<T extends Row>(): Promise<T[] | null> {
    const cached = await readCache<T>();

    const params: Record<string, string> = { sync: "1" };
    if (cached) {
        params.since = cached.computedAt;
        params.stamp = cached.stamp;
    }

    const res = await request<T>(params);
    if (!res) return cached?.rows ?? null;      // offline / server error — keep selling

    let rows: T[];
    if (res.mode === "full") {
        rows = res.products;
    } else if (cached) {
        const byId = new Map(cached.rows.map((r) => [r.id, r]));
        for (const r of res.changed) byId.set(r.id, r);
        for (const id of res.removedIds) byId.delete(id);
        // The server lists by name; restore that so the search dropdown's top
        // matches are the same rows a full load would have shown.
        rows = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
    } else {
        return (await reload<T>()) ?? null;      // delta with nothing to apply it to
    }

    // A hard-deleted product leaves no trace a timestamp could match, so the row
    // count is the only way to notice one. Disagreement means this cache has
    // silently diverged — throw it away and take the catalogue fresh.
    if (typeof res.count === "number" && rows.length !== res.count) {
        await idbDelete(CACHE_KEY);
        return res.mode === "delta" ? ((await reload<T>()) ?? null) : rows;
    }

    await idbSet<Cached<T>>(CACHE_KEY, {
        rows,
        computedAt: res.computedAt,
        stamp: res.stamp,
        count: res.count,
    });
    return rows;
}

async function request<T extends Row>(params: Record<string, string>): Promise<SyncResponse<T> | null> {
    try {
        return (await axios.get<SyncResponse<T>>("/api/inventory/products/lookup", { params })).data;
    } catch {
        return null;
    }
}

/** Take the whole catalogue and reseed the cache from it. */
async function reload<T extends Row>(): Promise<T[] | null> {
    const res = await request<T>({ sync: "1" });
    if (!res || res.mode !== "full") return null;
    await idbSet<Cached<T>>(CACHE_KEY, {
        rows: res.products,
        computedAt: res.computedAt,
        stamp: res.stamp,
        count: res.count,
    });
    return res.products;
}
