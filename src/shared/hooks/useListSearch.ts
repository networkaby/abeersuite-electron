import { useMemo, useState } from "react";

/**
 * Client-side search for a small, already-loaded master list (brands, units…).
 * Every typed word must appear somewhere in the row's text, case-insensitive.
 * No refetch — the list is already in memory, so this costs no DB read.
 */
export function useListSearch<T>(rows: readonly T[], text: (row: T) => string) {
    const [query, setQuery] = useState("");
    const filtered = useMemo(() => {
        const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
        if (words.length === 0) return rows as T[];
        return rows.filter((r) => {
            const hay = text(r).toLowerCase();
            return words.every((w) => hay.includes(w));
        });
        // `text` is an inline getter; rows + query are the real inputs.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rows, query]);
    return { query, setQuery, filtered, searching: query.trim() !== "" };
}
