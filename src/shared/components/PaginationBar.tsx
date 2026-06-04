"use client";

// ─────────────────────────────────────────────────────────────────────────────
// PaginationBar — reusable client-side pager for in-memory tables.
//
// Presentational only: it owns no state. The parent holds `page` (1-indexed) and
// `pageSize`, slices its own array (`rows.slice((page-1)*pageSize, page*pageSize)`),
// and passes `total` (the full filtered length) here. Renders a "Showing X–Y of N"
// label, first/prev/next/last buttons, and an optional rows-per-page select.
//
// Built only from existing shadcn primitives (Button, Select) — no new deps.
// ─────────────────────────────────────────────────────────────────────────────

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

export interface PaginationBarProps {
    /** Total number of items across all pages (the full filtered length). */
    total: number;
    /** Current page, 1-indexed. */
    page: number;
    /** Items per page. */
    pageSize: number;
    /** Called with the next page number (already clamped to [1, pageCount]). */
    onPageChange: (page: number) => void;
    /** Optional — when given, renders a rows-per-page select. */
    onPageSizeChange?: (pageSize: number) => void;
    /** Choices for the rows-per-page select. */
    pageSizeOptions?: number[];
    /** Singular noun for the count label (default "item"). */
    unitLabel?: string;
    className?: string;
}

export function PaginationBar({
    total,
    page,
    pageSize,
    onPageChange,
    onPageSizeChange,
    pageSizeOptions = [25, 50, 100, 200],
    unitLabel = "item",
    className,
}: PaginationBarProps) {
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const current = Math.min(Math.max(1, page), pageCount);
    const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
    const to = Math.min(current * pageSize, total);
    const atFirst = current <= 1;
    const atLast = current >= pageCount;

    return (
        <div
            className={`flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-muted-foreground ${className ?? ""}`}
        >
            <span>
                {total === 0 ? (
                    `No ${unitLabel}s`
                ) : (
                    <>
                        Showing <strong className="font-mono text-foreground">{from}</strong>–
                        <strong className="font-mono text-foreground">{to}</strong> of{" "}
                        <strong className="font-mono text-foreground">{total}</strong> {unitLabel}
                        {total === 1 ? "" : "s"}
                    </>
                )}
            </span>

            <div className="flex items-center gap-2">
                {onPageSizeChange ? (
                    <div className="flex items-center gap-1.5">
                        <span>Rows</span>
                        <Select
                            value={String(pageSize)}
                            onValueChange={(v) => onPageSizeChange(Number(v))}
                        >
                            <SelectTrigger className="h-7 w-[4.5rem] text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {pageSizeOptions.map((opt) => (
                                    <SelectItem key={opt} value={String(opt)} className="text-xs">
                                        {opt}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                ) : null}

                <span className="font-mono">
                    Page {current} / {pageCount}
                </span>

                <div className="flex items-center gap-1">
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-7"
                        onClick={() => onPageChange(1)}
                        disabled={atFirst}
                        aria-label="First page"
                    >
                        <ChevronsLeft className="size-4" />
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-7"
                        onClick={() => onPageChange(current - 1)}
                        disabled={atFirst}
                        aria-label="Previous page"
                    >
                        <ChevronLeft className="size-4" />
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-7"
                        onClick={() => onPageChange(current + 1)}
                        disabled={atLast}
                        aria-label="Next page"
                    >
                        <ChevronRight className="size-4" />
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-7"
                        onClick={() => onPageChange(pageCount)}
                        disabled={atLast}
                        aria-label="Last page"
                    >
                        <ChevronsRight className="size-4" />
                    </Button>
                </div>
            </div>
        </div>
    );
}
