"use client";

import { useState, type ReactNode } from "react";
import { ScanBarcode, Search } from "lucide-react";
import MobileHeader from "./MobileHeader";
import { MobileSkeletonRows } from "./MobileSkeleton";
import MobileBarcodeScan, { useCanScanBarcode } from "./MobileBarcodeScan";

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
 * the "nothing found" note and "Load more". A list screen supplies only its rows —
 * filtered on the device for a catalogue it holds (products, parties), or paged
 * from the server with `useMobileList` (the Day Book).
 */
export default function MobileListScreen({ title, back, placeholder, query, onQuery, scan, list, emptyText, summary, children }: {
    title: string;
    /** Only when the list is a detail screen; main screens go back by the tab bar. */
    back?: string;
    placeholder: string;
    query: string;
    onQuery: (q: string) => void;
    /** Show a camera button that fills the search box with a scanned barcode (where the phone can scan). */
    scan?: boolean;
    list: ListState;
    emptyText: string;
    /** Totals / filter chips shown between the search box and the rows. */
    summary?: ReactNode;
    /** `<li>` rows. */
    children: ReactNode;
}) {
    const canScan = useCanScanBarcode() && !!scan;
    const [scanning, setScanning] = useState(false);
    return (
        <>
            <MobileHeader title={title} back={back} onRefresh={list.refresh} busy={list.loading} />
            <div className="sticky top-[var(--m-header)] z-10 bg-background px-3 py-2">
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
                    {canScan && (
                        <button type="button" onClick={() => setScanning(true)} className="-mr-2 p-2 text-primary" aria-label="Scan barcode">
                            <ScanBarcode className="size-5" />
                        </button>
                    )}
                </label>
            </div>

            {scanning && (
                <MobileBarcodeScan
                    onCode={(code) => { setScanning(false); onQuery(code); }}
                    onClose={() => setScanning(false)}
                />
            )}

            {list.error && <p className="px-3 text-sm text-destructive">{list.error}</p>}

            {summary}

            <ul className="divide-y">{children}</ul>

            {list.loading && list.empty && <MobileSkeletonRows />}

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
