"use client";

/**
 * The position filter list, answered from the browser instead of the database.
 *
 * Six screens — Contacts, Reconnect, Deals, Help, Administration and Recurring —
 * each used to run their own `prisma.position.findMany` (plus a `userPosition`
 * read) inside a Server Component, on every single visit. Ten query sites for a
 * list that changes when somebody edits the org chart, which is to say almost
 * never.
 *
 * A Server Component cannot help here: it runs on the server, so it can never
 * see what this browser already holds — every render is a mandatory round trip.
 * Reading the list from the client is what makes skipping the trip possible at
 * all, and that is the whole point of this hook.
 *
 * localStorage rather than IndexedDB on purpose: the list is small, and
 * `idbCache` reserves itself for payloads that would blow the ~5MB quota (see
 * its header). The key is user-scoped because `myPositionIds` depends on who is
 * asking, and localStorage outlives a sign-out on a shared counter machine.
 *
 * Freshness: within MAX_AGE_MS nothing is requested at all. Past it, one small
 * fetch. `useSession()` is primed by the (protected) layout, so the user id is
 * known on the first render and a warm tab makes no request whatsoever.
 *
 * KNOWN LIMIT — an org-chart edit reaches other people's browsers only when
 * their cached copy ages out. localStorage belongs to one browser; no write here
 * can reach another. `invalidatePositionPicker()` covers the editor's own tabs.
 * A filter dropdown a little behind the org chart is a fair trade for the reads
 * it saves, and matches how the poll intervals are reasoned about in
 * `constants/polling.ts` — a slower number costs patience, never access.
 */

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import axios from "axios";
import {
    clearCache,
    readCache,
    subscribeToCache,
    userScopedKey,
    writeCache,
} from "@/shared/lib/browser/pollCache";
import type { PositionPickerOption } from "@/shared/lib/org/positionIncludes";

const CACHE_KEY = "position-picker:v1";
/** Past this the cached list is not trusted and one small fetch replaces it. */
const MAX_AGE_MS = 30 * 60 * 1000;

export type PositionPickerData = {
    positions:     PositionPickerOption[];
    myPositionIds: string[];
};

const EMPTY: PositionPickerData = { positions: [], myPositionIds: [] };

type PickerResponse = PositionPickerData & { computedAt: string };

/** Drop this browser's copy — call after an edit that changes the position list. */
export function invalidatePositionPicker(userId: string | number): void {
    clearCache(userScopedKey(CACHE_KEY, userId));
}

export function usePositionPicker(): PositionPickerData & {
    /** False only until the first cache read or fetch settles. */
    ready: boolean;
    /** Force a re-read, bypassing the cached copy. */
    refresh: () => void;
} {
    const { data: session } = useSession();
    const userId = (session?.user as { id?: string } | undefined)?.id ?? null;

    // Seeded in an effect, never during render: reading localStorage while
    // rendering would make the client's first pass disagree with the server's
    // empty one, which is a hydration mismatch.
    const [data, setData] = useState<PositionPickerData>(EMPTY);
    const [ready, setReady] = useState(false);

    const load = useCallback(
        async (force: boolean) => {
            if (!userId) return;
            const key = userScopedKey(CACHE_KEY, userId);

            if (!force) {
                const hit = readCache<PositionPickerData>(key);
                if (hit && Date.now() - new Date(hit.computedAt).getTime() < MAX_AGE_MS) {
                    setData(hit.data);
                    setReady(true);
                    return;   // the saving: no request leaves the browser
                }
            }

            try {
                const res = await axios.get<PickerResponse>("/api/positions", {
                    params: { picker: 1 },
                });
                const next: PositionPickerData = {
                    positions:     res.data.positions ?? [],
                    myPositionIds: res.data.myPositionIds ?? [],
                };
                setData(next);
                writeCache(key, next, res.data.computedAt);
            } catch {
                /* Keep whatever is already shown — a stale dropdown still filters. */
            } finally {
                setReady(true);
            }
        },
        [userId],
    );

    useEffect(() => { void load(false); }, [load]);

    // Another tab just fetched: adopt its copy rather than fetching again here.
    useEffect(() => {
        if (!userId) return;
        return subscribeToCache<PositionPickerData>(
            userScopedKey(CACHE_KEY, userId),
            (entry) => setData(entry.data),
        );
    }, [userId]);

    return {
        ...data,
        ready,
        refresh: useCallback(() => { void load(true); }, [load]),
    };
}
