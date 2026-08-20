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
 *   • `parties`       — customers and companies, keyed by [type+id]. One store
 *                       rather than two because every consumer searches them
 *                       together and shows one merged result list.
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
 * COUNTER-ONLY, for the stores that hold business data. Ticket, Day Book and
 * party rows carry customer names, phones, devices and the books, so their
 * callers gate every WRITE on `isBridgeAvailable()` — a managed shop machine
 * keeps a copy, a random laptop keeps nothing. `products` and `masters` are
 * ungated: a price list and a set of brand names are configuration, not
 * business records. Opening the database is harmless anywhere; only writing is
 * gated.
 *
 * Bump `version()` when a table's indexes change. Everything in here is
 * rebuildable from the server, so an upgrade may simply clear a table rather
 * than migrate it.
 */

import Dexie, { type EntityTable } from "dexie";

/** Pre-Dexie database (one JSON blob per key). Removed on first open. */
const LEGACY_DB_NAME = "abeer-cache";

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

/** Person / Company discriminator, as every existing consumer already spells it. */
export type PartyType = "customer" | "company";

/** A party as `/api/parties/sync` shapes it — carries every field the live
 *  lookup can match on, so a local search returns the same rows. */
export type LocalPartyRow = {
    type: PartyType;
    id: number;
    name: string;
    isActive: boolean;
    address: string | null;
    /** ALL phones, primary first — the live query matches any of them. */
    phones: string[];
    emails: string[];
    accountId: number | null;
    /** Ledger group name, e.g. "Sundry Debtors" — what party pickers narrow by. */
    accountGroup: string | null;
    aliases: string[];
    linkedCompanies: { id: number; name: string; accountId: number | null }[];
    updatedAt: string;
};

/** Party-wide sync state — a single row, `key: "parties"`. */
export type LocalPartyMeta = {
    key: string;
    computedAt: string;
    /** Live ACTIVE row count per type — how a hard delete is noticed at all. */
    counts: Record<PartyType, number>;
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
    parties:      Dexie.Table<LocalPartyRow, [PartyType, number]>;
    partyMeta:    EntityTable<LocalPartyMeta, "key">;
    tickets:      EntityTable<LocalTicketRow, "id">;
    ticketViews:  EntityTable<LocalView<number>, "key">;
    dayBookViews: EntityTable<LocalDayBookView, "key">;
};

let db: LocalDb | null = null;

/**
 * Lazily opened — never at module load, so SSR and a browser with IndexedDB
 * switched off (private mode, locked-down profile) never touch it. Returns null
 * there, and every caller treats null as "no cache", which just means it fetches
 * in full exactly as it would have without any of this.
 */
export function localDb(): LocalDb | null {
    if (typeof indexedDB === "undefined") return null;
    if (db) return db;

    db = new Dexie("abeer-replica") as LocalDb;

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

    // The pre-Dexie database is dead weight the moment this one opens. Deleting
    // it is best-effort: it holds only rebuildable caches, so a failure here
    // costs nothing but the disk space it was already using.
    void Dexie.delete(LEGACY_DB_NAME).catch(() => { /* nothing to reclaim */ });

    return db;
}
