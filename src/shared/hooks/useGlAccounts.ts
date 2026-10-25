"use client";

/**
 * The shared in-memory chart of accounts (with party ledgers) for voucher forms.
 *
 * Every voucher page used to fetch `/api/accountancy/gl-accounts?includeParties=true`
 * on mount — several thousand rows (2 MB+) each time a Receipt / Payment / Journal
 * opened, and the particulars box stayed empty until it landed. Now the list
 * lives ONCE per tab in a module-level store:
 *
 *   • Memory only — deliberately no Dexie tier. The web version keeps its
 *     behaviour (still refreshed on every voucher open, just shown instantly
 *     from memory when already loaded); a replica-served counter has Dexie
 *     switched off anyway, so memory is the whole cache there.
 *   • `warmGlAccounts()` is called at app start on a replica-served counter
 *     (see GlAccountsWarmup) so the first voucher of the day opens ready.
 *   • Any write to the books (realtime "ledger" topic) re-reads the list so
 *     the balances under each ledger stay honest.
 *   • Concurrent callers share ONE request via the in-flight dedupe.
 */

import { useEffect, useEffectEvent } from "react";
import axios from "axios";
import { create } from "zustand";
import type { GlAccount } from "@/modules/accountancy/components/GlAccountCombobox";
import { subscribeRealtimeTopics } from "./useRealtimeTopics";

const URL = "/api/accountancy/gl-accounts?includeParties=true";

type Store = {
    rows: GlAccount[];
    hydrated: boolean;
    set: (rows: GlAccount[]) => void;
};

const useStore = create<Store>((set) => ({
    rows: [],
    hydrated: false,
    set: (rows) => set({ rows, hydrated: true }),
}));

let inFlight: Promise<GlAccount[]> | null = null;

/** Fetch (deduped) and publish to every mounted consumer. Rejects on failure. */
export function loadGlAccounts(): Promise<GlAccount[]> {
    if (inFlight) return inFlight;
    inFlight = axios.get<GlAccount[]>(URL)
        .then((r) => { useStore.getState().set(r.data); return r.data; })
        .finally(() => { inFlight = null; });
    return inFlight;
}

/** Startup warm-up: fill memory if empty, never throws. */
export function warmGlAccounts(): void {
    if (useStore.getState().hydrated) return;
    void loadGlAccounts().catch(() => { /* the voucher page retries on open */ });
}

let subscribers = 0;
let unsubscribe: (() => void) | null = null;

/**
 * Accounts from the shared store, refreshed in the background on mount and on
 * every "ledger" change. `loading` is true only while memory is still empty.
 */
export function useGlAccounts(opts: { onError?: () => void } = {}): { accounts: GlAccount[]; loading: boolean } {
    const rows = useStore((s) => s.rows);
    const hydrated = useStore((s) => s.hydrated);
    const { onError } = opts;

    const reportError = useEffectEvent(() => onError?.());
    useEffect(() => {
        loadGlAccounts().catch(() => reportError());
        // One realtime subscription for however many voucher pages are open.
        if (subscribers++ === 0) {
            unsubscribe = subscribeRealtimeTopics(["ledger"], () => { void loadGlAccounts().catch(() => {}); });
        }
        return () => {
            if (--subscribers === 0) { unsubscribe?.(); unsubscribe = null; }
        };
        // The fetch runs once per mount; onError is read when it fails.
    }, []);

    return { accounts: rows, loading: !hydrated };
}

/**
 * Re-read now — after a ledger is made or altered from a picker, so every picker
 * on the page shows it, not only the one it came from. Realtime will not do it:
 * this tab never hears its own write back (the broadcast does not echo to the
 * sender), so the rest of the page would wait for somebody else's write.
 *
 * Waits out a read that is ALREADY on the wire first. It may have left before
 * the ledger existed, and joining it would answer without it. With no screen
 * holding the chart there is nothing to correct: the next one to mount reads it.
 */
export async function invalidateGlAccounts(): Promise<void> {
    if (subscribers === 0) return;
    if (inFlight) await inFlight.catch(() => { /* read again either way */ });
    await loadGlAccounts().catch(() => { /* the next "ledger" signal re-reads */ });
}
