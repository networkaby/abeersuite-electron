"use client";

/**
 * Customers and companies, held in the browser and topped up by delta.
 *
 * Party lookup is the most-repeated read in the app: `/api/person?lookup=` fires
 * on EVERY KEYSTROKE at the till, in Quick Ticket, and in every voucher's party
 * picker — a database round trip per character typed, against a list that
 * changes a few times a day. Holding the list makes that search local and
 * instant and reduces the server's job to "anything new since?".
 *
 * COUNTER-ONLY. A party row is a customer's name, phone and address — exactly
 * the business data that must not sit on someone's laptop — so nothing is
 * written unless the counter bridge answers. Everywhere else `searchParties`
 * returns null and the caller falls back to the live endpoint, which is why the
 * till keeps working identically on an unbridged machine.
 *
 * `matchParties` deliberately mirrors `lookupAccounts` in /api/person: same
 * token AND-ing, same fields, same 8-row cap, same ledger-group narrowing. If
 * the two ever disagree, a customer found by typing on one machine would be
 * missing on another — so treat that function as the contract, not as an
 * implementation detail free to drift.
 */

import axios from "axios";
import { localDb, type LocalPartyRow, type PartyType } from "@/shared/lib/browser/localDb";
import { isBridgeAvailable } from "@/shared/lib/bridge";

const API = "/api/parties/sync";
const META_KEY = "parties";
/** Beyond this the held copy is not trusted at all — the backstop for anything
 *  the timestamp and count checks between them still miss. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** The live endpoint's cap; kept identical so result lists match. */
const MAX_HITS = 8;

const TYPES: PartyType[] = ["customer", "company"];

export type Party = LocalPartyRow;

type SyncResponse = {
    mode: "full" | "delta";
    computedAt: string;
    parties: Party[];
    counts: Record<PartyType, number>;
};

async function clearAll(): Promise<void> {
    const db = localDb();
    if (!db) return;
    await db.transaction("rw", db.parties, db.partyMeta, async () => {
        await db.parties.clear();
        await db.partyMeta.delete(META_KEY);
    });
}

/** Sync state, or null when there is nothing usable to build on. */
async function readMeta() {
    const db = localDb();
    if (!db) return null;
    const meta = await db.partyMeta.get(META_KEY);
    if (!meta?.computedAt) return null;
    if (Date.now() - new Date(meta.computedAt).getTime() > MAX_AGE_MS) {
        await clearAll();
        return null;
    }
    return meta;
}

/**
 * Bring the party list up to date. Returns false when this machine may not hold
 * one (no bridge, no IndexedDB) or the server could not be reached with nothing
 * already held — the caller then stays on live search.
 */
export async function syncParties(): Promise<boolean> {
    if (!(await isBridgeAvailable())) {
        // Not a counter: this machine keeps nothing, including anything a
        // previous life left behind.
        await clearAll();
        return false;
    }

    const db = localDb();
    if (!db) return false;

    const meta = await readMeta();

    let res: SyncResponse | null;
    try {
        res = (await axios.get<SyncResponse>(API, { params: meta ? { since: meta.computedAt } : {} })).data;
    } catch {
        res = null;
    }
    // Offline: a slightly old customer list still bills, but only if we have one.
    if (!res) return meta != null && (await db.parties.count()) > 0;

    await db.transaction("rw", db.parties, db.partyMeta, async () => {
        if (res!.mode === "full") await db.parties.clear();
        // A deactivated party arrives as a normal changed row; it is a REMOVAL as
        // far as the replica is concerned, since every consumer only ever offers
        // active parties.
        const live = res!.parties.filter((p) => p.isActive);
        const gone = res!.parties.filter((p) => !p.isActive).map((p) => [p.type, p.id] as [PartyType, number]);
        if (live.length > 0) await db.parties.bulkPut(live);
        if (gone.length > 0) await db.parties.bulkDelete(gone);
        await db.partyMeta.put({ key: META_KEY, computedAt: res!.computedAt, counts: res!.counts });
    });

    // A hard-deleted party leaves no trace a timestamp could match, so the count
    // is the only way to notice one. Disagreement means the replica has silently
    // diverged — throw it away and take the list fresh.
    for (const type of TYPES) {
        const held = await db.parties.where("type").equals(type).count();
        if (typeof res.counts[type] === "number" && held !== res.counts[type]) {
            await clearAll();
            return await reload();
        }
    }
    return true;
}

async function reload(): Promise<boolean> {
    const db = localDb();
    if (!db) return false;
    try {
        const res = (await axios.get<SyncResponse>(API)).data;
        await db.transaction("rw", db.parties, db.partyMeta, async () => {
            await db.parties.clear();
            await db.parties.bulkPut(res.parties.filter((p) => p.isActive));
            await db.partyMeta.put({ key: META_KEY, computedAt: res.computedAt, counts: res.counts });
        });
        return true;
    } catch {
        return false;
    }
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
 * Search the held list. Returns null when this machine holds no replica, which
 * the caller must treat as "fall back to the live endpoint" — NOT as "no hits".
 */
export async function searchParties(
    term: string,
    opts: { group?: string; wide?: boolean } = {},
): Promise<Party[] | null> {
    const db = localDb();
    if (!db) return null;
    if (!(await readMeta())) return null;

    const all = await db.parties.toArray();
    if (all.length === 0) return null;

    const tokens = term.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];

    const wide = opts.wide ?? false;
    const hits = all.filter((p) =>
        (!opts.group || p.accountGroup === opts.group)
        && tokens.every((tok) => matches(p, tok, wide)),
    );

    // The server orders by `createdAt desc` and takes 8. We have no createdAt on
    // the row, so newest-id-first stands in for it: both Person and Company use
    // an autoincrement id, so id order and creation order agree.
    hits.sort((a, b) => b.id - a.id);
    return hits.slice(0, MAX_HITS);
}

/**
 * Sync once per page load, however many pickers ask.
 *
 * Every party picker, the till and Quick Ticket all want the list warm, and they
 * mount independently — without this, opening a voucher form with three pickers
 * on it would fire three identical syncs. Mirrors how `isBridgeAvailable`
 * memoises its probe for the life of the page.
 */
let syncing: Promise<boolean> | null = null;

export function ensurePartiesSynced(): Promise<boolean> {
    syncing ??= syncParties();
    return syncing;
}

/** Drop the held copy — call after creating or editing a party so the next
 *  search sees the change immediately rather than waiting for a delta. */
export async function invalidateParties(): Promise<void> {
    // Clear the memo too, or the next `ensurePartiesSynced` would hand back the
    // already-resolved promise and never actually refetch.
    syncing = null;
    await clearAll();
}
