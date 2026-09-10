"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import {
    cacheParties,
    ensurePartiesReady,
    MAX_HITS,
    refreshFromChanges,
    searchParties,
    type Party,
} from "@/shared/lib/parties";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { searchPartyRows } from "@/shared/lib/parties/partySearch";
import {
    partyCatalogEnabled,
    readCachedPartyList,
    syncPartyList,
} from "@/shared/lib/parties/partyFullCatalog";

/**
 * Result row from `/api/person?lookup=…`. Shared by `PartyCombobox` and `PosScreen`.
 */
export type PartyHit = {
    id: number;
    name: string;
    phone: string | null;
    email?: string | null;
    address?: string | null;
    /** Discriminator — kept as "customer"/"company" for back-compat with POS, QuickTicket, party pickers. */
    type: "customer" | "company";
    accountId: number | null;
    linkedCompanies?: { id: number; name: string; accountId: number | null }[];
};

/** What `full=1` adds on top of a hit — the fields the server MATCHES on but
 *  does not show, which a cached row needs to be searchable the same way. */
type FullHit = PartyHit & {
    phones: string[];
    emails: string[];
    aliases: string[];
    accountGroup: string | null;
    accountGroupType: Party["accountGroupType"];
};

/** A cached row carries every phone/email; the wire shape shows the primary,
 *  which is the one each list is sorted to put first. */
const toHit = (p: Party): PartyHit => ({
    id: p.id,
    name: p.name,
    phone: p.phones[0] ?? null,
    email: p.emails[0] ?? null,
    address: p.address,
    type: p.type,
    accountId: p.accountId,
    linkedCompanies: p.linkedCompanies,
});

/** A `full=1` hit, as the cache stores it. `cachedAt` is stamped on write. */
const toParty = (h: FullHit): Party => ({
    type: h.type,
    id: h.id,
    name: h.name,
    address: h.address ?? null,
    phones: h.phones,
    emails: h.emails,
    accountId: h.accountId,
    accountGroup: h.accountGroup,
    accountGroupType: h.accountGroupType,
    aliases: h.aliases,
    linkedCompanies: h.linkedCompanies ?? [],
    cachedAt: 0,
});

/**
 * Debounced party lookup. Empty / whitespace-only queries short-circuit to an
 * empty result. Aborts and clears on unmount.
 *
 * REGULARS FIRST. On a counter machine the parties someone has already looked up
 * are kept (see `partyCatalog`), and the search runs against that copy — no
 * request, no database read, an answer before the next keystroke. This used to
 * be a round trip PER CHARACTER TYPED, on the app's single most-repeated read,
 * and a shop bills the same tenth of its customer list over and over.
 *
 * A MISS IS NOT AN ANSWER. The cache holds only who has been looked up before,
 * so finding nothing means "not one of our regulars" — and the server is asked,
 * exactly as it always was. What comes back is then kept, so the same customer
 * is free next time. That is how the cache fills: by billing people, never by
 * downloading the customer table.
 *
 * Where parties may not be kept at all — no counter bridge, IndexedDB off —
 * `searchParties` returns null, nothing is cached, and every search goes live
 * exactly as before. That fallback is the reason the till behaves identically on
 * an unbridged machine.
 *
 * `enabled` lets callers turn the search off without unmounting (e.g. while a
 * selection is settled and the input should not refire).
 *
 * Usage:
 *   const { hits, loading } = usePartySearch(query, { enabled: open });
 */
