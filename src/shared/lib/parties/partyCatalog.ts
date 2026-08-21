"use client";

/**
 * Customers and companies this counter has actually dealt with, kept to hand.
 *
 * A sale searches for products ten times and for the customer once, so the two
 * caches are built to different shapes. The product catalogue is a full replica
 * — every product, synced whole, because any of them can be scanned next. Parties
 * are the opposite: a shop has thousands of customers and bills the same tenth of
 * them over and over. Holding all of them to serve the regulars means paying for
 * the whole customer table, repeatedly, to answer questions about a fraction of
 * it.
 *
 * So this cache is GROWN, NOT SYNCED. It starts empty. Every party in it got
 * there because someone typed a name and the live lookup went and found them —
 * a request that had to happen anyway. From then on that customer is answered
 * from memory: no request, no database read, an answer before the next keystroke.
 * The regulars settle in by themselves, and a customer who came once and never
 * returned simply ages out.
 *
 * Staying current is the same trade. A change signal says only "parties moved";
 * `refreshFromChanges` asks which ids, and DROPS the ones it is holding rather
 * than re-fetching them. A dropped regular costs one ordinary lookup the next
 * time they walk in — which is what it would have cost with no cache at all —
 * and ids for customers we have never seen are ignored, so a busy branch across
 * town cannot fill this machine's cache with people it will never bill.
 *
 * COUNTER-ONLY. A party row is a customer's name, phone and address — exactly
 * the business data that must not sit on someone's laptop — so nothing is
 * written unless the counter bridge answers. Everywhere else `searchParties`
 * returns null and the caller stays on the live endpoint, which is why the till
 * behaves identically on an unbridged machine.
 *
 * `matches` deliberately mirrors `lookupAccounts` in /api/person: same token
 * AND-ing, same fields, same 8-row cap, same ledger-group narrowing. That is
 * also why cached rows are fetched with `full=1` — the live lookup DISPLAYS a
 * primary phone but MATCHES on every phone, plus aliases and account group, and
 * a row cached without those would quietly stop finding customers the server
 * finds. Treat that pairing as the contract, not an implementation detail.
 */

import axios from "axios";
import { localDb, type LocalPartyRow, type PartyType } from "@/shared/lib/browser/localDb";
import { isBridgeAvailable } from "@/shared/lib/bridge";

const CHANGED_API = "/api/parties/changed";
const META_KEY = "parties";

/**
 * How long a cached party is trusted without being seen again.
 *
 * The backstop for what a change signal cannot report: a hard-deleted party
 * leaves no row for a timestamp query to find, and a machine that was off misses
 * signals entirely. Expiry costs one ordinary lookup for a regular once a week —
 * and it is why the cache tracks the customers still coming in rather than every
 * customer who ever came. Paired with `MAX_GAP_MS` in /api/parties/changed.
 */
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** The live endpoint's cap; kept identical so result lists match. Exported so
 *  the search hook can tell a FULL local page from a partial one — a page this
 *  size cannot be topped up by asking live, since the server caps there too. */
export const MAX_HITS = 8;

export type Party = LocalPartyRow;

/** `[type+id]`, the compound key, as one string — a Map needs a scalar. */
const keyOf = (type: PartyType, id: number) => `${type}:${id}`;

/**
 * The searchable copy. IndexedDB survives the tab; this survives the keystroke.
 *
 * Reading the store per search was a transaction and a full deserialise on every
 * debounce tick, which is most of what the cache was meant to avoid — the rows
 * are already few (the regulars, not the customer list), so they are held whole
 * and filtered in place.
 */
let mem: Map<string, Party> | null = null;

/** Empty the stored copy. Says nothing about `mem` — every caller decides for
 *  itself whether it is starting over or shutting down. */
async function wipe(): Promise<void> {
    const db = localDb();
    if (!db) return;
    await db.transaction("rw", db.parties, db.partyMeta, async () => {
        await db.parties.clear();
        await db.partyMeta.delete(META_KEY);
    });
}

/**
 * Load what is on disk into memory, dropping anything past its life.
 *
 * Returns false when this machine may not hold parties at all (no bridge, no
 * IndexedDB) — the caller then stays on live search and caches nothing.
 */
async function open(): Promise<boolean> {
    if (!(await isBridgeAvailable())) {
        // Not a counter: this machine keeps nothing, including anything a
        // previous life left behind. Memoised as false for the page, so this
        // costs one probe and one wipe rather than one of each per keystroke.
        await wipe();
        mem = null;
        return false;
    }

    const db = localDb();
    if (!db) return false;

    const cutoff = Date.now() - CACHE_MAX_AGE_MS;
    const rows = await db.parties.toArray();
    const stale = rows.filter((p) => p.cachedAt < cutoff);
    const live = rows.filter((p) => p.cachedAt >= cutoff);

    if (stale.length > 0) {
        await db.parties.bulkDelete(stale.map((p) => [p.type, p.id] as [PartyType, number]));
    }

    mem = new Map(live.map((p) => [keyOf(p.type, p.id), p]));
    return true;
}

/**
 * Open once per page load, however many pickers ask.
 *
 * Every party picker, the till and Quick Ticket all want the cache warm, and
 * they mount independently — without this, opening a voucher form with three
 * pickers on it would read the store three times. Mirrors how `isBridgeAvailable`
 * memoises its probe for the life of the page.
 */
let ready: Promise<boolean> | null = null;

export function ensurePartiesReady(): Promise<boolean> {
    ready ??= open();
    return ready;
}

