"use client";

/**
 * The inventory lookup tables — brands, categories, product groups, units —
 * held in the browser and topped up by delta.
 *
 * These four fill the dropdowns on nearly every voucher form, product dialog and
 * picker in the app. They are read constantly and edited a handful of times a
 * year, which is the worst possible ratio to be re-fetching whole: four
 * unconditional GETs per surface, each re-sending a list that had not moved.
 *
 * So the browser keeps them and asks only what changed:
 *
 *   1. `readCachedMasters()` returns what is held, for an instant first paint.
 *   2. `syncMasters()` sends `since`; the server replies with only the rows
 *      touched since — on a normal day, four empty arrays.
 *   3. Changed rows are merged BY [type+id]; a table whose count disagrees with
 *      the server's is dropped and refetched whole.
 *
 * Why the count check: a deleted brand simply stops existing, and no `updatedAt`
 * can report its absence. The server sends each table's live row count, and a
 * mismatch is the only way the client can notice one went missing.
 *
 * UNGATED, unlike tickets and the Day Book. These tables are configuration —
 * brand and unit names — not business data, so the counter-only rule that keeps
 * customer and voucher rows off a random machine does not apply to them.
 */

import axios from "axios";
import { localDb, type LocalMasterRow, type MasterType } from "@/shared/lib/browser/localDb";

const API = "/api/inventory/masters/sync";
const META_KEY = "masters";
/** Beyond this the cache is discarded outright — the backstop for anything the
 *  timestamp and count checks between them still miss. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const TYPES: MasterType[] = ["brands", "categories", "groups", "units"];

export type MasterRow = { id: number } & Record<string, unknown>;
export type Masters = Record<MasterType, MasterRow[]>;

const EMPTY: Masters = { brands: [], categories: [], groups: [], units: [] };

type SyncResponse = {
    mode: "full" | "delta";
    computedAt: string;
    tables: Record<MasterType, MasterRow[]>;
    counts: Record<MasterType, number>;
};

/** What each table is listed by, matching the server's `orderBy`. Units are the
 *  odd one out: no `name`, keyed by `code` ("KG") with a separate `label`. */
const SORT_FIELD: Record<MasterType, string> = {
    brands: "name", categories: "name", groups: "name", units: "code",
};

/** Sorted client-side rather than by an IndexedDB index because IndexedDB
 *  orders by UTF-16 code unit, which parts company with `localeCompare` on case
 *  and non-ASCII names. */
const sortBy = (type: MasterType) => (a: MasterRow, b: MasterRow) =>
    String(a[SORT_FIELD[type]] ?? "").localeCompare(String(b[SORT_FIELD[type]] ?? ""));

async function clearAll(): Promise<void> {
    const db = localDb();
    if (!db) return;
    await db.transaction("rw", db.masters, db.masterMeta, async () => {
        await db.masters.clear();
        await db.masterMeta.delete(META_KEY);
    });
}

/** Sync state, or null when there is nothing usable to build on. */
async function readMeta() {
    const db = localDb();
    if (!db) return null;
    const meta = await db.masterMeta.get(META_KEY);
    if (!meta?.computedAt) return null;
    if (Date.now() - new Date(meta.computedAt).getTime() > MAX_AGE_MS) {
        await clearAll();
        return null;
    }
    return meta;
}

async function readTables(): Promise<Masters> {
    const db = localDb();
    if (!db) return { ...EMPTY };
    const all = await db.masters.toArray();
    const out: Masters = { brands: [], categories: [], groups: [], units: [] };
    for (const row of all) {
        // `type` is the store's tag, not part of the row the caller asked for.
        const { type, ...rest } = row;
        out[type]?.push(rest as MasterRow);
    }
    for (const t of TYPES) out[t].sort(sortBy(t));
    return out;
}

/** What is already held, or null when there is nothing usable. */
export async function readCachedMasters(): Promise<Masters | null> {
    if (!(await readMeta())) return null;
    const tables = await readTables();
    return TYPES.some((t) => tables[t].length > 0) ? tables : null;
}

/**
 * Bring the lookup tables up to date and return them. Falls back to what is
 * held if the request fails outright — a slightly old brand list still fills a
 * dropdown.
 */
export async function syncMasters(): Promise<Masters | null> {
    const db = localDb();
    const meta = await readMeta();

    let res: SyncResponse | null;
    try {
        res = (await axios.get<SyncResponse>(API, {
            params: meta ? { since: meta.computedAt } : {},
        })).data;
    } catch {
        res = null;
    }

    if (!res) {
        if (!meta) return null;
        const held = await readTables();
        return TYPES.some((t) => held[t].length > 0) ? held : null;
    }

    // No IndexedDB (private mode, locked-down profile) — serve straight through.
    if (!db) {
        if (res.mode !== "full") return null;
        const out: Masters = { ...EMPTY };
        for (const t of TYPES) out[t] = [...(res.tables[t] ?? [])].sort(sortBy(t));
        return out;
    }

    await db.transaction("rw", db.masters, db.masterMeta, async () => {
        if (res!.mode === "full") await db.masters.clear();
        const rows: LocalMasterRow[] = [];
        for (const type of TYPES) {
            for (const row of res!.tables[type] ?? []) rows.push({ ...row, type } as LocalMasterRow);
        }
        if (rows.length > 0) await db.masters.bulkPut(rows);
        await db.masterMeta.put({ key: META_KEY, computedAt: res!.computedAt, counts: res!.counts });
    });

    // A hard-deleted row leaves no trace a timestamp could match, so the count is
    // the only way to notice one. Disagreement means this table has silently
    // diverged — throw the lot away and take it fresh.
    for (const type of TYPES) {
        const held = await db.masters.where("type").equals(type).count();
        if (typeof res.counts[type] === "number" && held !== res.counts[type]) {
            await clearAll();
            return await reload();
        }
    }

    return await readTables();
}

/** Take every table whole and reseed from it. */
async function reload(): Promise<Masters | null> {
    try {
        const res = (await axios.get<SyncResponse>(API)).data;
        const db = localDb();
        if (!db) {
            const out: Masters = { ...EMPTY };
            for (const t of TYPES) out[t] = [...(res.tables[t] ?? [])].sort(sortBy(t));
            return out;
        }
        await db.transaction("rw", db.masters, db.masterMeta, async () => {
            await db.masters.clear();
            const rows: LocalMasterRow[] = [];
            for (const type of TYPES) {
                for (const row of res.tables[type] ?? []) rows.push({ ...row, type } as LocalMasterRow);
            }
            if (rows.length > 0) await db.masters.bulkPut(rows);
            await db.masterMeta.put({ key: META_KEY, computedAt: res.computedAt, counts: res.counts });
        });
        return await readTables();
    } catch {
        return null;
    }
}

/** Drop the held copy — call after creating or editing a master so the next
 *  read sees the change immediately rather than waiting for a delta. */
export async function invalidateMasters(): Promise<void> {
    await clearAll();
}
