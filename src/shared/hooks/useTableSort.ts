"use client";

import { useCallback, useState } from "react";
import type { SortDir, SortProps } from "@/shared/components/SortHeader";

/**
 * Sort state for a data table, as a THREE-state cycle per column:
 *
 *   1st click → the column's own natural direction (`firstDir`)
 *   2nd click → the opposite direction
 *   3rd click → back to the table's default order
 *
 * The third rung matters: without it a table can be sorted but never
 * un-sorted, so once you click a header you can't get back to the curated
 * default (here, the server's buy → review → ok triage) without a reload.
 *
 * ONE state object, updated by a PURE updater — deliberately not two
 * useStates. The earlier version called setSortDir() from inside the
 * setSortKey() updater, which React StrictMode double-invokes in dev: the
 * direction flipped twice and cancelled itself out, so a column would sort
 * one way and refuse to flip back. Updaters must be pure; keeping key and
 * direction in a single atomic value makes that structurally impossible to
 * get wrong again.
 */
export function useTableSort<K extends string>(
    defaultKey: K,
    defaultDir: SortDir = "desc",
): SortProps<K> & { isDefaultSort: boolean; resetSort: () => void } {
    const [sort, setSort] = useState<{ key: K; dir: SortDir }>({ key: defaultKey, dir: defaultDir });

    const toggleSort = useCallback((k: K, firstDir: SortDir = "asc") => {
        setSort((prev) => {
            if (prev.key !== k) return { key: k, dir: firstDir };
            if (prev.dir === firstDir) return { key: k, dir: firstDir === "asc" ? "desc" : "asc" };
            return { key: defaultKey, dir: defaultDir };
        });
    }, [defaultKey, defaultDir]);

    const resetSort = useCallback(
        () => setSort({ key: defaultKey, dir: defaultDir }),
        [defaultKey, defaultDir],
    );

    return {
        sortKey: sort.key,
        sortDir: sort.dir,
        toggleSort,
        isDefaultSort: sort.key === defaultKey && sort.dir === defaultDir,
        resetSort,
    };
}
