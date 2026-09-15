"use client";

/**
 * The browser's local database — ONE Dexie database for everything this app
 * keeps on disk. It replaces the old hand-rolled `idbCache.ts` (a single
 * key→JSON-blob store), which could only ever rewrite a whole collection to
 * change one row and had no indexes to query by.
 *
 * What lives here, and why each shape:
 *
 *   • `products`      — the POS catalogue, a genuine full replica. Real rows, so
 *                       a delta writes only the products that changed instead of
 *                       re-serialising several thousand.
 *   • `masters`       — brands / categories / groups / units in one store, keyed
 *                       by [type+id]. They share a table because they share a
 *                       lifecycle (tiny, rarely edited, synced together in one
 *                       request) — four stores would be four of everything for
 *                       no gain.
 *   • `tickets`       — every Ticket-flavoured row (repair, deal, help, admin
 *                       task — all the same `Ticket` model, one Dexie table),
 *                       real rows keyed by id and shared across every board's
 *                       filter views. See `useTicketsDelta`.
 *   • `ticketViews` / — one row per BOARD/FILTER VIEW: the id list + cursor +
 *     `dayBookViews`    sync watermark for that view, namespaced by which API
 *                       it came from so Deals' view can't collide with Help's.
 *                       Splitting the index off the data is what lets two
 *                       views hold the same ticket once.
 *
 * All trusted machines (any that can log in) may cache business data locally.
 * The login gate (auth:login:outside-counter) ensures only authorised machines
 * reach this code. `products` and `masters` are always available: a price list
 * and a set of brand names are configuration, not business records. Opening
 * the database is harmless anywhere; only writing is gated by the caller.
 *
 * Bump `version()` when a table's indexes change. Everything in here is
 * rebuildable from the server, so an upgrade may simply clear a table rather
 * than migrate it.
 *
 * Parties are NOT here. They live in their own database (`parties/partyCatalog`)
 * because they are the one cache held on every machine, replica-served counter
 * included — the search needs the whole list to be honest about what it found,
 * which is a different bargain from everything below. Keeping them apart is what
 * lets that rule and the one in the next paragraph both be true.
 *
 * OFF ENTIRELY ON A REPLICA-SERVED COUNTER. Every module here is a DELTA cache:
 * it keeps rows and next asks the server only for what changed since a
 * remembered `computedAt`. On a counter serving its screens from its own
 * PostgreSQL replica, `parseSince()` (see prisma/counterMode.ts) already ignores
 * that stamp and answers in full — the replica is on the same PC, so a full read
 * costs nothing. So this tier saves that machine nothing, and the stamps it
 * writes are exactly what went wrong on 2026-09-07: a board stamped its view
 * with the replica's clock, which runs seconds behind the row's real
 * `updatedAt`, and then asked for changes after a moment the row could never
 * pass. `localDb()` therefore returns null there, and every caller already
 * treats null as "no cache" and simply fetches in full. See `setServedByReplica`.
 */

import Dexie, { type EntityTable } from "dexie";

/** Pre-Dexie database (one JSON blob per key). Removed on first open. */
const LEGACY_DB_NAME = "abeer-cache";
const DB_NAME = "abeer-replica";

/** Where the last `/api/counter/status` answer to "does this machine serve its
 *  screens from its own replica?" is remembered. See `setServedByReplica`. */
const SERVED_KEY = "abeer.served-by-replica";

/** A product row exactly as `/api/inventory/products/lookup` shapes it. */
export type LocalProductRow = { id: number; name: string } & Record<string, unknown>;

/** Catalogue-wide sync state — a single row, `key: "catalogue"`. */
export type LocalProductMeta = {
    key: string;
    computedAt: string;
    /** Server fingerprint of everything the enrichment depends on. */
    stamp: string;
    /** Live server row count — how a hard delete is noticed at all. */
    count: number;
};

/** Which inventory lookup table a `masters` row belongs to. */
export type MasterType = "brands" | "categories" | "groups" | "units";

/** A lookup row, tagged with its table. Compound-keyed on [type+id].
 *  No `name` in the contract: units carry `code` + `label` instead. */
export type LocalMasterRow = {
    type: MasterType;
    id: number;
} & Record<string, unknown>;

