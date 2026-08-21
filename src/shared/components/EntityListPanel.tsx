"use client";

import { useEffect, useRef } from "react";
import { Search, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/shared/lib/format/utils";

interface EntityListPanelProps {
    title: string;
    icon: React.ReactNode;
    count: number;
    search: string;
    onSearchChange: (s: string) => void;
    searchPlaceholder?: string;
    onAdd?: () => void;
    addLabel?: string;
    /** If provided, the title becomes clickable (e.g. to reset a master-detail
     *  view back to its summary/overview state). */
    onTitleClick?: () => void;
    /** Optional row rendered under the search box — e.g. a sort toggle. */
    toolbar?: React.ReactNode;
    emptyMessage?: string;
    isEmpty: boolean;
    className?: string;
    children: React.ReactNode;
    /** Called once when the list is scrolled near its bottom — the "grow on
     *  scroll" hook for a paginated list. Omit for a panel that loads everything
     *  up front. */
    onScrollNearBottom?: () => void;
}

/** How close to the bottom, in pixels, before the next page is asked for —
 *  loose enough that it fires before the user hits a dead stop. */
const NEAR_BOTTOM_PX = 200;

/** Reusable centre column used by list-detail pages (Customers, Inventory Details, …).
 *  Header (icon + title + count + optional Add) → search → scrollable list of rows.
 *  Caller supplies the row content via children — pick the row shape per use case. */
export function EntityListPanel({
    title,
    icon,
    count,
    search,
    onSearchChange,
    searchPlaceholder = "Search…",
    onAdd,
    addLabel = "Add",
    onTitleClick,
    toolbar,
    emptyMessage = "No items",
    isEmpty,
    className,
    children,
    onScrollNearBottom,
}: EntityListPanelProps) {
    // `ScrollArea`'s own props land on its Root, not the Viewport that actually
    // scrolls (Radix splits them) — so the listener is attached imperatively to
    // whichever element is really scrolling, rather than changing a primitive
    // every other list-detail page also renders through.
    const rootRef = useRef<HTMLElement>(null);
    const onScrollRef = useRef(onScrollNearBottom);
    useEffect(() => { onScrollRef.current = onScrollNearBottom; });

    useEffect(() => {
        const viewport = rootRef.current?.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]');
        if (!viewport || !onScrollNearBottom) return;
        const onScroll = () => {
            if (viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < NEAR_BOTTOM_PX) {
                onScrollRef.current?.();
            }
        };
        viewport.addEventListener("scroll", onScroll);
        return () => viewport.removeEventListener("scroll", onScroll);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-bind when going from off to on
    }, [!!onScrollNearBottom]);

    return (
        <aside ref={rootRef} className={cn("flex w-80 shrink-0 flex-col border-r bg-card", className)}>
            <div className="flex items-center justify-between border-b px-4 py-3">
                <div className="flex items-center gap-2">
                    {icon}
                    {onTitleClick ? (
                        <button
                            type="button"
                            onClick={onTitleClick}
                            className="text-sm font-semibold hover:underline underline-offset-2"
                        >
                            {title}
                        </button>
                    ) : (
                        <span className="text-sm font-semibold">{title}</span>
                    )}
                    <Badge variant="outline">{count}</Badge>
                </div>
                {onAdd && (
                    <Button type="button" size="sm" onClick={onAdd}>
                        <Plus size={13} /> {addLabel}
                    </Button>
                )}
            </div>

            <div className="border-b p-3">
                <div className="relative">
                    <Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        type="text"
                        value={search}
                        onChange={(e) => onSearchChange(e.target.value)}
                        placeholder={searchPlaceholder}
                        className="pl-9"
                    />
                </div>
                {toolbar}
            </div>

            {/* Force the Radix viewport's inner wrapper to block so rows fill the
                fixed panel width (default display:table lets rows grow to content
                width, pushing right-aligned content off-screen where it's clipped). */}
            <ScrollArea className="flex-1 overflow-y-auto [&>[data-slot=scroll-area-viewport]>div]:!block">
                {isEmpty ? (
                    <p className="py-8 text-center text-xs text-muted-foreground">{emptyMessage}</p>
                ) : (
                    children
                )}
                <ScrollBar orientation="vertical" />
            </ScrollArea>
        </aside>
    );
}
