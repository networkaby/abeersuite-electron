"use client";

/**
 * The active branches, as a picker needs them — answered from the browser.
 *
 * `/api/branches` is a heavy read (every branch with its positions and their
 * holders, for the admin screens), and the opening-stock pickers — the product
 * form and the Opening Balance page — only want `{ id, name }`. So the list is
 * kept in localStorage (same cache as usePositionPicker) and re-read only when
 * the copy is older than MAX_AGE_MS, or when the `settings` topic says a branch
 * was added, renamed or switched off.
 */

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { readCache, subscribeToCache, writeCache } from "@/shared/lib/browser/pollCache";
import { HEAD_OFFICE_BRANCH_ID } from "@/shared/lib/org/systemBranch";
import { isCombined } from "@/store/activeBranchStore";
import { useRealtimeTopics } from "./useRealtimeTopics";

export type BranchOption = { id: string; name: string };

// Not user-scoped: the branch master is the same for everyone. What a user may
// PICK is checked by the server (openingBranchForSave), not by this list.
const CACHE_KEY = "branch-options:v1";
const MAX_AGE_MS = 30 * 60 * 1000;

export function useBranchOptions(): { branches: BranchOption[]; ready: boolean } {
    // Seeded in an effect, never during render — see usePositionPicker.
    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [ready, setReady] = useState(false);

    const load = useCallback(async (force: boolean) => {
        if (!force) {
            const hit = readCache<BranchOption[]>(CACHE_KEY);
            if (hit && Date.now() - new Date(hit.computedAt).getTime() < MAX_AGE_MS) {
                setBranches(hit.data);
                setReady(true);
                return;
            }
        }
        try {
            const res = await axios.get<(BranchOption & { isActive?: boolean })[]>("/api/branches");
            const next = res.data.filter((b) => b.isActive !== false).map(({ id, name }) => ({ id, name }));
            setBranches(next);
            writeCache(CACHE_KEY, next, new Date().toISOString());
        } catch {
            /* Keep what is shown; an empty list only disables the picker. */
        } finally {
            setReady(true);
        }
    }, []);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- adopts this browser's saved copy after hydration (see usePositionPicker); reading it during render would mismatch the server's empty pass
    useEffect(() => { void load(false); }, [load]);
    useEffect(() => subscribeToCache<BranchOption[]>(CACHE_KEY, (e) => setBranches(e.data)), []);
    useRealtimeTopics(["settings"], () => { void load(true); });

    return { branches, ready };
}

/**
 * Where an opening goes when the user has not picked: the working branch from
 * the top bar, else Head Office, else the first branch. Shown in the picker so
 * it can be changed, and sent, so the save does not lean on the server's own
 * fallback (openingBranchForSave refuses "My branches" mode instead).
 */
export function defaultOpeningBranchId(branches: BranchOption[], activeBranchId: string | null): string {
    const has = (id: string | null) => id != null && !isCombined(id) && branches.some((b) => b.id === id);
    if (has(activeBranchId)) return activeBranchId!;
    if (has(HEAD_OFFICE_BRANCH_ID)) return HEAD_OFFICE_BRANCH_ID;
    return branches[0]?.id ?? "";
}
