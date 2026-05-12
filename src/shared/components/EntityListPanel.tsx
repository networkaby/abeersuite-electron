"use client";

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
    emptyMessage?: string;
    isEmpty: boolean;
    className?: string;
    children: React.ReactNode;
}

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
    emptyMessage = "No items",
    isEmpty,
    className,
    children,
}: EntityListPanelProps) {
    return (
        <aside className={cn("flex w-80 shrink-0 flex-col border-r bg-card", className)}>
            <div className="flex items-center justify-between border-b px-4 py-3">
                <div className="flex items-center gap-2">
                    {icon}
                    <span className="text-sm font-semibold">{title}</span>
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
            </div>

            <ScrollArea className="flex-1 overflow-y-auto">
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
