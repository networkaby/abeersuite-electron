"use client";

import { useEffect } from "react";
import axios from "axios";
import { create } from "zustand";
import { useDebouncedValue } from "@/shared/hooks/useDebouncedValue";
import { MOBILE_FRESH_MS } from "@/shared/lib/constants/polling";

type BalanceStore = {
    /** accountId → balance (+ to receive, − to pay). */
    values: Record<number, number>;
    /** Server clock of the oldest figure held — sent back as `?since=`. */
    computedAt: string | null;
    /** Device clock of the same — for "older than MOBILE_FRESH_MS?". */
    at: number;
    /** Bumped to make the screen on view ask again. */
    epoch: number;
};

/** Ids per request — under the API's own cap of 60. */
const BATCH = 50;

type BalanceReply = { unchanged: boolean; computedAt: string; balances: Record<number, number> };

const useBalanceStore = create<BalanceStore>(() => ({ values: {}, computedAt: null, at: 0, epoch: 0 }));

/** Drop every held balance — after a payment or receipt moved one. */
export function forgetPartyBalances(): void {
    useBalanceStore.setState((s) => ({ values: {}, computedAt: null, at: 0, epoch: s.epoch + 1 }));
}

/** Re-check the balances on screen now (the ↻ button) — still `?since=`, so a
 *  quiet book answers from one probe. */
export function recheckPartyBalances(): void {
    useBalanceStore.setState((s) => ({ at: 0, epoch: s.epoch + 1 }));
}

/**
 * Balances for the party rows on screen, held in memory for the session.
 *
 * Asks the server only for ids it does not hold yet; once its figures are older
 * than MOBILE_FRESH_MS it also re-checks the ones on screen with `?since=`, which
 * costs one indexed probe when nobody has posted since. A search that only
 * re-orders rows already seen asks nothing at all.
 */
export function usePartyBalances(accountIds: readonly number[]): Record<number, number> {
    const values = useBalanceStore((s) => s.values);
    const epoch = useBalanceStore((s) => s.epoch);
    const wanted = useDebouncedValue(accountIds.join(","), 300);

    useEffect(() => {
        const ids = wanted ? wanted.split(",").map(Number) : [];
        if (ids.length === 0) return;
        const held = useBalanceStore.getState();
        const stale = Date.now() - held.at > MOBILE_FRESH_MS;
        const missing = ids.filter((id) => !(id in held.values));
        if (!stale && missing.length === 0) return;

        // Several "Load more"s can put more rows on screen than one request takes.
        const targets = stale ? ids : missing;
        const batches: number[][] = [];
        for (let i = 0; i < targets.length; i += BATCH) batches.push(targets.slice(i, i + BATCH));

        void Promise.all(batches.map(async (batch) => {
            const known = stale && held.computedAt ? batch.filter((id) => id in held.values) : [];
            const params = new URLSearchParams({ ids: batch.join(",") });
            if (known.length > 0) {
                params.set("known", known.join(","));
                params.set("since", held.computedAt!);
            }
            const { data } = await axios.get<BalanceReply>(`/api/mobile/parties?${params}`);
            // A batch that held figures and was told "changed" means the book moved.
            return { ...data, moved: known.length > 0 && !data.unchanged };
        })).then((replies) => {
            const fresh = Object.assign({}, ...replies.map((r) => r.balances)) as Record<number, number>;
            useBalanceStore.setState((s) => {
                if (!stale) return { values: { ...s.values, ...fresh } };
                // A full re-check: figures not on screen may have moved too, so
                // they go unless the server said nothing has.
                const base = replies.some((r) => r.moved) ? {} : s.values;
                return { values: { ...base, ...fresh }, computedAt: replies[0].computedAt, at: Date.now() };
            });
        }).catch(() => { /* rows show "…" and the next change asks again */ });
    }, [wanted, epoch]);

    return values;
}