/**
 * Take parties the live lookup just returned into the cache.
 *
 * Called with whatever the server answered, hits the caller is showing anyway —
 * so the row is free, and the NEXT search for that customer costs nothing. Rows
 * must come from `full=1`, or they will lack the fields local matching needs.
 */
export async function cacheParties(rows: Party[]): Promise<void> {
    if (!(await ensurePartiesReady()) || rows.length === 0) return;
    const db = localDb();
    if (!db || !mem) return;

    const cachedAt = Date.now();
    const stamped = rows.map((p) => ({ ...p, cachedAt }));
    for (const p of stamped) mem.set(keyOf(p.type, p.id), p);
    await db.parties.bulkPut(stamped);
}

/**
 * Forget the parties named by a change signal, keep the rest.
 *
 * Ids for parties this machine never cached are ignored — that is the whole
 * point: the cache tracks who bills here, not what changed everywhere.
 */
export async function forgetParties(
    changed: { customers: number[]; companies: number[] },
): Promise<void> {
    if (!mem) return;
    const db = localDb();
    if (!db) return;

    const held: [PartyType, number][] = [];
    const drop = (type: PartyType, ids: number[]) => {
        for (const id of ids) {
            const key = keyOf(type, id);
            if (!mem!.has(key)) continue;
            mem!.delete(key);
            held.push([type, id]);
        }
    };
    drop("customer", changed.customers);
    drop("company", changed.companies);

    if (held.length > 0) await db.parties.bulkDelete(held);
}

type ChangedResponse =
    | { mode: "reset"; checkedAt: string }
    | { mode: "ids"; checkedAt: string; customers: number[]; companies: number[] };

/**
 * Act on a "parties moved" signal: ask which ones, drop the ones we hold.
 *
 * Deduped, because every mounted picker hears the same signal and there is one
 * cache between them. A failure leaves `checkedAt` alone, so the next call asks
 * from the same point and nothing is missed.
 */
let checking: Promise<void> | null = null;

export function refreshFromChanges(): Promise<void> {
    checking ??= check().finally(() => { checking = null; });
    return checking;
}

async function check(): Promise<void> {
    if (!(await ensurePartiesReady())) return;
    const db = localDb();
    if (!db || !mem) return;

    // Nothing held yet: there is nothing a change could invalidate, and the next
    // lookup will fetch fresh rows anyway. Still move the clock forward, or the
    // first real check would ask about a window we already know we ignored.
    const meta = await db.partyMeta.get(META_KEY);
    const since = meta?.checkedAt;

    let res: ChangedResponse | null;
    try {
        res = (await axios.get<ChangedResponse>(CHANGED_API, { params: since ? { since } : {} })).data;
    } catch {
        // Offline. A slightly stale regular still bills, and the same question
        // gets asked again on the next signal.
        return;
    }

    if (res.mode === "reset") {
        // Start collecting again from nothing, but keep the clock — otherwise the
        // next call would ask about a window we have already thrown away.
        await wipe();
        mem = new Map();
        await db.partyMeta.put({ key: META_KEY, checkedAt: res.checkedAt });
        return;
    }

    await forgetParties(res);
    await db.partyMeta.put({ key: META_KEY, checkedAt: res.checkedAt });
}

/**
 * Does this party match every token? Mirrors `lookupAccounts`'s `tokenOr`:
 * name / any phone / any ledger alias, plus address + any email when `wide`.
 */
function matches(p: Party, token: string, wide: boolean): boolean {
    const t = token.toLowerCase();
    if (p.name.toLowerCase().includes(t)) return true;
    // Phone is matched case-sensitively server-side (digits), but lowercasing a
    // digit string is a no-op, so one comparison covers both.
    if (p.phones.some((x) => x.includes(token))) return true;
    if (p.aliases.some((x) => x.toLowerCase().includes(t))) return true;
    if (wide) {
        if ((p.address ?? "").toLowerCase().includes(t)) return true;
        if (p.emails.some((x) => x.toLowerCase().includes(t))) return true;
    }
    return false;
}

/**
 * Search the cache.
 *
 * Returns null when this machine holds no cache at all — the caller must treat
 * that as "go to the live endpoint", NOT as "no matches".
 *
 * An EMPTY ARRAY is also not an answer. Unlike a replica, this cache is partial
 * by design: finding nothing means "not one of our regulars", which is exactly
 * when the server has to be asked. Only a non-empty result stands on its own —
 * and even then it may be short a customer the server would have found, which is
 * the accepted price of not holding the whole table. A partial first list that
 * arrives instantly, completed by the live answer, beats a blank box that waits.
 */
export async function searchParties(
    term: string,
    opts: { group?: string; wide?: boolean } = {},
): Promise<Party[] | null> {
    if (!(await ensurePartiesReady()) || !mem) return null;

    const tokens = term.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];

    const wide = opts.wide ?? false;
    const hits = [...mem.values()].filter((p) =>
        (!opts.group || p.accountGroup === opts.group)
        && tokens.every((tok) => matches(p, tok, wide)),
    );

    // The server orders by `createdAt desc` and takes 8. We have no createdAt on
    // the row, so newest-id-first stands in for it: both Person and Company use
    // an autoincrement id, so id order and creation order agree.
    hits.sort((a, b) => b.id - a.id);
    return hits.slice(0, MAX_HITS);
}

/** Drop the whole cache — call after creating or editing a party, so the next
 *  search cannot be answered with the row as it was. */
export async function invalidateParties(): Promise<void> {
    // Nothing kept here means nothing to drop, and `mem` must stay null so
    // searches keep going live rather than reading an empty cache as an answer.
    if (!(await ensurePartiesReady())) return;
    await wipe();
    mem = new Map();
}
