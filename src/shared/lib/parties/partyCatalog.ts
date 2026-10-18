"use client";

/**
 * The whole party list — held in memory, searched there, kept current by delta.
 *
 * WHY THE WHOLE LIST. A cashier does not run a query. They half-remember
 * something — a piece of the name, the locality — and they ask for the mobile.
 * Answering that needs the tiered match: splitting "medhidura" into a name and a
 * locality, forgiving a typo, ranking a word-start above a mid-word. None of it
 * can be expressed as a SQL `contains`, so none of it survives a per-keystroke
 * endpoint. Holding the list is what buys it.
 *
 * It is also the only shape that cannot lie. Ranking is honest only over a
 * COMPLETE pool: there "nothing matched" is a fact about the whole list and a
 * guess is a real suggestion, where over a partial pool both are artefacts. The
 * two ways this was done before each ranked something smaller than the list, and
 * each hid real customers — a browser cache grown only from past searches, which
 * padded a miss with letter-pair guesses and then treated its own eight rows as a
 * full page and never asked the server; and a server lookup that cut to the eight
 * NEWEST matches before it ranked, so an older customer could never be ranked
 * back in. Both are gone.
 *
 * ONE PATH, BOTH MACHINES. The list comes from `/api/parties/catalog?sync=1`,
 * which on the web reads the live database and on a counter reads that machine's
 * own PostgreSQL replica — same code, same request, and on a counter no Supabase
 * bill at all, since every table it touches is in prisma/sync-tables.json.
 * ~3,500 parties: about a megabyte once, then deltas.
 *
 * ITS OWN DEXIE DATABASE, on purpose. `browser/localDb` deliberately throws its
 * cache away on a replica-served till — right for a delta cache whose remembered
 * stamps fight the replica's clock, and four other caches depend on it. This list
 * wants the opposite: it is held EVERYWHERE, because holding it is what makes the
 * search work rather than what makes it faster. A separate database is what lets
 * both rules be true at once without either module knowing about the other.
 *
 * STAYING CURRENT. `since` asks only for what moved. A party that was deactivated
 * or hard-deleted comes back in `removedKeys`, and `count` is the backstop for a
 * delete no timestamp could report — when the merged total disagrees, the whole
 * list is refetched rather than trusted. All of which rests on Person/Company
 * `updatedAt` moving whenever anything the row is FOUND BY changes, phone numbers
 * included: see `contactWrite.ts`, which bumps the parent for exactly this reason.
 */

import Dexie, { type EntityTable } from "dexie";
import axios from "axios";
import { create } from "zustand";

/** Person / Company discriminator, as every consumer already spells it. */
export type PartyType = "customer" | "company";

/**
 * A party as the catalogue ships it — every field the search can MATCH on, not
 * only the ones a row displays. A list carrying just the primary phone would
 * quietly stop finding customers who answer on their second one.
 */
export type Party = {
    type: PartyType;
    id: number;
    name: string;
    address: string | null;
    /** ALL phones, primary first. */
    phones: string[];
    emails: string[];
    accountId: number | null;
    /** Ledger group name, e.g. "Sundry Debtors" — what party pickers narrow by. */
    accountGroup: string | null;
    /** The group's broader nature — for a restriction not tied to one group name
     *  ("no liability-side parties here", vs "no Sundry Creditors here"). */
    accountGroupType: "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE" | null;
    aliases: string[];
    linkedCompanies: { id: number; name: string; accountId: number | null }[];
};

type PartyMeta = { key: string; checkedAt: string };

type PartyDb = Dexie & {
    parties: Dexie.Table<Party, [PartyType, number]>;
    partyMeta: EntityTable<PartyMeta, "key">;
};

const DB_NAME = "abeer-parties";
const META_KEY = "parties";

/** Past this the held list is not trusted at all, whatever a delta would say —
 *  the backstop for a machine that was off while the shop carried on. */
const MAX_AGE_MS = 15 * 24 * 60 * 60 * 1000;   // in step with the server's MAX_DELTA_WINDOW_MS