/** Masters-wide sync state — a single row, `key: "masters"`. */
export type LocalMasterMeta = {
    key: string;
    computedAt: string;
    /** Live server row count per table — how a hard delete is noticed at all. */
    counts: Record<MasterType, number>;
};

/** A ticket row exactly as `/api/tickets` shapes it (repair detail flattened). */
export type LocalTicketRow = {
    id: number;
    pipelineId: string | null;
    status: string;
    priority: string;
    createdAt: string;
    updatedAt: string;
} & Record<string, unknown>;

/**
 * One cached filter view: which rows it holds, where its next page starts, and
 * the server clock to send as the next `since`.
 */
export type LocalView<TId> = {
    key: string;
    ids: TId[];
    nextCursor: number | null;
    checkedAt: string;
    savedAt: number;
};

/**
 * The Day Book keeps whole rows rather than ids: its rows are normalised
 * (ids + a shared `refs` map) and are not shared between views the way tickets
 * are, so there is nothing to gain by splitting them out.
 */
export type LocalDayBookView = {
    key: string;
    /** `Store` from useDayBook — rows + refs + nextCursor + checkedAt. */
    store: unknown;
    savedAt: number;
};

type LocalDb = Dexie & {
    products:     EntityTable<LocalProductRow, "id">;
    productMeta:  EntityTable<LocalProductMeta, "key">;
    /** Compound-keyed on [type+id], so it has no single `id` property key. */
    masters:      Dexie.Table<LocalMasterRow, [MasterType, number]>;
    masterMeta:   EntityTable<LocalMasterMeta, "key">;
    tickets:      EntityTable<LocalTicketRow, "id">;
    ticketViews:  EntityTable<LocalView<number>, "key">;
    dayBookViews: EntityTable<LocalDayBookView, "key">;
};

let db: LocalDb | null = null;

/**
 * Whether this machine serves its screens from its own replica — read ONCE and
 * then frozen for the life of the document.
 *
 * Frozen on purpose. Callers memoise on top of `localDb()`: `partyCatalog` keeps
 * a module-level "is the cache open?" boolean and an in-memory row map, and one
 * `syncProducts()` calls this three separate times. A value that changed
 * half-way through a page would hand out a real database early and null later,
 * which is worse than either answer on its own. So an answer that arrives while
 * a page is open is remembered for the NEXT load and never applied to this one.
 */
let servedFrozen: boolean | undefined;

/** Whether this document has already thrown away what the cache held. Once. */
let discarded = false;

/** Whether this machine serves its screens from its own replica (frozen per document). */
export function servedByReplica(): boolean {
    if (servedFrozen === undefined) {
        try {
            servedFrozen = localStorage.getItem(SERVED_KEY) === "1";
        } catch {
            // A profile with site data switched off. Treat it as an ordinary
            // browser: the cache then simply never opens, one line below.
            servedFrozen = false;
        }
    }
    return servedFrozen;
}

/**
 * Record where this machine's screens are served from, so the NEXT page load
 * knows before it asks. Called by `useCounterMode` on every status answer.
 *
 * On the change into replica-served, the rows and stamps already on disk are
 * cleared: they were written against a different clock, and leaving them for a
 * later `READ_MODE=live` revert to revive is the staleness bug all over again.
 *
 * Cleared, not closed and not deleted. Callers hold the database handle across
 * an await and then use it without a try/catch, so closing under them throws
 * `DatabaseClosedError` on whatever screen is mid-sync; and `Dexie.delete` on an
 * open database waits for every tab and window to let go, which may be never.
 */
export function setServedByReplica(served: boolean): void {
    try {
        localStorage.setItem(SERVED_KEY, served ? "1" : "0");
    } catch {
        // Nothing to remember on, so every load starts as an ordinary browser.
    }
    if (!served || discarded) return;

    // Read back AFTER the write, deliberately. If nothing has opened the cache yet
    // on this page, this freezes the NEW answer and the cache never opens here at
    // all — safe, because no handle has been handed out, and the next `localDb()`
    // deletes what is on disk. If something already opened it, the frozen value is
    // still the old `false` and we fall through to empty what it holds, leaving the
    // handle itself valid for whoever is mid-sync.
    if (servedByReplica() || !db) return;
    discarded = true;
    void Promise.all(db.tables.map((t) => t.clear())).catch(() => {
        /* best effort — everything in here refills from the server anyway */
    });
}

