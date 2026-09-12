"use client";

import { Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/shared/lib/format/utils";

/**
 * Pattern A + B — "a failed load must not look like an empty shop".
 *
 * The old house habit was: catch the error, fire a toast, leave `data` at null.
 * Four seconds later the toast is gone and the screen reads as a definite fact —
 * "No orders yet", or a header above an empty void. Staff believed it.
 *
 * This block is the one place that decides what a page shows when it has nothing
 * to show, or when a refresh failed on top of figures it already has. Render it
 * where the old `{loading && <spinner/>}` block used to sit, and gate the body on
 * `data` alone (NOT on `!loading`), so a refresh never unmounts a readable page:
 *
 *     {status}
 *     {data && <TheReport … />}
 *
 * Four states, in priority order:
 *
 *   1. first load, nothing on screen yet  → centred spinner
 *   2. failed, nothing on screen          → error + Retry (the page is unusable
 *                                           without it, so it takes the space)
 *   3. failed, but stale figures showing  → slim banner above the stale data. It
 *                                           must NOT replace the table: the last
 *                                           good figures are still worth reading,
 *                                           they just must not pass as current.
 *   4. everything fine                    → nothing at all
 *
 * `refreshing` is deliberately not a state here. A background refresh over
 * readable data is the quiet case; it belongs in the toolbar, not over the data.
 */
export function QueryStateBlock({
    loading,
    error,
    hasData,
    onRetry,
    loadingLabel = "Loading…",
    className,
}: {
    /** A request is in flight. */
    loading: boolean;
    /** Message from the last failed request, or null. */
    error: string | null;
    /** Whether the caller currently has something worth rendering. */
    hasData: boolean;
    /** Re-runs the query. Omit only if the caller genuinely cannot retry. */
    onRetry?: () => void;
    loadingLabel?: string;
    className?: string;
}) {
    // 1 — first paint, nothing to show yet.
    if (loading && !hasData) {
        return (
            <div
                className={cn("flex justify-center py-20", className)}
                role="status"
                aria-live="polite"
            >
                <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="animate-spin" size={28} aria-hidden="true" />
                    <span className="sr-only">{loadingLabel}</span>
                </span>
            </div>
        );
    }

    if (!error) return null;

    // 3 — a refresh failed, but the previous figures are still on screen. Say so
    //     without taking them away.
    if (hasData) {
        return (
            <div
                className={cn(
                    "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200",
                    className,
                )}
                role="status"
                aria-live="polite"
            >
                <AlertTriangle size={15} className="shrink-0" aria-hidden="true" />
                <span>Could not refresh. These are the figures from the last successful load.</span>
                <span className="text-amber-800/80 dark:text-amber-200/70">{error}</span>
                {onRetry ? (
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="ml-auto h-7"
                        onClick={onRetry}
                        disabled={loading}
                    >
                        <RefreshCw size={13} className={cn("mr-1.5", loading && "animate-spin")} />
                        Try again
                    </Button>
                ) : null}
            </div>
        );
    }

    // 2 — failed with nothing to fall back on.
    return (
        <div
            className={cn(
                "flex flex-col items-center gap-3 rounded-lg border border-border bg-card px-6 py-14 text-center",
                className,
            )}
            role="alert"
        >
            <AlertTriangle size={26} className="text-destructive" aria-hidden="true" />
            <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Could not load this page</p>
                <p className="mx-auto max-w-md text-sm text-muted-foreground">{error}</p>
            </div>
            {onRetry ? (
                <Button type="button" variant="outline" size="sm" onClick={onRetry} disabled={loading}>
                    <RefreshCw size={14} className={cn("mr-1.5", loading && "animate-spin")} />
                    Try again
                </Button>
            ) : null}
        </div>
    );
}

/**
 * The same decision for a page that is nothing but one table: returns the row to
 * drop into `<TableBody>`, or null when the table itself should render.
 *
 * Pairs with TableLoadingRow / TableEmptyRow / TableErrorRow in DataTableStates,
 * and exists so a caller does not have to spell out the precedence by hand — the
 * bug it prevents is showing "No brands yet" when the fetch actually failed.
 */
export function tableStateKind({
    loading,
    error,
    rowCount,
}: {
    loading: boolean;
    error: string | null;
    rowCount: number;
}): "loading" | "error" | "empty" | "rows" {
    if (loading && rowCount === 0) return "loading";
    if (error && rowCount === 0) return "error";
    if (rowCount === 0) return "empty";
    return "rows";
}
