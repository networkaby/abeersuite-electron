"use client";

import { useMemo, useState } from "react";

/**
 * Pattern F — "tables that render the whole year".
 *
 * The BI reports default to the fiscal-year start and then render every row the
 * API hands back. Bill profit lists every bill of the year; receivables lists
 * every party and every open bill; the opening-balance migration screen renders
 * every account and every product at once, which is exactly the screen a shop
 * arriving from Vyapar opens with thousands of parties. With 3,684 people and
 * 3,544 vouchers already in the live books this is a measurable freeze.
 *
 * This is the in-memory pager, to be used with the existing `PaginationBar`. It
 * is the SECOND-best fix and deliberately so: when the server can page, page on
 * the server (Day Book and Pending Vouchers already do, with honest "showing X–Y
 * of N" footers). Use this where the whole set genuinely has to be in the browser
 * — because it is sorted, grouped or exported client-side — and the only real
 * problem is painting ten thousand rows at once.
 *
 *     const { pageRows, page, setPage, pageSize, setPageSize, total } =
 *         useClientPagination(filteredRows, 100);
 *
 *     {pageRows.map(…)}
 *     <PaginationBar total={total} page={page} pageSize={pageSize}
 *                    onPageChange={setPage} onPageSizeChange={setPageSize} />
 *
 * The one bug this exists to prevent: filtering down to three results while
 * sitting on page 9, and being shown an empty table. Any change to the row count
 * clamps the page back into range.
 */
export function useClientPagination<T>(
    rows: readonly T[],
    initialPageSize = 100,
): {
    pageRows: T[];
    page: number;
    setPage: (p: number) => void;
    pageSize: number;
    setPageSize: (n: number) => void;
    total: number;
    pageCount: number;
} {
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(initialPageSize);

    const total = rows.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));

    // Filtering on page 9 down to three rows must not leave an empty table.
    //
    // Adjusted DURING RENDER rather than in an effect: React re-runs this render
    // immediately with the corrected page and never commits the out-of-range one,
    // so there is no flash of an empty table and no cascading-render warning.
    // See "You Might Not Need an Effect" — adjusting state when a prop changes.
    const [lastPageCount, setLastPageCount] = useState(pageCount);
    if (lastPageCount !== pageCount) {
        setLastPageCount(pageCount);
        if (page > pageCount) setPage(pageCount);
    }

    const current = Math.min(Math.max(1, page), pageCount);

    const pageRows = useMemo(
        () => rows.slice((current - 1) * pageSize, current * pageSize),
        [rows, current, pageSize],
    );

    return {
        pageRows,
        page: current,
        setPage,
        pageSize,
        // A smaller page size while deep in the list would otherwise land the user
        // somewhere arbitrary; going back to the top is the predictable answer.
        setPageSize: (n: number) => {
            setPageSize(n);
            setPage(1);
        },
        total,
        pageCount,
    };
}
