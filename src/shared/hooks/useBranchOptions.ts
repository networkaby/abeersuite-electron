"use client";

/**
 * The active branches, as a picker needs them — answered from the browser.
 *
 * `/api/branches` is a heavy read (every branch with its positions and their
 * holders, for the admin screens), and the opening-stock pickers — the product
 * form and the Opening Balance page — only want `{ id, name }`. So the list is
 * kept in localStorage (useBrowserCached, like usePositionPicker) and re-read
 * only when the copy is older than 30 minutes, or when the `settings` topic says a branch
 * was added, renamed or switched off.
 */

import axios from "axios";
import { HEAD_OFFICE_BRANCH_ID } from "@/shared/lib/org/systemBranch";
import { isCombined } from "@/store/activeBranchStore";
import { useBrowserCached } from "./useBrowserCached";
import { useRealtimeTopics } from "./useRealtimeTopics";

export type BranchOption = { id: string; name: string };

// Not user-scoped: the branch master is the same for everyone. What a user may
// PICK is checked by the server (openingBranchForSave), not by this list.
const CACHE_KEY = "branch-options:v1";
const NONE: BranchOption[] = [];

async function fetchBranches() {
    const res = await axios.get<(BranchOption & { isActive?: boolean })[]>("/api/branches");
    return {
        data: res.data.filter((b) => b.isActive !== false).map(({ id, name }) => ({ id, name })),
        computedAt: new Date().toISOString(),
    };
}

export function useBranchOptions(): { branches: BranchOption[]; ready: boolean } {
    const { data: branches, ready, refresh } = useBrowserCached(CACHE_KEY, fetchBranches, NONE);
    useRealtimeTopics(["settings"], refresh);
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
