"use client";

// Clickable sortable column header — the one used by office data tables.
//
// Used by Reorder, Stock Summary and the Pricing-Strategy pages (costing /
// needs-attention / update-print-labels) — add new sortable tables here rather
// than writing a local copy. Pair it with `useTableSort`.
//
// Generic over the caller's own SortKey union, so each page keeps a type that
// only admits its real columns — a typo'd key is a compile error, not a column
// that silently never sorts.

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

export type SortDir = "asc" | "desc";

/** Spread this into every <SortHeader> on a table: {...sortProps} */
export interface SortProps<K extends string> {
    sortKey: K;
    sortDir: SortDir;
    /** `firstDir` = the direction THIS column takes on its first click. */
    toggleSort: (k: K, firstDir: SortDir) => void;
}

export function SortHeader<K extends string>({
    k, label, align = "left", title, firstDir = "asc", className = "px-3 py-2", sortKey, sortDir, toggleSort,
}: SortProps<K> & {
    k: K;
    label: string;
    align?: "left" | "right" | "center";
    /** Native tooltip — used to explain what a computed column means. */
    title?: string;
    /**
     * Direction the FIRST click applies. Text columns want "asc" (A→Z reads as
     * the natural first move); quantity columns want "desc", because clicking
     * "Shortfall" means "show me the worst", not "show me the zeros".
     */
    firstDir?: SortDir;
    /**
     * Cell classes in place of the default padding (`px-3 py-2`) — e.g. a
     * shadcn `<Table>` passes the `TableHead` look, or a width / column tint.
     */
    className?: string;
}) {
    const active = sortKey === k;
    const Icon = !active ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
    const alignCls = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
    const rowCls = align === "right" ? "flex-row-reverse" : "";
    const hint = active
        ? "Click to flip, once more to clear back to the default order"
        : `Sort ${firstDir === "asc" ? "A→Z / smallest first" : "Z→A / largest first"}`;
    return (
        <th className={`${className} font-medium ${alignCls}`} title={title ? `${title}\n${hint}` : hint}>
            <button
                type="button"
                onClick={() => toggleSort(k, firstDir)}
                className={`inline-flex items-center gap-1 hover:text-foreground ${active ? "text-foreground" : ""} ${rowCls}`}
            >
                <span>{label}</span>
                <Icon size={11} className={active ? "" : "opacity-40"} />
            </button>
        </th>
    );
}
