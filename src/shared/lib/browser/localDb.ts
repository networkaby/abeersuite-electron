"use client";

/**
 * The counter's local replica — real per-row tables (unlike `idbCache.ts`, which
 * stores one JSON blob per key). This is what a page reads for its instant paint;
 * a delta sync patches it in the background. See `useTicketsDelta.ts` for the
 * first table built on it.
 *
 * COUNTER-ONLY, same as the Day Book cache: a row here is business data (customer
 * name/phone/device), so nothing is written on a machine without the bridge. The
 * database itself is harmless to open anywhere — callers gate the WRITE side on
 * `isBridgeAvailable()`, not the open.
 *
 * One Dexie database, one object store per replicated table, bump `version()`
 * when a table's indexes change (Dexie migrates existing data automatically;
 * indexes only, never a value shape — that stays whatever the server sends).
 */

import Dexie, { type EntityTable } from "dexie";

export type LocalTicketRow = {
    id: number;
    pipelineId: string | null;
    status: string;
    priority: string;
    createdAt: string;
    updatedAt: string;
    /** Everything else the list needs, passed through as the server shaped it. */
    data: Record<string, unknown>;
};

/**
 * One row per distinct FILTER VIEW (pipeline/status/priority/warranty/date
 * combo) — just the id list + pagination cursor for that view. The ticket DATA
 * itself lives once in `tickets`, shared across every view that references it,
 * so two filtered views of the same ticket never duplicate its row.
 */
export type LocalTicketView = {
    key: string;
    ids: number[];
    nextCursor: number | null;
    checkedAt: string;
    savedAt: number;
};

type LocalDb = Dexie & {
    tickets: EntityTable<LocalTicketRow, "id">;
    ticketViews: EntityTable<LocalTicketView, "key">;
};

let db: LocalDb | null = null;

/** Lazily opened — never at module load, so SSR / a machine with IndexedDB
 *  disabled never touches this. */
export function localDb(): LocalDb | null {
    if (typeof indexedDB === "undefined") return null;
    if (db) return db;
    db = new Dexie("abeer-replica") as LocalDb;
    db.version(1).stores({
        // `id` primary key; the rest are the columns views actually filter/sort by.
        tickets:     "id, pipelineId, status, priority, updatedAt",
        ticketViews: "key, savedAt",
    });
    return db;
}