const URL = "/api/parties/catalog?sync=1";

type SyncResponse =
    | { mode: "full"; parties: Party[]; computedAt: string; count: number }
    | { mode: "delta"; changed: Party[]; removedKeys: string[]; computedAt: string; count: number };

const keyOf = (type: PartyType, id: number) => `${type}:${id}`;

let db: PartyDb | null = null;

/** Lazily opened — never at module load, so SSR and a browser with IndexedDB
 *  switched off never touch it. Null there, and the list simply lives in memory
 *  for the life of the tab and is fetched again on the next load. */
function partyDb(): PartyDb | null {
    if (typeof indexedDB === "undefined") return null;
    if (db) return db;
    db = new Dexie(DB_NAME) as PartyDb;
    db.version(1).stores({
        // `name` and `accountId` indexed for resolving a picked ledger back to
        // its party; phones and aliases are arrays, scanned in memory.
        parties: "[type+id], type, name, accountId",
        partyMeta: "key",
    });
    return db;
}

// ── The shared store ──────────────────────────────────────────────────────────
//
// One list per tab, however many pickers are mounted. `ready` is false only while
// the very first load is still in flight; after that the list is always
// answerable, even offline, from what is held.

type Store = { parties: Party[]; ready: boolean; set: (parties: Party[]) => void };

const useStore = create<Store>((set) => ({
    parties: [],
    ready: false,
    set: (parties) => set({ parties, ready: true }),
}));

/** Subscribe a component to the list. Used by the hooks that bind to it. */
export const usePartyStore = useStore;

/** The list right now, without subscribing — for callers outside React. */
export function partyList(): Party[] {
    return useStore.getState().parties;
}

function publish(parties: Party[]): Party[] {
    useStore.getState().set(parties);
    return parties;
}

async function readMeta(): Promise<string | null> {
    const database = partyDb();
    if (!database) return null;
    const meta = await database.partyMeta.get(META_KEY);
    if (!meta?.checkedAt) return null;
    if (Date.now() - new Date(meta.checkedAt).getTime() > MAX_AGE_MS) return null;
    return meta.checkedAt;
}

async function replaceAll(parties: Party[], computedAt: string): Promise<Party[]> {
    const database = partyDb();
    if (database) {
        await database.transaction("rw", database.parties, database.partyMeta, async () => {
            await database.parties.clear();
            await database.parties.bulkPut(parties);
            await database.partyMeta.put({ key: META_KEY, checkedAt: computedAt });
        });
    }
    return publish(parties);
}

/**
 * Bring the list up to date and publish it.
 *
 * Held rows are painted FIRST, before the request — so a reload shows a working
 * search box immediately and the delta lands under it a moment later. A delta
 * merges BY KEY and drops what was removed: a replace, never arithmetic on a
 * previous value, so a row cannot drift out of step with the database.
 *
 * Never throws. Offline, what is held stands — a slightly stale list still bills,
 * and a blank search box does not.
 */
async function sync(): Promise<Party[]> {
    const database = partyDb();
    const held = database ? await database.parties.toArray() : [];
    const since = held.length > 0 ? await readMeta() : null;
    if (held.length > 0) publish(held);

    let res: SyncResponse;
    try {
        res = (await axios.get<SyncResponse>(URL + (since ? `&since=${encodeURIComponent(since)}` : ""))).data;
    } catch {
        // `ready` flips either way: an empty list with no server is still a
        // settled answer, not a spinner that never ends.
        return publish(held);
    }

    if (res.mode === "full") return await replaceAll(res.parties, res.computedAt);

    const byKey = new Map(held.map((p) => [keyOf(p.type, p.id), p]));
    for (const k of res.removedKeys) byKey.delete(k);
    for (const row of res.changed) byKey.set(keyOf(row.type, row.id), row);
    const merged = [...byKey.values()];

    // The count is the only thing that can report a hard delete, which leaves no
    // row behind for a timestamp query to find. Disagreement means something moved
    // that no delta could describe, so start over rather than trust it.
    if (merged.length !== res.count) {
        const full = (await axios.get<SyncResponse>(URL)).data;
        return full.mode === "full" ? await replaceAll(full.parties, full.computedAt) : publish(merged);
    }

    if (database) {
        await database.transaction("rw", database.parties, database.partyMeta, async () => {
            if (res.removedKeys.length > 0) {
                await database.parties.bulkDelete(
                    res.removedKeys.map((k) => {
                        const [type, id] = k.split(":");
                        return [type, Number(id)] as [PartyType, number];
                    }),
                );
            }
            await database.parties.bulkPut(res.changed);
            await database.partyMeta.put({ key: META_KEY, checkedAt: res.computedAt });
        });
    }
    return publish(merged);
}

