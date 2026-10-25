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
 * localStorage rather than IndexedDB on purpose: the list is small and is read
 * during render, where localStorage's synchronous get beats awaiting `localDb`.
 * The key is user-scoped because `myPositionIds` depends on who is asking, and
 * localStorage outlives a sign-out on a shared counter machine.
 *
 * Freshness (useBrowserCached): within 30 minutes nothing is requested at all. Past it, one small
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

import { useSession } from "next-auth/react";
import axios from "axios";
import { clearCache, userScopedKey } from "@/shared/lib/browser/pollCache";
import type { PositionPickerOption } from "@/shared/lib/org/positionIncludes";
import { useBrowserCached } from "./useBrowserCached";

const CACHE_KEY = "position-picker:v1";

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

async function fetchPicker() {
    const res = await axios.get<PickerResponse>("/api/positions", { params: { picker: 1 } });
    return {
        data: { positions: res.data.positions ?? [], myPositionIds: res.data.myPositionIds ?? [] },
        computedAt: res.data.computedAt,
    };
}

export function usePositionPicker(): PositionPickerData & {
    /** False only until the first cache read or fetch settles. */
    ready: boolean;
    /** Force a re-read, bypassing the cached copy. */
    refresh: () => void;
} {
    const { data: session } = useSession();
    const userId = (session?.user as { id?: string } | undefined)?.id ?? null;
    const { data, ready, refresh } = useBrowserCached(
        userId ? userScopedKey(CACHE_KEY, userId) : null,
        fetchPicker,
        EMPTY,
    );
    return { ...data, ready, refresh };
}