export function usePartySearch(
    query: string,
    opts: {
        enabled?: boolean;
        debounceMs?: number;
        /**
         * Restrict hits to parties whose ledger sits under this AccountGroup
         * name (e.g. "Sundry Debtors" for customers, "Sundry Creditors" for
         * suppliers). Defaults to no filter — returns both sides.
         */
        group?: "Sundry Debtors" | "Sundry Creditors";
        /**
         * Widen each token's match to also cover address + email (not just
         * name + phone). Opt-in so POS / party pickers keep their strict search.
         * Used by the Front Office helper so "rosy delhi" can pair a name token
         * with an address token.
         */
        wide?: boolean;
    } = {},
): { hits: PartyHit[]; loading: boolean; guessIds: Set<string> } {
    const { enabled = true, debounceMs = 200, group, wide = false } = opts;
    const [hits, setHits] = useState<PartyHit[]>([]);
    const [guessIds, setGuessIds] = useState<Set<string>>(() => new Set());
    const [loading, setLoading] = useState(false);
    /** The whole customer list, on a counter. null everywhere else — see
     *  partyFullCatalog: held only where reading it is a local Postgres query. */
    const [fullList, setFullList] = useState<Party[] | null>(null);

    // Warm the cache once per page load, whatever else is mounted. Reads what is
    // already on disk — no request, since nothing is fetched until someone types.
    useEffect(() => { void ensurePartiesReady(); }, []);

    // On a counter, take the whole list: held rows first so the box works before
    // the network answers, then a delta on top. Everywhere else this is a no-op
    // and the grown cache below stays the only cache.
    useEffect(() => {
        if (!partyCatalogEnabled()) return;
        let cancelled = false;
        void (async () => {
            const held = await readCachedPartyList();
            if (!cancelled && held) setFullList(held);
            const fresh = await syncPartyList();
            if (!cancelled && fresh) setFullList(fresh);
        })();
        return () => { cancelled = true; };
    }, []);

    // Someone changed a party — here, at another till, on the website. Where the
    // whole list is held, take the delta; otherwise ask which ids moved and forget
    // just those, so a busy branch across town cannot fill this machine's cache.
    useRealtimeTopics(["parties"], () => {
        void (async () => {
            if (partyCatalogEnabled()) {
                const fresh = await syncPartyList();
                if (fresh) setFullList(fresh);
                return;
            }
            await refreshFromChanges();
        })();
    });

    // Rank a live answer the same way the local one is ranked. The server can
    // only give us `contains` in `createdAt` order; running the tiered matcher
    // over the rows it returns is what puts a word-start name above a mid-word
    // one, so "hri" leads with Hridoy rather than with Tas(hri)f.
    const rankServerHits = (rows: PartyHit[], q: string) => {
        const { rows: ranked, guessIds: guesses } = searchPartyRows(
            rows.map((h) => ({
                ...h,
                type: h.type,
                phones: (h as FullHit).phones ?? (h.phone ? [h.phone] : []),
                emails: (h as FullHit).emails ?? (h.email ? [h.email] : []),
                aliases: (h as FullHit).aliases ?? [],
            })),
            q,
            { rows: MAX_HITS },
        );
        return { ranked: ranked as PartyHit[], guesses: guesses as Set<string> };
    };

    useEffect(() => {
        const trimmed = query.trim();
        if (!enabled || !trimmed) {
            setHits([]);
            setGuessIds(new Set());
            setLoading(false);
            return;
        }
        let cancelled = false;
        const timer = setTimeout(() => {
            setLoading(true);
            void (async () => {
                try {
                    // On a counter the whole list is here, so the answer is
                    // complete and no request is made at all. This is the only
                    // path that can run the looser tiers — a split across name and
                    // address, a typo, letter-pair closeness — because none of
                    // them can be asked of Postgres as a `contains`.
                    if (fullList) {
                        const { rows, guessIds: guesses } = searchPartyRows(fullList, trimmed, {
                            group,
                            rows: MAX_HITS,
                        });
                        if (cancelled) return;
                        setHits(rows.map(toHit));
                        setGuessIds(guesses as Set<string>);
                        return;
                    }

                    const local = await searchParties(trimmed, { group, wide });
                    if (cancelled) return;
                    // Paint the regulars immediately — instant, and correct as far
                    // as it goes. What it may be missing is anyone who has never
                    // been searched from THIS machine, which only the server knows.
                    if (local && local.length > 0) {
                        const { rows, guessIds: guesses } = searchPartyRows(local, trimmed, {
                            group,
                            rows: MAX_HITS,
                        });
                        setHits(rows.map(toHit));
                        setGuessIds(guesses as Set<string>);
                    }

                    // A FULL local page cannot be topped up: the server caps at the
                    // same number, so asking it could only repeat what is already
                    // shown. This is also how the cache converges — once a name
                    // pattern has enough regulars behind it, it stops going live at
                    // all, the same as a fully-warmed product catalogue.
                    if (local && local.length >= MAX_HITS) return;

                    // `local` is null where nothing may be kept; an empty array
                    // means "kept, but not one of ours" — either way, ask the
                    // server. Only where something IS kept is there somewhere to
                    // put the answer, so only then is the fuller row worth asking
                    // for.
                    const keeping = local !== null;
                    const url = `/api/person?lookup=${encodeURIComponent(trimmed)}`
                        + (group ? `&group=${encodeURIComponent(group)}` : "")
                        + (wide ? "&wide=1" : "")
                        + (keeping ? "&full=1" : "");
                    const res = await axios.get<PartyHit[]>(url);
                    if (cancelled) return;
                    // The live answer is the fuller one — it can see every customer,
                    // not just this machine's regulars — so it replaces the local
                    // paint rather than being appended to it.
                    const { ranked, guesses } = rankServerHits(res.data, trimmed);
                    setHits(ranked);
                    setGuessIds(guesses);
                    // Kept after painting, not before — the till waits for the
                    // list, never for the write that makes the next one free. This
                    // also refreshes any already-cached row's `cachedAt`, which is
                    // how a customer stays a regular instead of quietly expiring.
                    if (keeping) {
                        void cacheParties((res.data as FullHit[]).map(toParty));
                    }
                } catch {
                    if (!cancelled) { setHits([]); setGuessIds(new Set()); }
                } finally {
                    if (!cancelled) setLoading(false);
                }
            })();
        }, debounceMs);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [query, enabled, debounceMs, group, wide, fullList]);

    return { hits, loading, guessIds };
}
