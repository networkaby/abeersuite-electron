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
 *                       together and shows one merged result list. NOT a full
 *                       replica, unlike `products`: only parties someone has
 *                       actually looked up are here (see `partyCatalog.ts`).
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

/** A party as `/api/person?lookup=…&full=1` shapes it — carries every field the
 *  live lookup can MATCH on, not just the ones it displays, so searching the
 *  cache finds the same rows the server would. */
export type LocalPartyRow = {
    type: PartyType;
    id: number;
    name: string;
    address: string | null;
    /** ALL phones, primary first — the live query matches any of them. */
    phones: string[];
    emails: string[];
    accountId: number | null;
    /** Ledger group name, e.g. "Sundry Debtors" — what party pickers narrow by. */
    accountGroup: string | null;
    /** The group's broader nature — ASSET / LIABILITY / INCOME / EXPENSE.
     *  `accountGroup` narrows to one exact ledger group; this narrows to
     *  everything of that NATURE, for a restriction not tied to one group name
     *  (e.g. "no liability-side parties here", vs "no Sundry Creditors here"). */
    accountGroupType: "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE" | null;
    aliases: string[];
    linkedCompanies: { id: number; name: string; accountId: number | null }[];
    /** When this row was last taken from the server. The backstop that retires a
     *  row no change signal ever reached us about — a hard delete leaves nothing
     *  behind for a timestamp query to report. */
    cachedAt: number;
};

/** Party cache state — a single row, `key: "parties"`. `checkedAt` is the server
 *  clock the next "what changed?" call asks from. */
export type LocalPartyMeta = {
    key: string;
    checkedAt: string;
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

    // The pre-Dexie database is dead weight the moment this one opens. Deleting
    // it is best-effort: it holds only rebuildable caches, so a failure here
    // costs nothing but the disk space it was already using.
    void Dexie.delete(LEGACY_DB_NAME).catch(() => { /* nothing to reclaim */ });

    return db;
}
