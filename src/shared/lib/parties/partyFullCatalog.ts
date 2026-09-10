"use client";

/**
 * The whole customer list, held on a counter.
 *
 * This is the opposite trade from `partyCatalog.ts`, and both are right in their
 * own place. That cache is GROWN — it keeps whoever has been looked up before,
 * because on the web, paying for the entire customer table to answer questions
 * about the regulars is a bad bargain.
 *
 * On a counter the bargain changes completely. `Person`, `Company`, `Phone`,
 * `Email`, `Account`, `AccountAlias` and `PersonCompany` are all in the local
 * replica (prisma/sync-tables.json), so reading every one of them costs a local
 * Postgres query and nothing else — no Supabase bill at all. And holding them
 * buys something a per-query endpoint cannot sell: the tiered match. Splitting
 * "medhidura" into a name and a locality, forgiving a typo, ranking a word-start
 * above a mid-word — none of that is expressible as a SQL `contains`, and all of
 * it is what lets a cashier find someone from a half-memory instead of asking
 * them to repeat their number.
 *
 * So: grown on the web and on unbridged machines, synced here. `servedByReplica()`
 * is the switch, and it is the same one that decides whether the ledger list gets
 * warmed at app start.
 *
 * Rows live in the SAME Dexie store as the grown cache (`db.parties`) — the row
 * shape is identical, and a party is a party. Only the meta key differs, so the
 * two modes cannot mistake each other's bookkeeping for their own.
 */

import axios from "axios";
import { localDb, servedByReplica, type LocalPartyRow } from "@/shared/lib/browser/localDb";

/** Separate from the grown cache's "parties" key — see the note above. */
const META_KEY = "parties:full";
/** Past this the held list is not trusted at all, whatever the delta says. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

type WireRow = Omit<LocalPartyRow, "cachedAt">;

type SyncResponse =
    | { mode: "full"; parties: WireRow[]; computedAt: string; count: number }
    | { mode: "delta"; changed: WireRow[]; removedKeys: string[]; computedAt: string; count: number };

const keyOf = (type: string, id: number) => `${type}:${id}`;

/** The searchable copy. IndexedDB survives the tab; this survives the keystroke. */
let mem: LocalPartyRow[] | null = null;

/** Is this machine allowed to hold the whole list? Counter app only. */
export function partyCatalogEnabled(): boolean {
    return servedByReplica() && localDb() !== null;
}

async function readMeta(): Promise<{ checkedAt: string } | null> {
    const db = localDb();
    if (!db) return null;
    const meta = await db.partyMeta.get(META_KEY);
    if (!meta?.checkedAt) return null;
    if (Date.now() - new Date(meta.checkedAt).getTime() > MAX_AGE_MS) return null;
    return meta;
}

async function readRows(): Promise<LocalPartyRow[]> {
    const db = localDb();
    if (!db) return [];
    return await db.parties.toArray();
}

/** Held rows for an instant first paint, or null when there is nothing usable. */
export async function readCachedPartyList(): Promise<LocalPartyRow[] | null> {
    if (!partyCatalogEnabled()) return null;
    if (mem) return mem;
    if (!(await readMeta())) return null;
    const rows = await readRows();
    if (rows.length === 0) return null;
    mem = rows;
    return rows;
}

async function replaceAll(rows: WireRow[], computedAt: string): Promise<LocalPartyRow[]> {
    const db = localDb();
    const stamped = rows.map((r) => ({ ...r, cachedAt: Date.now() }));
    if (db) {
        await db.transaction("rw", db.parties, db.partyMeta, async () => {
            await db.parties.clear();
            await db.parties.bulkPut(stamped);
            await db.partyMeta.put({ key: META_KEY, checkedAt: computedAt });
        });
    }
    mem = stamped;
    return stamped;
}

/**
 * Bring the held list up to date and return it.
 *
 * A delta merges BY KEY and drops what was removed — a replace, never arithmetic
 * on a previous value, so a row cannot drift out of step with the database. When
 * the merged total disagrees with the server's live count something was missed
 * that no timestamp could report (a hard delete), and the whole list is refetched
 * rather than trusted.
 *
 * Returns null when this machine does not hold the list, or when the request
 * failed and there is nothing held to fall back on — the caller then searches
 * the way it always did.
 */
export async function syncPartyList(): Promise<LocalPartyRow[] | null> {
    if (!partyCatalogEnabled()) return null;

    const meta = await readMeta();
    const url = "/api/parties/catalog?sync=1" + (meta ? `&since=${encodeURIComponent(meta.checkedAt)}` : "");

    let res: SyncResponse;
    try {
        res = (await axios.get<SyncResponse>(url)).data;
    } catch {
        // Offline or the server is unhappy — keep selling on what is held.
        return (await readCachedPartyList()) ?? null;
    }

    if (res.mode === "full") return await replaceAll(res.parties, res.computedAt);

    const held = mem ?? (await readRows());
    if (held.length === 0) {
        // A delta with nothing to apply it to. Ask again without `since`.
        const full = (await axios.get<SyncResponse>("/api/parties/catalog?sync=1")).data;
        return full.mode === "full" ? await replaceAll(full.parties, full.computedAt) : null;
    }

    const byKey = new Map(held.map((p) => [keyOf(p.type, p.id), p]));
    for (const k of res.removedKeys) byKey.delete(k);
    for (const row of res.changed) byKey.set(keyOf(row.type, row.id), { ...row, cachedAt: Date.now() });

    const merged = [...byKey.values()];
    if (merged.length !== res.count) {
        // Something moved that the delta could not describe — start over.
        const full = (await axios.get<SyncResponse>("/api/parties/catalog?sync=1")).data;
        return full.mode === "full" ? await replaceAll(full.parties, full.computedAt) : merged;
    }

    const db = localDb();
    if (db) {
        await db.transaction("rw", db.parties, db.partyMeta, async () => {
            if (res.removedKeys.length > 0) {
                await db.parties.bulkDelete(
                    res.removedKeys.map((k) => {
                        const [type, id] = k.split(":");
                        return [type, Number(id)] as [LocalPartyRow["type"], number];
                    }),
                );
            }
            await db.parties.bulkPut(res.changed.map((r) => ({ ...r, cachedAt: Date.now() })));
            await db.partyMeta.put({ key: META_KEY, checkedAt: res.computedAt });
        });
    }
    mem = merged;
    return merged;
}

/** Drop the held list — after creating or editing a party, so the next search
 *  cannot be answered with the row as it was. */
export function forgetPartyList(): void {
    mem = null;
}