/**
 * Lazily opened — never at module load, so SSR and a browser with IndexedDB
 * switched off (private mode, locked-down profile) never touch it. Returns null
 * there, and every caller treats null as "no cache", which just means it fetches
 * in full exactly as it would have without any of this.
 */
export function localDb(): LocalDb | null {
    if (typeof indexedDB === "undefined") return null;

    // Ahead of the `db` memo below, which is safe precisely because the answer is
    // frozen: true now means true on every earlier call in this document, so no
    // handle was ever handed out and nothing is holding the database open.
    if (servedByReplica()) {
        if (!discarded) {
            discarded = true;
            void Dexie.delete(DB_NAME).catch(() => { /* nothing to reclaim */ });
        }
        return null;
    }

    if (db) return db;

    db = new Dexie(DB_NAME) as LocalDb;

    db.version(1).stores({
        tickets:     "id, pipelineId, status, priority, updatedAt",
        ticketViews: "key, savedAt",
    });

    db.version(2)
        .stores({
            tickets:      "id, pipelineId, status, priority, updatedAt",
            ticketViews:  "key, savedAt",
            products:     "id, name",
            productMeta:  "key",
            masters:      "[type+id], type",
            masterMeta:   "key",
            // `name` and `accountId` indexed for prefix search and for resolving
            // a picked ledger back to its party; phones/aliases are arrays and
            // are scanned in memory (the list is small enough, and IndexedDB
            // multi-entry indexes cannot do the `contains` these searches need).
            parties:      "[type+id], type, name, accountId",
            partyMeta:    "key",
            dayBookViews: "key, savedAt",
        })
        .upgrade(async (tx) => {
            // v1 wrapped each ticket as { …scalars, data: row }; v2 stores the row
            // itself. Rather than unwrap, drop them — they refetch on next open.
            await tx.table("tickets").clear();
            await tx.table("ticketViews").clear();
        });

    // v3 changed what a party row means: v2 held a FULL replica of every party,
    // topped up by delta; v3 holds only the ones someone looked up, and carries
    // `cachedAt` to retire them. The meta row changed shape with it. Neither can
    // be migrated into the other, and both refill on demand — so drop them.
    db.version(3)
        .stores({
            tickets:      "id, pipelineId, status, priority, updatedAt",
            ticketViews:  "key, savedAt",
            products:     "id, name",
            productMeta:  "key",
            masters:      "[type+id], type",
            masterMeta:   "key",
            parties:      "[type+id], type, name, accountId",
            partyMeta:    "key",
            dayBookViews: "key, savedAt",
        })
        .upgrade(async (tx) => {
            await tx.table("parties").clear();
            await tx.table("partyMeta").clear();
        });

    // v4 added `accountGroupType` to the party row. A row cached before this
    // simply lacks the field rather than carrying a wrong value, which is
    // harmless for search but WRONG for anything filtering by it — clear rather
    // than let a type-restricted picker silently under-filter until every row
    // happens to get re-cached.
    db.version(4)
        .stores({
            tickets:      "id, pipelineId, status, priority, updatedAt",
            ticketViews:  "key, savedAt",
            products:     "id, name",
            productMeta:  "key",
            masters:      "[type+id], type",
            masterMeta:   "key",
            parties:      "[type+id], type, name, accountId",
            partyMeta:    "key",
            dayBookViews: "key, savedAt",
        })
        .upgrade(async (tx) => {
            await tx.table("parties").clear();
            await tx.table("partyMeta").clear();
        });

    // v5 moved parties out of this database entirely, into their own
    // (`parties/partyCatalog`): they are now a FULL list held on every machine —
    // this one included — rather than a grow-on-search cache switched off on a
    // till. Dropping the stores here is what stops the old partial rows being
    // mistaken for the list.
    db.version(5).stores({ parties: null, partyMeta: null });

    // The pre-Dexie database is dead weight the moment this one opens. Deleting
    // it is best-effort: it holds only rebuildable caches, so a failure here
    // costs nothing but the disk space it was already using.
    void Dexie.delete(LEGACY_DB_NAME).catch(() => { /* nothing to reclaim */ });

    return db;
}