let inFlight: Promise<Party[]> | null = null;
let lastSyncedAt = 0;

/**
 * How long a freshly synced list is taken on trust before a MOUNT asks again.
 *
 * Every party picker asks on mount, and the app has a lot of them — a voucher
 * form carries three, and moving between screens would otherwise be a delta plus
 * two COUNTs per navigation, for a list that a realtime signal already keeps
 * current. This only ever throttles the speculative mount-time read: a change
 * signal and a write both pass `force` and are never delayed.
 */
const MIN_RESYNC_MS = 30_000;

/**
 * Load or refresh the list, shared between every caller.
 *
 * Deduped two ways: concurrent callers share one request, and a mount that
 * arrives just after a sync is answered from memory (see `MIN_RESYNC_MS`).
 * `force` skips the second — use it whenever something is known to have changed.
 */
export function loadPartyList(opts: { force?: boolean } = {}): Promise<Party[]> {
    if (inFlight) return inFlight;
    if (!opts.force && lastSyncedAt > 0 && Date.now() - lastSyncedAt < MIN_RESYNC_MS) {
        return Promise.resolve(partyList());
    }
    inFlight = sync()
        // Never rejects. Every caller fires this and walks away (`void`), so a
        // rejection would be an unhandled one — and worse, `ready` would stay
        // false and the box would spin for the rest of the shift. Whatever is
        // held is published instead, which settles the list and is the honest
        // answer: this is what we know.
        .catch(() => publish(partyList()))
        // Stamped even on failure, deliberately: offline, this is what stops
        // every mount retrying a request that cannot succeed.
        .finally(() => { lastSyncedAt = Date.now(); inFlight = null; });
    return inFlight;
}

/** Startup warm-up: fill the list before anyone types. Never throws. */
export function warmPartyList(): void {
    void loadPartyList();
}

/**
 * Re-read the list now — after creating or editing a party, so the next search
 * cannot be answered with the row as it was.
 *
 * A refresh, not a wipe. The delta is one small request and the box keeps working
 * throughout; emptying it first would blank the search for a round trip, on the
 * one screen where someone has just proved they are mid-task.
 */
export async function invalidateParties(): Promise<Party[]> {
    // Wait out a sync that is ALREADY running before starting one. It may have
    // read the database before the party we have just written existed, so
    // joining it would answer with a list that cannot contain them — and the
    // one moment someone is guaranteed to search for that party is now.
    if (inFlight) await inFlight.catch(() => { /* its own catch already published */ });
    return loadPartyList({ force: true });
}

/**
 * The list's answer to "what is on the list", not "who matches this text" — what
 * a directory panel paints before its own live page arrives, and what a party box
 * shows on focus before anything is typed.
 *
 * Name-sorted: the one order this and the server agree on without disagreement
 * risk, and the default view of every list that asks.
 */
export function browseParties(
    parties: readonly Party[],
    opts: { type?: PartyType; group?: string; excludeAccountGroup?: string; limit: number },
): Party[] {
    const hits = parties.filter((p) =>
        (!opts.type || p.type === opts.type)
        && (!opts.group || p.accountGroup === opts.group)
        && (!opts.excludeAccountGroup || p.accountGroup !== opts.excludeAccountGroup),
    );
    hits.sort((a, b) => a.name.localeCompare(b.name));
    return hits.slice(0, opts.limit);
}
