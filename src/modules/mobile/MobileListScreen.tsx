"use client";

import type { ReactNode } from "react";
import { Search } from "lucide-react";
import MobileHeader from "./MobileHeader";

type ListState = {
    loading: boolean;
    error: string | null;
    hasMore: boolean;
    empty: boolean;
    loadMore: () => void;
    refresh: () => void;
};

/**
 * The frame every searched list on the phone shares: header with back + refresh,
 * a search box that stays put while the list scrolls, the error line, the rows,
 * the "nothing found" note and "Load more". A list screen supplies only its rows
 * (pair it with `useMobileList`).
 */
export default function MobileListScreen({ title, back, placeholder, query, onQuery, list, emptyText, summary, children }: {
    title: string;
    /** Only when the list is a detail screen; main screens go back by the tab bar. */
    back?: string;
    placeholder: string;
    query: string;
    onQuery: (q: string) => void;
    list: ListState;
    emptyText: string;
    /** Totals / filter chips shown between the search box and the rows. */
    summary?: ReactNode;
    /** `<li>` rows. */
    children: ReactNode;
}) {
    return (
        <>
            <MobileHeader title={title} back={back} onRefresh={list.refresh} busy={list.loading} />
            <div className="sticky top-[53px] z-10 bg-background px-3 py-2">
                <label className="flex items-center gap-2 rounded-lg border px-3">
                    <Search className="size-4 text-muted-foreground" />
                    <input
                        type="search"
                        value={query}
                        onChange={(e) => onQuery(e.target.value)}
                        placeholder={placeholder}
                        className="h-11 flex-1 bg-transparent outline-none"
                        autoComplete="off"
                    />
                </label>
            </div>

            {list.error && <p className="px-3 text-sm text-destructive">{list.error}</p>}

            {summary}

            <ul className="divide-y">{children}</ul>

            {!list.loading && list.empty && !list.error && (
                <p className="p-6 text-center text-sm text-muted-foreground">{emptyText}</p>
            )}
            {list.hasMore && (
                <button type="button" onClick={list.loadMore} disabled={list.loading} className="m-3 rounded-lg border py-3 text-sm">
                    {list.loading ? "Loading…" : "Load more"}
                </button>
            )}
        </>
    );
}
